'use strict';
/* Agent 10: independent cross-version gate. Recomputes metrics; fail-closed.
 * No lyrics, no artificial labels, no exception for a specific hymn/story.
 */
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const valid=r=>r===null||(Number.isSafeInteger(r)&&r>0);
const top=(r,n)=>r!==null&&r<=n;
function calculate(rows,field){
 const ranks=rows.map(r=>r[field]),n=ranks.length;
 return {recall_at_10:ranks.filter(r=>top(r,10)).length/n,
 recall_at_20:ranks.filter(r=>top(r,20)).length/n,
 ndcg_at_5:ranks.reduce((s,r)=>s+(top(r,5)?1/Math.log2(r+1):0),0)/n,
 mrr_at_20:ranks.reduce((s,r)=>s+(top(r,20)?1/r:0),0)/n};
}
function inspect(report,baseline){
 const errors=[],warnings=[],changes=[];
 const check=(ok,msg)=>{if(!ok)errors.push(msg);};
 check(baseline.schema_version===1&&baseline.status==='locked','Baseline not locked');
 check(report.schema_version===1&&report.agent==='9-independent-semantic-search'&&report.status==='approved','Agent 9 did not approve');
 check(report.review_status==='pending'&&baseline.human_review_status==='pending','Human-review status unverified');
 check(report.catalog_sha256===baseline.catalog_sha256,'Catalog digest mismatch');
 check(report.model_sha256===baseline.model_sha256,'E5 model digest mismatch');
 const rows=Array.isArray(report.rows)?report.rows:[];
 check(report.cases===12&&rows.length===12&&baseline.rows.length===12,'Missing/extra semantic probes');
 if(rows.length===12&&baseline.rows.length===12){
  for(let i=0;i<12;i++){
   const row=rows[i]||{},prior=baseline.rows[i];
   check(typeof row.query==='string'&&hash(row.query||'')===prior.query_sha256,'Query changed #'+(i+1));
   check(row.collection===prior.collection&&row.number===prior.number,'Target changed #'+(i+1));
   check(valid(row.rank_with_e5)&&valid(row.rank_without_e5),'Invalid rank #'+(i+1));
   const old=prior.rank_with_e5,next=row.rank_with_e5;
   const loss10=top(old,10)&&!top(next,10),loss20=top(old,20)&&!top(next,20);
   if(loss10)errors.push('Lost top10 #'+(i+1));
   if(loss20)errors.push('Lost top20 #'+(i+1));
   changes.push({index:i+1,collection:prior.collection,number:prior.number,from:old,to:next,top10_loss:loss10,top20_loss:loss20});
  }
  if(rows.every(r=>valid(r.rank_with_e5)&&valid(r.rank_without_e5))){
   for(const [field,key] of [['rank_without_e5','without_e5'],['rank_with_e5','with_e5']]){
    const observed=calculate(rows,field),declared=report[key]||{};
    for(const [metric,value] of Object.entries(observed))
     check(Number.isFinite(declared[metric])&&Math.abs(value-declared[metric])<1e-9,'Inconsistent agent 9 '+key+'/'+metric);
    if(key==='with_e5') for(const [metric,lower] of Object.entries(baseline.with_e5))
     check(observed[metric]+1e-9>=lower,'Regression '+metric+': '+observed[metric].toFixed(6)+' < '+lower.toFixed(6));
   }
  }
 }
 check(report.negative_control_rank===null||(valid(report.negative_control_rank)&&report.negative_control_rank>10),'Narrative false positive top10');
 check(report.number_exact_rank===1,'Exact-number lookup lost rank1');
 warnings.push('12 provisional targets; no 50 independent blind human relevance judgments');
 return {schema_version:1,agent:'10-semantic-crossversion-qa',decision:errors.length?'rejected':'approved',
  baseline_version:baseline.version,baseline_run_id:baseline.run_id,evaluated_cases:rows.length,
  catalog_sha256:report.catalog_sha256,model_sha256:report.model_sha256,
  baseline_metrics:baseline.with_e5,current_metrics:rows.length===12&&rows.every(r=>valid(r.rank_with_e5))?calculate(rows,'rank_with_e5'):null,
  changes,errors,warnings};
}
if(require.main===module){
 const source=process.argv[2]||path.join(root,'qa-report/semantic-search-agent.json');
 const base=process.argv[3]||path.join(root,'qa/semantic-crossversion-baseline.json');
 const output=process.argv[4]||path.join(root,'qa-report/semantic-crossversion-agent.json');
 const result=inspect(JSON.parse(fs.readFileSync(source,'utf8')),JSON.parse(fs.readFileSync(base,'utf8')));
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log('AGENT 10: '+result.decision.toUpperCase()+' ('+result.errors.length+' errors)');
 if(result.errors.length){result.errors.forEach(e=>console.error(e));process.exitCode=1;}
}
module.exports={inspect,calculate};