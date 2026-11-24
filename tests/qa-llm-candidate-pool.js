'use strict';
// Retrieval only; no relevance targets are read. Lyrics are written to a temporary
// file for local model inference and must never be published as CI artifacts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [catalogPath,queryPath,outPath]=process.argv.slice(2);
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const raw=fs.readFileSync(catalogPath),catalog=JSON.parse(raw);
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'57d42fb0bcc881a62b210dd1a3972822d2c39856f7a01278e104d407bf1b747a');
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


const index=vm.runInContext('VectorIndex',context);
(async()=>{
 const imported=await api.request('/api/import',{data:catalog});
 const status=await api.request('/api/status');
 assert.equal(imported.count,1557);assert.ok(status.vector_count>=1450);
 const input=JSON.parse(fs.readFileSync(queryPath,'utf8')),results=[];
 const settings={bibleGraph:true,scripture:true,narratives:true,eventEvidence:true,mode:'balanced',strength:75,vectorMode:'balanced',fusionMode:'rrf',pageSize:10};
 for(const item of input){
  const channels=[],hits=new Map();
  for(const form of item.forms){
   const payload={query:form.text,_forRecommendations:true,settings};
   for(const [kind,vector,limit] of [['context',null,10],['hybrid',form.vector,8]]){
    if(kind==='hybrid'&&!vector)continue;
    const found=await api.request('/api/search',{...payload,...(vector?{vector_query:vector}:{})});
    const list=found._fullRanked.slice(0,limit);
    channels.push(list.map(h=>h.id));for(const h of list)hits.set(h.id,h);
   }
   if(form.vector)channels.push(index.topForQuery(form.vector,12).map(h=>h.id));
  }
  // Equal RRF over genuinely independent sources. Reserve the first three of
  // every channel before filling by fusion, so one retrieval path cannot
  // suppress candidates from the others. No known answer is injected.
  const scores=new Map();const reserved=new Set();
  for(const list of channels){list.forEach((id,i)=>scores.set(id,(scores.get(id)||0)+1/(20+i+1)));list.slice(0,3).forEach(id=>reserved.add(id));}
  const ordered=[...scores.keys()].sort((a,b)=>scores.get(b)-scores.get(a)||a-b);
  const ids=[...new Set([...ordered.filter(id=>reserved.has(id)),...ordered])].slice(0,30);
  const candidates=[];
  for(const id of ids){
   const h=await api.request('/api/hymns/'+id);
   const hit=hits.get(id)||h;
   assert.ok(h.lyrics&&h.title);
   candidates.push({id,number:hit.number||h.number||null,title:h.title,collection:hit.collection||h.collection,collection_ids:hit.collection_ids||h.collection_ids||[],lyrics:h.lyrics});
  }
  results.push({query:item.query,candidates});
 }
 fs.writeFileSync(outPath,JSON.stringify(results),{mode:0o600});
})().catch(e=>{console.error('Retrieval failed:',e.message);process.exitCode=1;});
