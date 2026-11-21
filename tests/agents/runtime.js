'use strict';
// Ambiente de teste: executa o MESMO OfflineAPI distribuido no APK, sem reimplementar o ranking.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../../app/src/main/assets');
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function makeRuntime(){
  const cache=new Map(),prefs=new Map();
  const indexedDB={open(){
    const req={};
    queueMicrotask(()=>{
      req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
        const tx={objectStore(){return {
          get(key){const q={};queueMicrotask(()=>{q.result=cache.get(key);q.onsuccess?.();});return q;},
          put(value,key){cache.set(key,value);queueMicrotask(()=>tx.oncomplete?.());return {};}
        };}};return tx;
      }};
      req.onsuccess?.();
    });return req;
  }};
  const data={};
  for(const name of ['semantic-db.json','semantic-stories.json','semantic-bridge.json','scripture-pt.json','bible-graph.json']){
    const file=path.join(root,name);
    if(fs.existsSync(file))data[name]=JSON.parse(fs.readFileSync(file,'utf8'));
  }
  const document={createElement(){return {content:{textContent:''},set innerHTML(value){
    this.content.textContent=String(value)
      .replace(/<br\s*\/?>/gi,'\n')
      .replace(/<\/(?:p|div|li|section|blockquote|h[1-6])\s*>/gi,'\n')
      .replace(/<[^>]*>/g,'')
      .replace(/&nbsp;|&#160;/gi,' ')
      .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
  }};}};
  const ctx={console,setTimeout,clearTimeout,indexedDB,document,window:{indexedDB},
    localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v)),removeItem:k=>prefs.delete(k)},
    fetch:async url=>{
      const key=String(url).split('?')[0].split('/').pop();
      return {ok:Object.prototype.hasOwnProperty.call(data,key),json:async()=>data[key]};
    }};
  vm.createContext(ctx);
  for(const name of ['semantic-engine.js','story-engine.js','bridge-engine.js','bible-context.js','scripture-index.js',
    'bible-graph-engine.js','recommendation-engine.js','repertoire-store.js','offline-api.js']){
    vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx,{filename:name});
  }
  return vm.runInContext('OfflineAPI',ctx);
}
module.exports={makeRuntime,norm,root};
