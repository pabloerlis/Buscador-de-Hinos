'use strict';
/* Agente 9: testes independentes do OfflineAPI real no catálogo fixado.
 * Compara E5 ON/OFF, posições e métricas. Jamais imprime ou grava letras.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const [catalogPath,vectorPath,referencePath]=process.argv.slice(2);
assert.ok(catalogPath&&vectorPath&&referencePath,'Uso: node tests/qa_semantic_search_agent.js catalog.json vectors.json report.json');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const raw=fs.readFileSync(catalogPath),catalog=JSON.parse(raw);
const vectors=JSON.parse(fs.readFileSync(vectorPath,'utf8'));
const reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'qa/semantic-paraphrase-queries.json'),'utf8'));
assert.equal(reference.schema_version,2);
assert.equal(reference.catalog_sha256,crypto.createHash('sha256').update(raw).digest('hex'));
assert.equal(vectors.schema_version,1);
assert.equal(vectors.human_review_status,'pending');
assert.equal(vectors.source_kind,'actual_e5_onnx_inference');
assert.equal(vectors.model_sha256,'4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c');
assert.equal(manifest.human_review_status,'pending');
assert.equal(vectors.queries.length,12);
assert.equal(manifest.queries.length,12);
const targets=[
  ['principal','261'],['principal','067'],['principal','374'],
  ['cia','062'],['cia','063'],['principal','704'],
  ['principal','704'],['principal','310'],['principal','310'],
  ['principal','259'],['principal','286'],['principal','286']
]; // Rótulos provisórios de QA, não regras de ranking.
const names=['semantic-db.json','semantic-bridge.json','semantic-stories.json',
  'scripture-pt.json','bible-graph.json','e5-index.json'];
const data=Object.fromEntries(names.map(n=>[n,JSON.parse(fs.readFileSync(path.join(assets,n),'utf8'))]));
const mem=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{
  req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tx={objectStore(){return {
      get(k){const q={};queueMicrotask(()=>{q.result=mem.get(k);q.onsuccess?.();});return q;},
      put(v,k){mem.set(k,v);queueMicrotask(()=>tx.oncomplete?.());}
    };}};return tx;
  }};req.onsuccess?.();});return req;
}};
const context=vm.createContext({console,crypto:crypto.webcrypto,TextEncoder,indexedDB,
  atob:s=>Buffer.from(s,'base64').toString('binary'),queueMicrotask,setTimeout,clearTimeout,
  window:{indexedDB,NativeVector:{status:()=>true}},
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  fetch:async n=>({ok:Object.hasOwn(data,n),json:async()=>data[n]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(s){
    this.content.textContent=String(s).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');
  }};}}});
for(const n of ['scripture-index.js','semantic-engine.js','story-engine.js',
 'event-frame-engine.js','bridge-engine.js','bible-context.js','bible-graph-engine.js',
 'recommendation-engine.js','vector-index.js','rrf-fusion.js','repertoire-store.js','offline-api.js'])
  vm.runInContext(fs.readFileSync(path.join(assets,n),'utf8'),context,{filename:n});
const api=vm.runInContext('OfflineAPI',context);
function rank(result,target){
  assert.ok(Array.isArray(result._fullRanked),'Ranking não retornado');
  const i=result._fullRanked.findIndex(r=>r.collection_ids?.includes(target[0]) &&
    String(r.number||'').padStart(3,'0')===target[1]);
  return i<0?null:i+1;
}
function metrics(rows,key){
  const n=rows.length,ranks=rows.map(r=>r[key]);
  return {recall_at_10:ranks.filter(r=>r!=null&&r<=10).length/n,
    recall_at_20:ranks.filter(r=>r!=null&&r<=20).length/n,
    ndcg_at_5:ranks.reduce((s,r)=>s+(r!=null&&r<=5?1/Math.log2(r+1):0),0)/n,
    mrr_at_20:ranks.reduce((s,r)=>s+(r!=null&&r<=20?1/r:0),0)/n};
}
(async()=>{
  const imported=await api.request('/api/import',{data:catalog});
  const status=await api.request('/api/status');
  assert.ok(imported.count>=1500&&status.vector_count>=1450,'Catálogo ou índice E5 indisponível');
  const old=reference.current.rows.filter(r=>r.category==='semantic_paraphrase');
  assert.equal(old.length,12);
  const rows=[];
  for(let i=0;i<12;i++){
    const {query,vector}=vectors.queries[i],target=targets[i],prev=old[i];
    assert.equal(query,manifest.queries[i]);
    assert.equal(query,prev.query);
    assert.equal(prev.e5_used,true);
    assert.equal(prev.positives[0].collection,target[0]);
    assert.equal(prev.positives[0].number,target[1]);
    assert.ok(Array.isArray(vector)&&vector.length===384&&vector.every(Number.isFinite),'Vetor inválido');
    assert.ok(Math.abs(Math.hypot(...vector)-1)<.03,'Vetor não normalizado');
    const settings={bibleGraph:true,scripture:true,narratives:true,eventEvidence:true,
      mode:'balanced',strength:75,vectorMode:'off',fusionMode:'rrf',pageSize:10};
    const off=await api.request('/api/search',{query,_forRecommendations:true,settings});
    const on=await api.request('/api/search',{query,_forRecommendations:true,vector_query:vector,
      settings:{...settings,vectorMode:'balanced'}});
    const r0=rank(off,target),r1=rank(on,target);
    assert.equal(r1,prev.positives[0].rank,'Ranking independente divergiu: '+query);
    rows.push({query,collection:target[0],number:target[1],
      rank_without_e5:r0,rank_with_e5:r1});
  }
  const neg=await api.request('/api/search',{query:'Mulher do fluxo de sangue',
    _forRecommendations:true,settings:{bibleGraph:true,scripture:true,narratives:true,
    eventEvidence:true,mode:'balanced',strength:75,vectorMode:'off',fusionMode:'rrf',pageSize:10}});
  const negativeRank=rank(neg,['principal','010']);
  assert.ok(negativeRank===null||negativeRank>10,'Falso positivo narrativo top10');
  const exact=await api.request('/api/search',{query:'hino 261',_forRecommendations:true,
    settings:{mode:'balanced',strength:75,vectorMode:'off',fusionMode:'rrf',pageSize:10}});
  assert.equal(rank(exact,['principal','261']),1,'Número exato regrediu');
  const without=metrics(rows,'rank_without_e5'),with_e5=metrics(rows,'rank_with_e5');
  const changed=rows.filter(r=>r.rank_without_e5!==r.rank_with_e5).length;
  const recovered=rows.filter(r=>r.rank_with_e5!=null&&r.rank_with_e5<=20 &&
    (r.rank_without_e5==null||r.rank_without_e5>20)).length;
  assert.ok(changed>0&&recovered>0,'E5 não recuperou nenhum alvo adicional');
  assert.ok(with_e5.recall_at_10+1e-9>=without.recall_at_10,'E5 piorou Recall@10');
  assert.ok(with_e5.recall_at_20+1e-9>=without.recall_at_20,'E5 piorou Recall@20');
  for(const metric of ['recall_at_10','recall_at_20','ndcg_at_5','mrr_at_20'])
    assert.ok(Math.abs(with_e5[metric]-reference.current.categories.semantic_paraphrase[metric])<1e-8,
      'Métrica diverge do benchmark: '+metric);
  const report={schema_version:1,agent:'9-independent-semantic-search',status:'approved',
    catalog_sha256:reference.catalog_sha256,catalog_count:imported.count,
    cases:12,review_status:'pending',model_sha256:vectors.model_sha256,
    without_e5:without,with_e5,changed_positions:changed,recovered_top20:recovered,
    negative_control_rank:negativeRank,number_exact_rank:1,rows,
    limitations:['12 alvos provisórios ainda não revisados por humanos',
    'Métricas com alvos conhecidos não provam relevância geral',
    'Comparação ON/OFF isola o sinal E5, não uma mudança do algoritmo',
    'Nenhuma letra é incluída no relatório']};
  const out=path.join(root,'qa-report/semantic-search-agent.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log('AGENTE 9 — APROVADO:',JSON.stringify({
    without,with_e5,changed_positions:changed,recovered_top20:recovered}));
})().catch(e=>{console.error('AGENTE 9 — REPROVADO:',e);process.exitCode=1;});
