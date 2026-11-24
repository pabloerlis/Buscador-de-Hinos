'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const assets=path.join(__dirname,'../app/src/main/assets');
const sha=s=>createHash('sha256').update(s).digest('hex');
const fingerprint=(title,lyrics)=>sha((title+'|'+lyrics).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase()).slice(0,24);
const model='harrier-600m-q4f16',revision='dbaf6767003608562dd5b744bc443656a29c45bd',repo='onnx-community/harrier-oss-v1-0.6b-ONNX',catalog='da8e75932982123301affce688e45b4152c9e06e',schema='harrier-hymn-index-v1',sourceSha='a'.repeat(64);
const songs=[{title:'001 - Aurora',content:'Paz na manhã.'},{title:'002 - Horizonte',content:'Caminho pela estrada.'},{title:'003 - Lago',content:'Paz perto da água.'}];
const makeVector=(axis,value=127)=>{const b=Buffer.alloc(1024);b.writeInt8(value,axis);return b.toString('base64');};
const records=songs.map((h,i)=>({f:fingerprint(h.title.slice(6),h.content),v:[makeVector(i===1?1:0,i===2?-127:127)]}));
const indexText=JSON.stringify({schema,model:repo,revision,variant:'q4f16',dimension:1024,quantization:'symmetric-int8-l2-renormalize',catalog_revision:catalog,catalog_sha256:sourceSha,count:records.length,records});
const manifest={schema,model:{repo,revision,variant:'q4f16',dimension:1024,runtime:'1.31.1',pooling:'sentence_embedding',normalization:'L2'},catalog:{revision:catalog,sha256:sourceSha},index:{sha256:sha(indexText),bytes:Buffer.byteLength(indexText),count:records.length,segments:records.length}};
let ready=false,corrupt=false;const mem=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx={objectStore(){return {get(key){const r={};queueMicrotask(()=>{r.result=mem.get(key);r.onsuccess?.();});return r;},put(value,key){mem.set(key,value);queueMicrotask(()=>tx.oncomplete?.());}};}};return tx;}};req.onsuccess();});return req;}};
const window={indexedDB,NativeHarrierPackage:{status:()=>JSON.stringify({ready})}};
const ctx=vm.createContext({window,indexedDB,console,crypto:webcrypto,TextEncoder,atob,setTimeout,clearTimeout,queueMicrotask,
 localStorage:{getItem:key=>prefs.get(key)||null,setItem:(key,v)=>prefs.set(key,v)},
 document:{createElement(){return {content:{textContent:''},set innerHTML(v){this.content.textContent=String(v).replace(/<[^>]+>/g,'');}};}},
 fetch:async url=>url==='/harrier/manifest.json'?{ok:true,json:async()=>manifest}:url==='/harrier/index.json'?{ok:true,text:async()=>indexText+(corrupt?' ':'')}:{
   ok:fs.existsSync(path.join(assets,url)),json:async()=>JSON.parse(fs.readFileSync(path.join(assets,url),'utf8'))}
});
for(const p of ['semantic-engine.js','story-engine.js','scripture-index.js','bible-graph-engine.js','bible-context.js','bridge-engine.js','repertoire-store.js','context-ranker.js','lexical-pt.js','harrier-index.js','vector-index.js','offline-api.js']){
 vm.runInContext(fs.readFileSync(path.join(assets,p),'utf8'),ctx,{filename:p});
}
const api=vm.runInContext('OfflineAPI',ctx);
const q=Array(1024).fill(0);q[0]=1;
const search=(overrides={})=>api.request('/api/search',{query:'xilofonista',vector_query:q,vector_model:model,settings:{vectorMode:'balanced',pageSize:5},...overrides});
(async()=>{
 await api.request('/api/import',{data:[{name:'Coletânea 2018',songs}]});
 assert.equal((await search()).vector_evaluated,false);
 ready=true;
 assert.equal((await api.request('/api/vector/refresh')).count,3);
 const actual=await search();
 assert.equal(actual.vector_evaluated,true);
 assert.ok(actual.vector_contributors>0);
 assert.equal(actual.results[0].number,'001');
 assert.ok(actual.results[0].vector_points>0);
 assert.equal(actual.vector_page_contributors,1);
 for(const overrides of [{vector_model:'e5'},{vector_query:Array(384).fill(1)},{settings:{vectorMode:'off'}},{settings:{vectorMode:'balanced',mode:'literal'}},{query:'001'},{query:'João 3:16'},{query:'"Paz"'}]){
   assert.equal((await search(overrides)).vector_evaluated,false,JSON.stringify(overrides));
 }
 const filtered=await search({term_filters:[{term:'estrada',field:'lyrics',kind:'require'}]});
 assert.equal(filtered.vector_contributors,0);
 assert.ok(filtered.results.every(h=>h.number==='002'));
 const excluded=await search({term_filters:[{term:'paz',field:'lyrics',kind:'exclude'}]});
 assert.equal(excluded.vector_contributors,0);
 assert.ok(excluded.results.every(h=>h.number==='002'));
 ready=false;
 assert.equal((await search()).vector_evaluated,false);
 ready=true;corrupt=true;
 assert.equal((await api.request('/api/vector/refresh')).ready,false);
 assert.equal((await search()).vector_evaluated,false);
 corrupt=false;
 assert.equal((await api.request('/api/vector/refresh')).count,3);
 await api.request('/api/vector/clear');
 assert.equal((await search()).vector_evaluated,false);
 console.log('Harrier ranking: contribuição real, 1024D, filtros, modos, referência bíblica, integridade e fallback aprovados (vetores de fixture).');
})().catch(e=>{console.error(e);process.exitCode=1;});
