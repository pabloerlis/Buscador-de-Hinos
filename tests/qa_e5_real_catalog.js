'use strict';
/* QA do pipeline real: a coletânea pública que o Android importa precisa
   casar com os fingerprints do índice E5 que será empacotado no mesmo APK. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const file=process.argv[2];
assert.ok(file&&fs.existsSync(file),'Informe a mesma edição usada pelo aplicativo.');
const root=path.resolve(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=JSON.parse(read('e5-index.json'));
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
for(const name of ['scripture-index.js','semantic-engine.js','event-alignment.js','story-engine.js','bridge-engine.js',
  'bible-context.js','bible-graph-engine.js','recommendation-engine.js','vector-index.js',
  'repertoire-store.js','offline-api.js'])
  vm.runInContext(read(name),context,{filename:name});
const request=vm.runInContext('OfflineAPI.request',context);
(async()=>{
  const imported=await request('/api/import',{data:JSON.parse(src)});
  const status=await request('/api/status');
  const vector=status.vector_status;
  assert.ok(imported.count>=1500,'Coletânea incompleta');
  assert.ok(vector.count>=Math.ceil(imported.count*.95),
    'Fingerprint E5 não casa com catálogo real: '+vector.count+'/'+imported.count+' hinos');
  assert.ok(vector.passages>=4000,'Índice E5 sem estrofes distribuídas: '+vector.passages);
  assert.ok(vector.ready,'Índice E5 deve estar funcional com a importação padrão');
  console.log('AGENTE E5 — IMPORTAÇÃO REAL:',JSON.stringify({
    hinos:imported.count,com_embeddings:vector.count,trechos:vector.passages,
    cobertura:Math.round(vector.count/imported.count*10000)/100+'%'
  }));
})().catch(e=>{console.error(e);process.exitCode=1;});
