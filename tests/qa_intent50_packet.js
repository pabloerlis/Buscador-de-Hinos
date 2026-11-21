'use strict';
/* Create genuinely blind, score-free 50-intent review packets from OfflineAPI,
 * with real E5 embeddings. This step DOES NOT assign relevance judgments.
 * Lyrics are never printed, written to QA artifacts, or packaged in the APK.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const [catalogPath,vectorPath]=process.argv.slice(2);
assert.ok(catalogPath&&vectorPath,'Usage: node tests/qa_intent50_packet.js catalog.json intent50-vectors.json');
const sourceBytes=fs.readFileSync(path.join(root,'qa/semantic-intents-50.json'));
const manifest=JSON.parse(sourceBytes);
const catalogBytes=fs.readFileSync(catalogPath),catalog=JSON.parse(catalogBytes);
const vectors=JSON.parse(fs.readFileSync(vectorPath,'utf8'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
assert.equal(manifest.schema_version,1);
assert.equal(manifest.intents.length,50);
assert.equal(vectors.source_kind,'actual_e5_onnx_inference');
assert.equal(vectors.review_status,'pending');
assert.equal(vectors.manifest_sha256,hash(sourceBytes));
assert.equal(vectors.model_sha256,'ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1');
assert.equal(vectors.vectors.length,50);
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
 }};req.onsuccess?.();});return req;}};
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
const settings={bibleGraph:true,scripture:true,narratives:true,eventEvidence:true,
 mode:'balanced',strength:75,vectorMode:'off',fusionMode:'rrf',pageSize:20};
function canonical(song){
 const ids=Array.isArray(song.collection_ids)?[...song.collection_ids].map(String).sort():[];
 const title=String(song.title||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,180);
 const number=String(song.number??'');
 const identity=JSON.stringify([String(song.id??''),number,ids,title]);
 return {blind_id:hash(identity).slice(0,24),title,collection:ids,number};
}
function pick20(result){
 assert.ok(Array.isArray(result._fullRanked)&&result._fullRanked.length>=20,
  'Real OfflineAPI did not return 20 candidates');
 const items=result._fullRanked.slice(0,20).map(canonical);
 assert.equal(new Set(items.map(x=>x.blind_id)).size,20,'Ranking duplicates');
 assert.ok(items.every(x=>x.title.length>0&&x.title.length<=180),'No title');
 return items;
}
function shuffle(items){
 const out=[...items];
 for(let i=out.length-1;i>0;i--){const j=crypto.randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}
 return out;
}
(async()=>{
 const imported=await api.request('/api/import',{data:catalog});
 const status=await api.request('/api/status');
 assert.ok(imported.count>=1500&&status.vector_count>=1450,'Real E5 index or catalog missing');
 const packetRows=[],sealedRows=[];
 for(let i=0;i<50;i++){
  const item=manifest.intents[i],vec=vectors.vectors[i];
  assert.equal(vec.id,item.id,'Vector/query identity changed');
  assert.ok(Array.isArray(vec.vector)&&vec.vector.length===384&&vec.vector.every(Number.isFinite));
  const norm=Math.hypot(...vec.vector);assert.ok(norm>.97&&norm<1.03);
  const off=pick20(await api.request('/api/search',{query:item.query,_forRecommendations:true,
   settings}));
  const on=pick20(await api.request('/api/search',{query:item.query,_forRecommendations:true,
   vector_query:vec.vector,settings:{...settings,vectorMode:'balanced'}}));
  const pool=new Map([...off,...on].map(c=>[c.blind_id,c]));
  assert.ok(pool.size>=20&&pool.size<=40);
  const ordered=shuffle([...pool.values()]);
  packetRows.push({id:item.id,category:item.category,split:item.split,query:item.query,
   candidates:ordered});
  sealedRows.push({id:item.id,without_e5:off.map(c=>c.blind_id),
   with_e5:on.map(c=>c.blind_id)});
 }
 const metadata={schema_version:1,manifest_sha256:hash(sourceBytes),
  catalog_sha256:hash(catalogBytes),model_sha256:vectors.model_sha256,
  intent_count:50,human_review_status:'pending'};
 const packet={...metadata,kind:'blind_review_packet',rows:packetRows,
  instructions:'Judge each candidate by inspecting the locally imported hymn, independently of score, rank, and search variant. relevant/partially_relevant/not_relevant/unknown; do not commit lyrics.'};
 const sealed={...metadata,kind:'sealed_retrieval_ranks',rows:sealedRows};
 const out=path.join(root,'qa-report');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'intent50-blind-packet.json'),JSON.stringify(packet,null,2)+'\n');
 fs.writeFileSync(path.join(out,'intent50-sealed-ranking.json'),JSON.stringify(sealed,null,2)+'\n');
 console.log('50 distinct intents; real E5 ON/OFF + shuffled top20 union; human review PENDING');
})().catch(error=>{console.error('Intent50 real retrieval FAILED:',error);process.exitCode=1;});
