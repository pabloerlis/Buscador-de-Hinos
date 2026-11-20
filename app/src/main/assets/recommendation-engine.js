'use strict';
/* Recomendações em cascata sem modelo generativo. Índices de letras + perfis semânticos
 * extraídos do próprio texto. As porcentagens são escalas heurísticas, NÃO probabilidades.
 */
const RecommendationEngine = (() => {
  const STOP = new Set(('a o os as ao aos aonde onde em no nos na nas um uma uns umas e de do dos da das para por com sem com que quem qual quais se eu tu ele ela nos vos meu minha meus minhas teu tua seus suas nosso nossa nossos nossas sobre sob pelo pela pelas pelos sua e teu ter ser foi vou vai sao esta estar estou voce voces senhor senhores deus jesus cristo salvador filho pai igreja irmaos irmao louvor hino hinos grande tanto todos todas tudo nada muito sempre nunca mais menos hoje ontem amem aleluia amem aqui ali tao agora assim pois porque quando entanto basta mesmo eleva faz fazei sois tuas santo santa santos dia dias noite noites coracao coracoes nome voz vozes cantar cantarei cantamos cantando cantai terra ceu ceus mundo mundana rei reis vida vidas amor eterno eterna eternos poder forte forca mais uma vez').split(/\s+/));
  const norm = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
  function words(value){return (norm(value).match(/[a-z]{4,}/g)||[]).filter(t=>!STOP.has(t)&&!/^\d+$/.test(t));}
  function create(hymns){
    const docs=hymns.map(song=>{
      const count=new Map();for(const t of words(song.title+' '+song.lyrics)){count.set(t,Math.min(4,(count.get(t)||0)+1));}
      return {song,tokens:count,vector:new Map(),length:0,
        themes:(song.semantic_profile||[]).slice(0,10),stories:(song.story_profile||[]).slice(0,8)};
    });
    const byId=new Map(docs.map((d)=>[d.song.id,d]));
    const df=new Map(),topicDf=new Map(),storyDf=new Map();
    for(const d of docs){
      for(const k of d.tokens.keys())df.set(k,(df.get(k)||0)+1);
      for(const t of d.themes)topicDf.set(t.id,(topicDf.get(t.id)||0)+1);
      for(const t of d.stories)storyDf.set(t.id,(storyDf.get(t.id)||0)+1);
    }
    const n=Math.max(1,docs.length);
    const idf=(freq)=>Math.log(1+(n+1)/(1+freq));
    // IDF evita que palavras ou temas encontrados em quase todos os hinos
    // dominem a recomendação. Tudo é processado em memória, uma única vez.
    for(const d of docs){
      const weighted=[];
      for(const [word,tf] of d.tokens){
        const weight=(1+Math.log(tf))*idf(df.get(word));
        weighted.push([word,weight]);
      }
      weighted.sort((a,b)=>b[1]-a[1]);
      for(const [word,value] of weighted.slice(0,160)){
        d.vector.set(word,value);d.length+=value*value;
      }
      d.length=Math.sqrt(d.length);
    }
    const common=(a,b)=>{
      const lookup=new Map(b.map(p=>[p.id,p]));let overlap=0,union=0,hits=[];
      for(const x of a){
        const y=lookup.get(x.id);const i=idf(topicDf.get(x.id));
        const ax=i*clamp(Number(x.score)||1,.5,6)/6;
        const by=y?i*clamp(Number(y.score)||1,.5,6)/6:0;
        overlap+=Math.min(ax,by);union+=Math.max(ax,by);
        if(y)hits.push({label:x.label,value:Math.min(ax,by)});
      }
      const ids=new Set(a.map(x=>x.id));
      for(const y of b)if(!ids.has(y.id))union+=idf(topicDf.get(y.id))*clamp(Number(y.score)||1,.5,6)/6;
      return {score:union?overlap/union:0,labels:hits.sort((x,y)=>y.value-x.value).slice(0,4).map(x=>x.label)};
    };
    function similarity(a,b){
      const theme=common(a.themes,b.themes);
      const aStories=new Map(a.stories.map(p=>[p.id,p]));
      const bStories=new Map(b.stories.map(p=>[p.id,p]));
      let storyMatch=0,storyUnion=0;const storyLabels=[];
      for(const [id,p] of aStories){
        const q=bStories.get(id),freq=idf(storyDf.get(id));
        const v=freq*clamp(p.score/18,0,1),w=q?freq*clamp(q.score/18,0,1):0;
        storyUnion+=Math.max(v,w);storyMatch+=Math.min(v,w);
        if(q)storyLabels.push(p.label);
      }
      for(const [id,p] of bStories)if(!aStories.has(id))storyUnion+=idf(storyDf.get(id))*clamp(p.score/18,0,1);
      const story=storyUnion?storyMatch/storyUnion:0;
      let dot=0;const wordsMatched=[];
      const [small,large]=a.vector.size<b.vector.size?[a,b]:[b,a];
      for(const [token,w] of small.vector){
        const v=large.vector.get(token);if(!v)continue;
        dot+=w*v;
        if(wordsMatched.length<9)wordsMatched.push({word:token,weight:w*v});
      }
      const cosine=(a.length&&b.length)?clamp(dot/(a.length*b.length),0,1):0;
      // 0,30 de cosseno já é uma semelhança lexical alta entre letras longas.
      const lyric=clamp(cosine/0.32,0,1);
      const storyWeight=a.stories.length?0.30:0;
      const themeWeight=(a.themes.length?0.62:0);
      const lexicalWeight=1-storyWeight-themeWeight;
      const score=clamp(themeWeight*theme.score+storyWeight*story+lexicalWeight*lyric,0,1);
      const cueWords=wordsMatched.sort((x,y)=>y.weight-x.weight).slice(0,4).map(x=>x.word);
      return {score,theme:theme.score,story,lyric,commonThemes:theme.labels,commonStories:storyLabels.slice(0,3),commonWords:cueWords};
    }
    function recommend({id, originalRanks, activeRanks, originalQuery='', settings={}, visited=[]}){
      const anchor=byId.get(Number(id));if(!anchor)throw Error('Hino de referência não encontrado.');
      const opts={weight:clamp(Number(settings.weight??65),0,100)/100,count:settings.count===10?10:5,
        keepContext:settings.keepContext!==false,skipVisited:settings.skipVisited!==false};
      const queryActive=opts.keepContext&&Boolean(String(originalQuery||'').trim())&&!/^\s*(?:hino\s*)?\d{1,4}\s*$/i.test(String(originalQuery||''));
      const root=originalRanks instanceof Map?originalRanks:new Map();
      const current=activeRanks instanceof Map?activeRanks:root;
      const blocked=new Set(opts.skipVisited?visited.map(Number):[]);blocked.add(anchor.song.id);
      const output=[];
      for(const other of docs){
        if(blocked.has(other.song.id))continue;
        if(settings.allowed&&!((other.song.collections||[]).some(key=>settings.allowed[key]!==false)))continue;
        const s=similarity(anchor,other);
        const hasEvidence=s.commonStories.length>0||s.commonThemes.length>0||s.commonWords.length>=2;
        if(!hasEvidence||s.score<0.12)continue;
        // Relevância da pesquisa é calculada sobre a mesma base do motor de busca,
        // enquanto a semelhança mede apenas relação entre letras e perfis.
        const r=clamp(Number(root.get(other.song.id))||0,0,100)/100;
        const a=clamp(Number(current.get(other.song.id))||0,0,100)/100;
        const q=queryActive?(current===root?r:0.55*r+0.45*a):null;
        const share=queryActive?opts.weight:1;
        const combined=clamp(share*s.score+(1-share)*(q||0),0,1);
        if(queryActive&&combined<0.16)continue;
        const why=[];
        if(s.commonStories.length)why.push('Narrativa em comum: '+s.commonStories.join(', '));
        if(s.commonThemes.length)why.push('Temas em comum: '+s.commonThemes.slice(0,3).join(', '));
        if(s.commonWords.length>=2)why.push('Termos relevantes nas letras: '+s.commonWords.slice(0,3).join(', '));
        output.push({id:other.song.id,number:other.song.number,title:other.song.title,collection:other.song.collection,
          compatibility_percent:Math.round(combined*100),similarity_percent:Math.round(s.score*100),
          query_percent:q===null?null:Math.round(q*100),reason:why.join('. ')+'.',
          topics:s.commonThemes.slice(0,4),score:combined});
      }
      output.sort((a,b)=>b.score-a.score||b.similarity_percent-a.similarity_percent||a.id-b.id);
      const unavailable=settings.notLearnedIds instanceof Set?settings.notLearnedIds:new Set();
      const available=output.filter(song=>!unavailable.has(song.id));
      const notLearned=output.filter(song=>unavailable.has(song.id));
      return {anchor_id:anchor.song.id,anchor_title:anchor.song.title,original_query:queryActive?originalQuery:'',
        weight_percent:queryActive?Math.round(opts.weight*100):100,
        results:available.slice(0,opts.count),total:available.length,
        not_learned_results:notLearned.slice(0,5),not_learned_total:notLearned.length,
        methodology:'Percentuais heurísticos: letras + temas + narrativas; busca original ponderada. Não são probabilidades.'};
    }
    return {recommend,docCount:docs.length};
  }
  return {create,normalize:norm};
})();
