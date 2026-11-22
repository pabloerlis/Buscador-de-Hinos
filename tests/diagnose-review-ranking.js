'use strict';
/* QA do pipeline real: a coletânea pública que o Android importa precisa
   casar com os fingerprints do índice E5 que será empacotado no mesmo APK. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const file=process.argv[2];
assert.ok(file&&fs.existsSync(file),'Informe a mesma edição usada pelo aplicativo.');
const root=path.resolve(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=JSON.parse(fs.readFileSync('qa/e5-index-golden.json','utf8'));
const src=fs.readFileSync(file);
assert.equal(crypto.createHash('sha256').update(src).digest('hex'),index.source_sha256,
  'O arquivo de importação não corresponde ao usado para gerar os embeddings');
const sources=Object.fromEntries(['semantic-db.json','semantic-bridge.json','semantic-stories.json',
  'scripture-pt.json','bible-graph.json','e5-index.json'].filter(x=>fs.existsSync(path.join(root,x)))
  .map(name=>[name,JSON.parse(read(name))]));
const store=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{
  req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tr={objectStore(){return {
      get(key){const res={};queueMicrotask(()=>{res.result=store.get(key);res.onsuccess?.();});return res;},
      put(value,key){store.set(key,value);queueMicrotask(()=>tr.oncomplete?.());}
    };}};return tr;
  }};
  req.onsuccess?.();
});return req;}};
const context=vm.createContext({console,window:{indexedDB,NativeVector:{status:()=>true}},indexedDB,
  setTimeout,clearTimeout,queueMicrotask,TextEncoder,crypto:crypto.webcrypto,
  atob:x=>Buffer.from(x,'base64').toString('binary'),
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  fetch:async name=>({ok:Object.hasOwn(sources,name),json:async()=>sources[name]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(v){
    this.content.textContent=String(v).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'');
  }};}}});
for(const name of ['scripture-index.js','semantic-engine.js','story-engine.js','bridge-engine.js',
  'bible-context.js','bible-graph-engine.js','recommendation-engine.js','vector-index.js',
  'event-frame-engine.js','rrf-fusion.js','repertoire-store.js','offline-api.js','local-hymn-ai.js'])
  vm.runInContext(read(name),context,{filename:name});
const request=vm.runInContext('OfflineAPI.request',context);
(async()=>{
  const imported=await request('/api/import',{data:JSON.parse(src)});

  assert.ok(imported.count>=1500,'Coletânea incompleta');
  const query='Filho Pródigo';
  const result=await request('/api/search',{query,settings:{vectorMode:'off'}, _forRecommendations:true});
  const toRow=(hit,i)=>({rank:i+1,number:hit.number,collection:hit.collection_ids,
    type:hit.match_type,score:hit.relevance_score});
  const tracked=result._fullRanked.map(toRow).filter(hit=>hit.collection.includes('principal')&&[191,264,286].includes(Number(hit.number)));
  const selected=result.results.slice(0,4);
  const lyrics=new Map(await Promise.all(selected.map(async hit=>[hit.id,(await request('/api/hymns/'+hit.id)).lyrics])));
  const ai=vm.runInContext('LocalHymnAI',context);
  const review=ai.prepareReview(query,lyrics,selected,{context:result.ai_context});
  assert.equal(review.requests.length,4);
  const before=selected.map(toRow);
  for(const [i,item] of review.requests.entries()){
    fs.writeFileSync('/tmp/hinos-review/input-'+i+'.txt',item.prompt);
    fs.writeFileSync('/tmp/hinos-review/grammar-'+i+'.txt',item.grammar);
  }
  fs.writeFileSync('/tmp/hinos-review/before.json',JSON.stringify(before)+'\n');
  console.log(JSON.stringify({query,count:result.total,reference:result.bible_reference,
    skip_e5_in_ui:Boolean(result.bible_reference),top10:result.results.slice(0,10).map(toRow),tracked}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
