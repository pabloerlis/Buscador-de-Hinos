'use strict';
/* Runtime P2: full-catalog candidate pool. Neither classification nor validation. */
const ContextualRetrieval=(()=>{
const MODES=['baseline','context','literal','legacy'];
const LIMIT=60;
const PER_SOURCE=50;
function idOf(row){
  const id=Number(row?.id);
  if(!Number.isSafeInteger(id)||id<1)throw Error('ID de candidato inválido');
  return id;
}
function buildPool(variants,{limit=LIMIT,excludedIds=[],pageSize=5}={}){
  if(!variants||typeof variants!=='object'||Array.isArray(variants)||
    !Array.isArray(variants.baseline)||variants.baseline.length>10000||
    !Number.isSafeInteger(limit)||limit<10||limit>100||
    !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>10)
    throw Error('Fontes ou limites inválidos');
  const blocked=new Set(excludedIds.map(Number));
  if([...blocked].some(id=>!Number.isSafeInteger(id)||id<1))
    throw Error('Exclusão inválida');
  const normalized=new Map();
  for(const mode of MODES){
    if(variants[mode]===undefined)continue;
    const source=variants[mode];
    if(!Array.isArray(source)||source.length>10000)throw Error('Fonte inválida: '+mode);
    const seen=new Set(),ids=[];
    for(const row of source){
      const id=idOf(row);
      if(seen.has(id))throw Error('Ranking duplicado: '+mode);
      seen.add(id);
      if(!blocked.has(id))ids.push(id);
    }
    normalized.set(mode,ids);
  }
  const baseline=normalized.get('baseline');
  const ranks=new Map();
  for(const [name,items] of normalized)
    items.forEach((id,index)=>{
      const prior=ranks.get(id)||{};
      prior[name]=index+1;ranks.set(id,prior);
    });
  const picked=[],chosen=new Set();
  const add=id=>{
    if(id!==undefined&&!chosen.has(id)&&picked.length<limit){
      chosen.add(id);picked.push(id);
    }
  };
  // Preserve known-good baseline candidates in their existing relative order.
  baseline.slice(0,10).forEach(add);
  // Diversified round-robin; no score mixing or claim of semantic relevance.
  for(let depth=0;depth<PER_SOURCE&&picked.length<limit;depth++){
    for(const mode of MODES){
      const ids=normalized.get(mode);
      if(ids&&depth<ids.length)add(ids[depth]);
    }
  }
  const baseSet=new Set(baseline);
  const visible=new Set(baseline.slice(0,pageSize));
  const firstTen=new Set(baseline.slice(0,10));
  const records=picked.map((id,index)=>({
    hymn_id:id,position:index+1,
    baseline_position:ranks.get(id)?.baseline??null,
    source_positions:ranks.get(id),
    outside_visible_page:!visible.has(id),
    outside_baseline_top10:!firstTen.has(id),
    novel_vs_baseline_full:!baseSet.has(id),
    review_status:'unjudged_candidate'
  }));
  const protectedCount=Math.min(10,baseline.length,limit);
  if(records.slice(0,protectedCount).some((x,i)=>x.hymn_id!==baseline[i]))
    throw Error('Invariante de proteção do baseline violada');
  return {
    schema_version:1,
    comparison_mode:'shadow_only_no_production_change',
    not_a_relevance_metric:true,
    baseline_count:baseline.length,
    returned_count:records.length,
    protected_top10:protectedCount,
    beyond_visible_page:records.filter(x=>x.outside_visible_page).length,
    beyond_baseline_top10:records.filter(x=>x.outside_baseline_top10).length,
    novel_vs_baseline_full:records.filter(x=>x.novel_vs_baseline_full).length,
    candidates:records
  };
}
function selectForInspection(candidates,limit=5){
  if(!Array.isArray(candidates)||!Number.isInteger(limit)||limit<1||limit>5)
    throw Error('Candidatos inválidos');
  const ids=new Set(),picked=[];
  const add=record=>{
    if(!record||!Number.isSafeInteger(record.hymn_id)||record.hymn_id<1||
      ids.has(record.hymn_id)||picked.length>=limit)return;
    ids.add(record.hymn_id);picked.push(record);
  };
  candidates.slice(0,2).forEach(add);
  add(candidates.find(x=>x.novel_vs_baseline_full));
  add(candidates.find(x=>x.outside_baseline_top10&&x.source_positions?.context));
  add(candidates.find(x=>x.outside_baseline_top10));
  candidates.forEach(add);
  return picked;
}
return {MODES,buildPool,selectForInspection};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ContextualRetrieval;
