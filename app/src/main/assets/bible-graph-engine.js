'use strict';
/* Grafo bíblico determinístico: Bíblia Livre + tópicos NEUU + OpenBible.
 * Referências semânticas nunca são tratadas como prova doutrinária.
 * Executa em JS local; não há requisição de rede nem modelo generativo.
 */
const BibleGraphEngine=(()=>{
  const norm=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matches=(text,phrase)=>new RegExp('(?:^| )'+esc(norm(phrase)).replace(/\s+/g,'\\s+')+'(?=$| )').test(text);
  const STOPS=new Set(('a o as os e de do da dos das no na nos nas ao aos que por para com em um uma uns umas me se eu ele ela eles elas nos vos '
    +'tua teu suas seus minha meu seu sua si te nos lhe lhei dele dela deste desta desse dessa ha ate quando como onde porque qual quais '
    +'foi era eram sera serao sendo havia havia sido isso isto aquele aquela assim sobre ainda ja somente apenas todo toda todos todas '
    +'entao tambem mesmo muito muitos mais menos bem nao sim eis este esta aquele onde agora depois antes fez fazendo fazer '
    +'disse disse lhe falou respondeu veio viram foi pois tinha tinham homem homens mulher mulheres Jesus jesus cristo senhor deus '
    +'filho pai ir veio tudo dia dias tempo vezes coisa coisas ainda diante entre meio ate sua tu es sao foi são tao sera agora').split(/\s+/));
  // Busca lexical de acontecimentos: normalização conservadora e comum a
  // todas as passagens. Não depende de IDs, hinos, personagens ou histórias específicas.
  const SUFFIXES=['amentos','imentos','acoes','mente','aram','eram','iram','ando','endo','indo',
    'ados','adas','idos','idas','arei','erei','irei','asse','esse','isse','ava','avam',
    'ado','ada','ido','ida','icos','icas','icao','coes','ante','antes','ista',
    'ou','eu','iu','ei','am','em','ar','er','ir','os','as','es','s','o','a','e'];
  const CUE_STOP=new Set([...STOPS].filter(x=>!['mulher','mulheres','filho','pai'].includes(x)));
  function stem(word){
    for(const suffix of SUFFIXES){
      if(word.endsWith(suffix)&&word.length-suffix.length>=3)return word.slice(0,-suffix.length);
    }
    return word;
  }
  function roots(raw){
    return (norm(raw).match(/[a-z]{4,}/g)||[]).filter(x=>!CUE_STOP.has(x)).map(stem);
  }
  function passageWindows(lyrics){
    const windows=[];
    for(const stanza of String(lyrics||'').split(/\n\s*\n/)){
      const lines=stanza.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      for(let i=0;i<lines.length;i++){
        windows.push(new Set(roots(lines.slice(i,i+4).join(' '))));
      }
    }
    return windows;
  }
  function create(db,scripture,semantic){
    if(!db||db.schema_version!==1||!db.t||!db.x||!Array.isArray(db.narratives)||!scripture)throw Error('Índice bíblico de relações inválido');
    const topicLabels=new Map((semantic?.catalog()||[]).map(s=>[s.id,s.label]));
    const narratives=db.narratives.map(n=>({...n,aliasNorm:n.aliases.map(norm).filter(x=>x.length>=5)}));
    const knownRefs=narratives.map(n=>({...n,parsed:scripture.lookup(n.reference,1)}));
    let docFreq=new Map(),totalDocs=0;
    const corpus=new Map();
    function setCorpus(hymns){
      docFreq=new Map();totalDocs=0;corpus.clear();
      for(const song of hymns||[]){
        const windows=passageWindows(song.lyrics||'');
        const unique=new Set(roots((song.title||'')+' '+(song.lyrics||'')));
        totalDocs++;
        for(const root of unique)docFreq.set(root,(docFreq.get(root)||0)+1);
        if(song.id!=null)corpus.set(song.id,{unique,windows});
      }
    }
    function episodeEvidence(song,context){
      const doc=corpus.get(song.id)||{
        unique:new Set(roots((song.title||'')+' '+(song.lyrics||''))),
        windows:passageWindows(song.lyrics||'')
      };
      const aliases=new Set(context.aliasRoots||[]);
      const candidates=(context.passageRoots||[]).filter(root=>doc.unique.has(root)).map(root=>{
        const frequency=docFreq.get(root)||0;
        const idf=Math.min(4.6,Math.log(1+(totalDocs+1)/(frequency+1)));
        return {root,idf,weight:idf*(aliases.has(root)?1.2:1),rare:totalDocs>0&&frequency<=Math.max(2,totalDocs*.12)};
      });
      let best={score:0,hits:[],rare:0};
      for(const window of doc.windows){
        const hits=candidates.filter(item=>window.has(item.root));
        if(!hits.length)continue;
        const rare=hits.filter(x=>x.rare).length;
        // Pistas isoladas ou palavras genéricas não comprovam uma cena.
        const weight=hits.reduce((sum,item)=>sum+item.weight,0);
        const score=hits.length>=2&&rare>=1?Math.min(42,weight*2.6+(hits.length-1)*1.9+rare*1.2):
          Math.min(4,weight*.4);
        if(score>best.score)best={score,hits,rare};
      }
      return {score:best.score,cues:best.hits.sort((a,b)=>b.weight-a.weight).slice(0,5).map(x=>x.root),
        count:best.hits.length,rare:best.rare};
    }

    function resolve(query,options={}){
      if(options.bibleGraph===false)return null;
      const original=String(query||'');
      const direct=scripture.lookup(original,64);
      const q=norm(original);
      const names=narratives.map(n=>({entry:n,match:n.aliasNorm.filter(a=>matches(q,a)).sort((a,b)=>b.length-a.length)[0]})).filter(n=>n.match).sort((a,b)=>b.match.length-a.match.length);
      let selected=names[0]?.entry||null;
      // Referência explícita pode apontar para uma das 48 cenas mapeadas,
      // mesmo sem citar seu nome. Exigir sobreposição substancial nos dois lados
      // impede associar um capítulo inteiro à primeira narrativa encontrada.
      if(direct&&!selected){
        let best=0;
        for(const n of knownRefs){
          const p=n.parsed;
          if(!p||p.book!==direct.book||p.chapter!==direct.chapter)continue;
          const overlap=Math.max(0,Math.min(direct.to,p.to)-Math.max(direct.from,p.from)+1);
          const coverage=overlap/Math.max(1,direct.to-direct.from+1);
          const specificity=overlap/Math.max(1,p.to-p.from+1);
          const quality=Math.min(coverage,specificity);
          if(quality>=.6&&quality>best){best=quality;selected=n;}
        }
      }
      const reading=direct|| (selected?scripture.lookup(selected.reference,64):null);
      if(!reading)return null;
      // Abrange o intervalo solicitado, inclusive o versículo final; sem atravessar capítulos arbitrariamente.
      const verseIds=reading.verses.slice(0,64).map(v=>`${reading.book}.${reading.chapter}.${v.number}`);
      if(!verseIds.length)return null;
      const depth=options.bibleLinks===false?0:Math.max(0,Math.min(2,Number(options.bibleDepth??1)));
      const counts=new Map(),directTopicIds=new Set();
      function addTopic(id,weight,fromDirect){
        if(!topicLabels.has(id))return;
        counts.set(id,(counts.get(id)||0)+weight);
        if(fromDirect)directTopicIds.add(id);
      }
      for(const id of verseIds)for(const tid of (db.t[id]||[]))addTopic(tid,1,true);
      const relatives=new Map();
      if(depth>0){
        for(const id of verseIds){
          for(const [other,votes] of (db.x[id]||[]).slice(0,depth===2?6:3)){
            relatives.set(other,Math.max(relatives.get(other)||0,Number(votes)||0));
          }
        }
        for(const [id,votes] of relatives){
          const weight=depth===2?0.23:0.14;
          for(const tid of (db.t[id]||[]))addTopic(tid,weight*Math.min(1.5,Math.log2(2+votes)/5),false);
        }
      }
      // A evidência tópica é derivada dos versos originais; referências cruzadas apenas complementam.
      for(const topic of selected?.topics||[])addTopic(topic,3,true);
      const snippets=reading.verses.map(v=>v.text).join(' ');
      // Cobertura para qualquer versículo, mesmo sem entrada nos tópicos de Nave/Torrey.
      // É detecção lexical determinística do texto bíblico em português, não inferência de IA.
      if(semantic){
        const textNorm=norm(snippets);
        for(const topic of semantic.indexHymn('',snippets).filter(x=>x.score>=0.9).slice(0,9)){
          // 'Seu sangue' em uma narrativa de cura não prova o tema do Calvário.
          if(topic.id==='cruz'&&!/(?:^| )(?:cruz|calvario|sacrificio|crucificado)(?:$| )/.test(textNorm))continue;
          addTopic(topic.id,Math.min(2.5,topic.score*1.6),true);
        }
      }
      const ordered=[...counts].filter(([id,weight])=>directTopicIds.has(id)||weight>=(depth===2?0.52:0.68)).sort((a,b)=>b[1]-a[1]);
      const max=depth===2?9:7;
      const concepts=ordered.slice(0,max).map(([id,weight])=>({id,label:topicLabels.get(id),weight:Math.round(weight*100)/100,kind:directTopicIds.has(id)?'direto':'indireto'}));
      // Evitar que uma palavra genérica como 'jesus' ou 'mulher' determine a classificação.
      const words=new Map();
      for(const raw of norm(snippets).split(' ')){
        if(raw.length<4||STOPS.has(raw)||/^\d+$/.test(raw))continue;
        words.set(raw,(words.get(raw)||0)+1);
      }
      const lexical=[...words].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length).slice(0,26).map(([word,n])=>({word,weight:Math.min(1.7,1+n/7)}));
      const residual=direct?reading.residual:q.replace(names[0]?.match||'',' ').replace(/\s+/g,' ').trim();
      const aliasRoots=selected?[...new Set(roots([selected.label,...selected.aliases].join(' ')))]:[];
      const passageRoots=[...new Set([...roots(snippets),...aliasRoots])].slice(0,180);
      return {reference:reading.reference,source:direct?'referência':'narrativa',narrative:selected?.label||null,
        directReference:!!direct,verses:verseIds.length,verseIds,sourceText:snippets,concepts,
        passageRoots,aliasRoots,
        directConceptIds:[...directTopicIds],words:lexical,relatedCount:relatives.size,
        relatedRefs:[...relatives].sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]),residual};
    }
    function evaluate(song,context){
      if(!context)return {score:0,reasons:[],matched:[]};
      const profile=new Set((song.semantic_profile||[]).map(x=>x.id));
      const matched=context.concepts.filter(x=>profile.has(x.id));
      const direct=matched.filter(x=>x.kind==='direto');
      const indirect=matched.filter(x=>x.kind!=='direto');
      const text=norm((song.title||'')+' '+(song.lyrics||''));
      const words=context.words.filter(x=>matches(text,x.word)).slice(0,8);
      // Passagens narrativas: recuperar acontecimentos localizados na letra
      // antes de premiar temas genéricos. Aplicado às 48 cenas, sem exceções.
      if(context.narrative){
        const episode=episodeEvidence(song,context);
        const topicPoints=Math.min(8,direct.length*2.5+indirect.length*.5);
        const score=Math.min(50,topicPoints+episode.score);
        const reasons=[];
        if(episode.count>=2&&episode.rare>=1){
          reasons.push('Detalhes de '+context.reference+' na letra: '+episode.cues.join(', '));
        }else if(direct.length){
          reasons.push('Relação temática com '+context.reference+': '+direct.slice(0,2).map(x=>x.label).join(', '));
        }
        return {score,reasons,matched:direct.map(x=>x.label),cues:episode.cues};
      }
      // Distintas evidências textuais; 'fé' sozinha não cria grande compatibilidade.
      let score=0;
      if(direct.length)score+=Math.min(27,direct.slice(0,4).reduce((v,x)=>v+4.5+Math.min(2.5,x.weight*.3),0));
      if(indirect.length)score+=Math.min(5,indirect.length*1.5);
      if(words.length>=2)score+=Math.min(13,3+words.reduce((v,x)=>v+2*x.weight,0));
      else if(words.length===1&&direct.length)score+=1.8;
      // Sem evidência suficiente no próprio hino, não promover resultados por analogias distantes.
      if(!direct.length && words.length<2)score=Math.min(score,2.5);
      if(direct.length===1 && !words.length)score=Math.min(score,6.5);
      const reasons=[];
      if(direct.length)reasons.push('Passagem '+context.reference+': temas presentes na letra — '+direct.slice(0,3).map(x=>x.label).join(', '));
      if(words.length>=2)reasons.push('Expressões da passagem relacionadas à letra: '+words.slice(0,4).map(x=>x.word).join(', '));
      if(indirect.length&&direct.length)reasons.push('Tema complementar das referências cruzadas: '+indirect.slice(0,2).map(x=>x.label).join(', '));
      return {score:Math.min(38,score),reasons,matched:direct.map(x=>x.label),cues:words.slice(0,4).map(x=>x.word)};
    }
    return {revision:db.revision,stats:db.stats||{},narrativeCount:narratives.length,resolve,evaluate,setCorpus};
  }
  return {create,norm};
})();
