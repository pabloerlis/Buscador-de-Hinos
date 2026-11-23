'use strict';
const assert=require('node:assert/strict');
const {makeRuntime}=require('./agents/runtime');
const Pool=require('../app/src/main/assets/contextual-retrieval.js');
const songs=Array.from({length:42},(_,i)=>({
  title:String(i+1).padStart(3,'0')+' - Caminho e esperança '+(i+1),
  content:i%3===0?
    'A esperança permanece na caminhada.\nA fé cresce com o tempo.\n\nO cuidado traz confiança.\nA vida recomeça cheia de paz.':
    i%3===1?
      'Ao amanhecer encontramos paz.\nA esperança renova a fé.\n\nA confiança acompanha o coração.\nO amor permanece.':
      'A esperança alcança os que sofrem.\nA fé protege no caminho.\n\nA esperança se renova.\nA alegria continua.'
}));
(async()=>{
 const api=makeRuntime();
 const imported=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs}]});
 assert.equal(imported.count,42);
 const settings={pageSize:10,vectorMode:'off',minAffinity:0};
 const baseline=await api.request('/api/search',{query:'esperança fé',parsed_query:true,settings});
 const prev=JSON.stringify(baseline.results.map(h=>h.id));
 const p2=await api.request('/api/contextual/candidates',{query:'esperança fé',parsed_query:true,settings,limit:50});
 assert.equal(p2.retrieval_mode,'full_catalog_multi_strategy');
 assert.equal(p2.semantic_judgment,'NOT_VERIFIED');
 assert.equal(p2.default_ranking_changed,false);
 assert.equal(p2.vector_query_included,false);
 assert.equal(p2.strategies.length,4);
 assert.ok(p2.count>0&&p2.count<=50);
 assert.deepEqual(Array.from(p2.candidates.slice(0,10),x=>x.hymn_id),
  Array.from(baseline.results.slice(0,10),h=>h.id));
 assert.ok(p2.candidates.some(x=>x.outside_baseline_top10),
   'Must not be limited to visible page');
 assert.ok(p2.candidates.every(x=>x.source_status==='unjudged_not_verified'));
 assert.ok(p2.candidates.every(x=>Number.isSafeInteger(x.hymn_id)&&x.hymn_id>=1));
 assert.ok(p2.candidates.every(x=>!('lyrics' in x)&&!('snippet' in x)&&!('reason' in x)));
 assert.ok(!JSON.stringify(p2).includes('A vida recomeça cheia de paz'),
   'No license text can leak from the candidate endpoint');
 const after=await api.request('/api/search',{query:'esperança fé',parsed_query:true,settings});
 assert.equal(JSON.stringify(after.results.map(h=>h.id)),prev,
   'Contextual retrieval must not alter baseline ranking');
 const selected=Pool.selectForInspection(p2.candidates);
 assert.ok(selected.length<=5&&selected.length>0);
 assert.equal(new Set(selected.map(x=>x.hymn_id)).size,selected.length);
 assert.equal(selected[0].hymn_id,p2.candidates[0].hymn_id);
 assert.equal(selected[1].hymn_id,p2.candidates[1].hymn_id);
 assert.throws(()=>Pool.selectForInspection('not-an-array'),/inválidos/);
 const idSearch=await api.request('/api/contextual/candidates',{query:'Hino 002',settings});
 assert.deepEqual([...idSearch.strategies],['baseline']);
 assert.ok(idSearch.candidates.every(x=>String(x.number)==='002'));
 const exactTitle=await api.request('/api/contextual/candidates',{query:'Caminho e esperança 5',settings});
 assert.deepEqual([...exactTitle.strategies],['baseline']);
 const unavailable=baseline.results[0].id;
 await api.request('/api/repertoire/mark',{hymn_id:unavailable,not_learned:true});
 const filtered=await api.request('/api/contextual/candidates',{query:'esperança fé',settings});
 assert.ok(!filtered.candidates.some(x=>x.hymn_id===unavailable),'Exclude not-learned songs');
 const scoped=await api.request('/api/contextual/candidates',{
  query:'esperança fé',settings:{...settings,collections:{principal:false,avulsos:true,cia:false,pessoal:false}}
 });
 assert.equal(scoped.candidates.length,0);
 await assert.rejects(()=>api.request('/api/contextual/candidates',{query:' '.repeat(3),settings}),/inválida/);
 console.log('CONTEXTUAL P2 API PASS: full catalog, source ranks, filters, top10, exact ID/title, no lyrics and unchanged baseline.');
})().catch(e=>{console.error(e);process.exitCode=1;});
