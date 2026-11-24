'use strict';
/* Busca contextual interativa: reordena apenas sinais já calculados.
 * Nunca executa modelos nem confunde sinais heurísticos com NLI/probabilidades.
 * A recuperação permanece a cargo de OfflineAPI (E5/RRF/lexical/grafo).
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SemanticTuner=api;
})(typeof window==='object'?window:null,function(){
  const STORAGE_KEY='hinos-semantic-tuner-v1';
  const HISTORY_KEY='hinos-search-history-v1';
  const LIMIT=60;
  const HISTORY_LIMIT=20;
  const presets=Object.freeze({
    balanced:Object.freeze({topic:70,narrative:90,events:85,min:0}),
    narrative:Object.freeze({topic:35,narrative:100,events:100,min:30}),
    broad:Object.freeze({topic:100,narrative:30,events:25,min:0}),
  });
  const toBound=(value,min,max,fallback)=>{
    if(value===''||value===null||value===undefined)return fallback;
    const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):fallback;
  };
  function config(value){
    const raw=value&&typeof value==='object'?value:{};
    const fallback=presets.balanced;
    return {
      enabled:raw.enabled!==false,
      topic:toBound(raw.topic,0,100,fallback.topic),
      narrative:toBound(raw.narrative,0,100,fallback.narrative),
      events:toBound(raw.events,0,100,fallback.events),
      min:toBound(raw.min,0,100,fallback.min),
    };
  }
  function clamp(n){return Math.max(0,Math.min(100,Number(n)||0));}
  function signals(item){
    const s=item&&item.tuner_signals||{};
    const lexical=Math.max(0,Number(s.lexical)||0);
    const semantic=Math.max(0,Number(s.semantic)||0);
    const biblical=Math.max(0,Number(s.biblical)||0);
    const narrative=Math.max(0,Number(s.narrative)||0);
    const vector=Math.max(0,Number(s.vector)||0);
    const actions=Math.max(0,Number(s.actions)||0);
    const tier=Math.max(0,Number(s.tier)||0);
    // Scales are heuristics, not probability calibration. A missing signal is 0.
    // The topic component retains some of the legacy score to avoid a zero score
    // on lyrics that match through lexical evidence but have no E5 vector.
    const topical=clamp(Math.max(clamp(item.relevance_percent)*.55,
      Math.min(100,lexical*4+semantic*2.2+Math.max(0,vector-70)*2.4)));
    const baseNarrative=clamp(Math.max(narrative*3.8,biblical*2.2,tier*18));
    // Ordem categórica de decisão NLI (NÃO probabilidade), aplicada apenas
    // quando o modelo foi realmente executado e devolveu um rótulo válido.
    const nliLevels={entailment:100,neutral:50,contradiction:0};
    const nli=Object.prototype.hasOwnProperty.call(nliLevels,item?.nli_label)
      ?nliLevels[item.nli_label]:null;
    const narrativeScore=nli===null?baseNarrative:clamp(.35*baseNarrative+.65*nli);
    const eventScore=clamp(actions*7.5);
    return {topic:topical,narrative:narrativeScore,events:eventScore};
  }
  function score(item,raw,availability){
    const cfg=config(raw),s=signals(item);
    // Não penalizar consultas puramente temáticas por não possuírem sinais de
    // narrativa/ações. Disponibilidade é avaliada no conjunto, não por hino.
    const narrativeWeight=availability?.narrative===false?0:cfg.narrative;
    const eventsWeight=availability?.events===false?0:cfg.events;
    const total=cfg.topic+narrativeWeight+eventsWeight;
    if(total===0)return Math.round(clamp(item.relevance_percent));
    return Math.round((s.topic*cfg.topic+s.narrative*narrativeWeight+s.events*eventsWeight)/total);
  }
  function rank(pool,raw){
    const cfg=config(raw);
    if(!Array.isArray(pool))return [];
    const evidence=pool.map(signals);
    const available={narrative:evidence.some(s=>s.narrative>0),events:evidence.some(s=>s.events>0)};
    return pool.map((item,i)=>({...item,tuner_score:score(item,cfg,available),tuner_rank_baseline:i}))
      .filter(item=>item.tuner_score>=cfg.min)
      .sort((a,b)=>b.tuner_score-a.tuner_score||a.tuner_rank_baseline-b.tuner_rank_baseline);
  }
  function history(raw){
    if(!Array.isArray(raw))return [];
    const out=[],seen=new Set();
    for(const item of raw){
      if(typeof item!=='string')continue;
      const text=item.trim().replace(/\s+/g,' ').slice(0,500);
      const id=text.toLocaleLowerCase('pt-BR');
      if(!text||seen.has(id))continue;
      seen.add(id);out.push(text);
      if(out.length===HISTORY_LIMIT)break;
    }
    return out;
  }
  function addHistory(old,query){
    const text=typeof query==='string'?query.trim().replace(/\s+/g,' ').slice(0,500):'';
    return history([text,...history(old)]);
  }
  return {STORAGE_KEY,HISTORY_KEY,LIMIT,HISTORY_LIMIT,presets,config,signals,score,rank,history,addHistory};
});