'use strict';
/* Grafo bíblico determinístico: Bíblia Livre + tópicos NEUU + OpenBible.
 * Referências semânticas nunca são tratadas como prova doutrinária.
 * Executa em JS local; não há requisição de rede nem modelo generativo.
 */
const BibleGraphEngine=(()=>{
  const norm=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matches=(text,phrase)=>new RegExp('(?:^| )'+esc(norm(phrase)).replace(/\s+/g,'\\s+')+'(?=$| )').test(text);
  // Cenas narrativas discriminativas: os termos precisam coexistir na
  // letra completa, e não somente em um versículo isolado ou no título.
  const SCENE_CUES={
    mulher_do_fluxo_de_sangue:{
      groups:[
        ['multidão','multidao','multidão te oprime','muitos ao redor'],
        ['tocou','tocar','toque','tocou-me','vestes','manto','virtude'],
        ['mulher','enferma','filha','doze anos'],
        ['fé','salvou','cura','curou','sarou']
      ],required:[0,1],minGroups:3
    }
  };

  const STOPS=new Set(('a o as os e de do da dos das no na nos nas ao aos que por para com em um uma uns umas me se eu ele ela eles elas nos vos '
    +'tua teu suas seus minha meu seu sua si te nos lhe lhei dele dela deste desta desse dessa ha ate quando como onde porque qual quais '
    +'foi era eram sera serao sendo havia havia sido isso isto aquele aquela assim sobre ainda ja somente apenas todo toda todos todas '
    +'entao tambem mesmo muito muitos mais menos bem nao sim eis este esta aquele onde agora depois antes fez fazendo fazer '
    +'disse disse lhe falou respondeu veio viram foi pois tinha tinham homem homens mulher mulheres Jesus jesus cristo senhor deus '
    +'filho pai ir veio tudo dia dias tempo vezes coisa coisas ainda diante entre meio ate sua tu es sao foi são tao sera agora').split(/\s+/));
  function create(db,scripture,semantic){
    if(!db||db.schema_version!==1||!db.t||!db.x||!Array.isArray(db.narratives)||!scripture)throw Error('Índice bíblico de relações inválido');
    const topicLabels=new Map((semantic?.catalog()||[]).map(s=>[s.id,s.label]));
    const narratives=db.narratives.map(n=>({...n,aliasNorm:n.aliases.map(norm).filter(x=>x.length>=5)}));
    function resolve(query,options={}){
      if(options.bibleGraph===false)return null;
      const original=String(query||'');
      const direct=scripture.lookup(original,64);
      const q=norm(original);
      const names=narratives.map(n=>({entry:n,match:n.aliasNorm.filter(a=>matches(q,a)).sort((a,b)=>b.length-a.length)[0]})).filter(n=>n.match).sort((a,b)=>b.match.length-a.match.length);
      // Também identifica a cena quando o usuário digita a referência exata.
      const selected=names[0]?.entry||(direct?narratives.find(n=>norm(n.reference)===norm(direct.reference)):null)||null;
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
      return {reference:reading.reference,source:direct?'referência':'narrativa',narrative:selected?.label||null,
        narrativeId:selected?.id||null,
        directReference:!!direct,verses:verseIds.length,verseIds,sourceText:snippets,concepts,
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
      const scene=SCENE_CUES[context.narrativeId];
      let sceneCues=[];
      if(scene){
        const groups=scene.groups.map(group=>group.filter(term=>matches(text,term)));
        const coverage=groups.filter(group=>group.length).length;
        if(coverage>=scene.minGroups&&scene.required.every(i=>groups[i].length)){
          // A menção genérica a "sangue" não prova que o hino aborda
          // a mulher que tocou Jesus. Exigimos multidão e toque,
          // juntamente com outra evidência do episódio.
          sceneCues=groups.flatMap(group=>group.slice(0,1));
          score=Math.min(38,score)+(coverage===4?30:23);
          reasons.push('Cena bíblica reconhecida na letra completa ('+sceneCues.join(', ')+')');
        }
      }
      if(direct.length)reasons.push('Passagem '+context.reference+': temas presentes na letra — '+direct.slice(0,3).map(x=>x.label).join(', '));
      if(words.length>=2)reasons.push('Expressões da passagem relacionadas à letra: '+words.slice(0,4).map(x=>x.word).join(', '));
      if(indirect.length&&direct.length)reasons.push('Tema complementar das referências cruzadas: '+indirect.slice(0,2).map(x=>x.label).join(', '));
      return {score:Math.min(72,score),reasons,matched:direct.map(x=>x.label),
        cues:[...sceneCues,...words.slice(0,4).map(x=>x.word)]};
    }
    return {revision:db.revision,stats:db.stats||{},narrativeCount:narratives.length,resolve,evaluate};
  }
  return {create,norm};
})();
