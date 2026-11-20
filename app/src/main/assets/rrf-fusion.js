'use strict';
/* Reciprocal Rank Fusion (RRF) offline.
 * Combina ordenações independentes por POSIÇÃO, sem fingir que cossenos,
 * pontuações lexicais e evidências bíblicas compartilham a mesma escala.
 * k=60 segue o valor normalmente usado para RRF em recuperação híbrida.
 * Uma só fonte disponível => mantém sua ordem original (fallback exato).
 */
const FusionRRF=(()=>{
  const K=60;
  const MAX_LANE=140;
  const weights=Object.freeze({
    baseline:4.0,
    lexical:0.8,
    semantic:0.55,
    biblical:1.1,
    narrative:1.2,
    vector:0.8
  });
  function safeScore(x){return typeof x==='number'&&Number.isFinite(x)?x:0;}
  function rankedLane(candidates,key){
    return candidates.filter(x=>safeScore(x._fusionSignals?.[key])>0)
      .sort((a,b)=>safeScore(b._fusionSignals?.[key])-safeScore(a._fusionSignals?.[key])||a.id-b.id)
      .slice(0,MAX_LANE);
  }
  function positions(items,k=K){
    const map=new Map();
    for(let i=0;i<items.length;i++){
      const id=items[i]?.id;
      if(id===undefined||id===null||map.has(id))continue;
      map.set(id,1/(k+i+1));
    }
    return map;
  }
  function rank(candidates,{vectorMode='balanced',narrativePrimary=false}={}){
    if(!Array.isArray(candidates)||candidates.length<2)return candidates;
    const vector=rankedLane(candidates,'vector');
    if(!vector.length)return candidates; // Sem vetor válido: comportamento legado.
    const lanes=[
      {name:'baseline',weight:weights.baseline,items:candidates},
      {name:'lexical',weight:weights.lexical,items:rankedLane(candidates,'lexical')},
      {name:'semantic',weight:weights.semantic,items:rankedLane(candidates,'semantic')},
      {name:'biblical',weight:weights.biblical,items:rankedLane(candidates,'biblical')},
      {name:'narrative',weight:weights.narrative,items:rankedLane(candidates,'narrative')},
      {name:'vector',weight:weights.vector*(vectorMode==='strong'?1.35:1),items:vector}
    ].filter(lane=>lane.items.length>0);
    const totals=new Map(candidates.map(c=>[c.id,0]));
    for(const lane of lanes){
      const rankScores=positions(lane.items);
      for(const [id,score] of rankScores)
        totals.set(id,(totals.get(id)||0)+lane.weight*score);
    }
    const baselineOrder=new Map(candidates.map((x,i)=>[x.id,i]));
    // O título exato é intenção inequívoca: não pode ser superado por semântica.
    // Narrativas reconhecidas usam a evidência evento/ação como faixa prioritária.
    return candidates.slice().sort((a,b)=>
      Number(b.match_type==='titulo_exato')-Number(a.match_type==='titulo_exato')||
      (narrativePrimary?(safeScore(b._narrativeTier)-safeScore(a._narrativeTier)):0)||
      (totals.get(b.id)||0)-(totals.get(a.id)||0)||
      baselineOrder.get(a.id)-baselineOrder.get(b.id));
  }
  return {rank,positions,weights,K};
})();
