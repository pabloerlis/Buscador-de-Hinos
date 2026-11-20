'use strict';
/* Compara o ranking real do aplicativo COM e SEM E5, nas mesmas buscas,
   com as mesmas letras, filtros e consulta. Evita medir apenas cossenos. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const assert=require('node:assert/strict');
const corpusPath=process.argv[2],vectorsPath=process.argv[3];
assert.ok(corpusPath&&vectorsPath,'Uso: node tests/qa_e5_hybrid.js catalogo.json e5-query-vectors.json');
const assets=path.join(__dirname,'../app/src/main/assets');
const read=x=>fs.readFileSync(path.join(assets,x),'utf8');
const sources=Object.fromEntries(['semantic-db.json','semantic-bridge.json','semantic-stories.json',
  'scripture-pt.json','bible-graph.json','e5-index.json'].filter(n=>fs.existsSync(path.join(assets,n)))
  .map(n=>[n,JSON.parse(read(n))]));
const store=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{
  req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tr={objectStore(){return {
      get(k){const x={};queueMicrotask(()=>{x.result=store.get(k);x.onsuccess?.();});return x;},
      put(v,k){store.set(k,v);queueMicrotask(()=>tr.oncomplete?.());}
    };}};return tr;
  }};
  req.onsuccess?.();
});return req;}};
const context=vm.createContext({console,window:{indexedDB,NativeVector:{status:()=>true}},
  indexedDB,setTimeout,clearTimeout,queueMicrotask,crypto:crypto.webcrypto,TextEncoder,
  atob:s=>Buffer.from(s,'base64').toString('binary'),
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  fetch:async n=>({ok:Object.hasOwn(sources,n),json:async()=>sources[n]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(v){
    this.content.textContent=String(v).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');
  }};}}});
for(const file of ['scripture-index.js','semantic-engine.js','story-engine.js','bridge-engine.js',
 'bible-context.js','bible-graph-engine.js','recommendation-engine.js','vector-index.js',
 'repertoire-store.js','rrf-fusion.js','offline-api.js'])vm.runInContext(read(file),context,{filename:file});
const request=vm.runInContext('OfflineAPI.request',context);
const cases=JSON.parse(fs.readFileSync(vectorsPath,'utf8'));
assert.ok(cases.length>=7,'Benchmark de consultas reais muito pequeno');
const rank=(result,item)=>{
  const i=result._fullRanked.findIndex(hit=>hit.collection_ids?.includes(item.collection)&&
    String(hit.number||'').padStart(3,'0')===item.number);
  return i<0?null:i+1;
};
const ndcg5=r=>r&&r<=5?1/Math.log2(r+1):0;
(async()=>{
  const catalog=JSON.parse(fs.readFileSync(corpusPath,'utf8'));
  const imported=await request('/api/import',{data:catalog});
  const status=await request('/api/status');
  assert.ok(imported.count>=1500&&status.vector_count>=1450,
    'O E5 precisa estar ativo no catálogo real antes da avaliação híbrida');
  const results=[];
  for(const item of cases){
    const payload={query:item.query,page:1,_forRecommendations:true,
      settings:{mode:'balanced',strength:75,vectorMode:'off',pageSize:10}};
    const plain=await request('/api/search',payload);
    const legacy=await request('/api/search',{...payload,vector_query:item.vector,
      settings:{...payload.settings,vectorMode:'balanced',fusionMode:'legacy'}});
    const hybrid=await request('/api/search',{...payload,vector_query:item.vector,
      settings:{...payload.settings,vectorMode:'balanced',fusionMode:'rrf'}});
    results.push({query:item.query,target:item.collection+':'+item.number,
      without_e5:rank(plain,item),with_legacy_e5:rank(legacy,item),with_e5:rank(hybrid,item),
      top_without:plain._fullRanked.slice(0,3).map(x=>x.number),
      top_legacy:legacy._fullRanked.slice(0,3).map(x=>x.number),
      top_with:hybrid._fullRanked.slice(0,3).map(x=>x.number)});
  }
  const rec20=(k)=>results.filter(x=>x[k]!=null&&x[k]<=20).length/results.length;
  const ndcg=(k)=>results.reduce((a,x)=>a+ndcg5(x[k]),0)/results.length;
  const baseline={recall_at_20:rec20('without_e5'),ndcg_at_5:ndcg('without_e5')};
  const additive={recall_at_20:rec20('with_legacy_e5'),ndcg_at_5:ndcg('with_legacy_e5')};
  const enabled={recall_at_20:rec20('with_e5'),ndcg_at_5:ndcg('with_e5')};
  const report={schema_version:2,count:results.length,baseline,additive,rrf:enabled,cases:results};
  fs.writeFileSync(path.join(__dirname,'../qa-report/e5-hybrid.json'),JSON.stringify(report,null,2)+'\n');
  console.log('AGENTE E5 — RANKING HÍBRIDO '+JSON.stringify(report));
  // Um encoder experimental não pode derrubar resultados previamente bons.
  assert.ok(enabled.recall_at_20+1e-9>=baseline.recall_at_20-1/results.length,
    'E5 reduziu a recuperação de histórias no top 20: '+JSON.stringify({baseline,enabled}));
  assert.ok(enabled.ndcg_at_5>=baseline.ndcg_at_5-.12,
    'E5 reduziu excessivamente a precisão dos primeiros resultados: '+JSON.stringify({baseline,enabled}));
  // Comparação direta com a versão anterior usando o MESMO vetor de consulta.
  assert.ok(enabled.ndcg_at_5>=additive.ndcg_at_5-.025,
    'RRF prejudicou o ranking E5 anterior: '+JSON.stringify({additive,enabled}));
  assert.ok(enabled.recall_at_20>=additive.recall_at_20-1/results.length,
    'RRF perdeu mais de um alvo do top20: '+JSON.stringify({additive,enabled}));
})().catch(e=>{console.error(e);process.exitCode=1;});
