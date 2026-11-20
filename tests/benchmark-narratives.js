'use strict';
// Avaliação end-to-end opcional, sem redistribuir as letras no repositório/APK.
// Ex.: node tests/benchmark-narratives.js /tmp/catalogo-2018.json
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const catalogPath=process.argv[2];
if(!catalogPath)throw Error('Informe o caminho do catálogo JSON importado.');
const groups=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const assets=path.join(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(assets,name),'utf8');
const data=Object.fromEntries(['semantic-db.json','semantic-stories.json','semantic-bridge.json']
  .map(name=>[name,JSON.parse(read(name))]));
const stored=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{
  req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tx={objectStore(){return {
      get(key){const q={};queueMicrotask(()=>{q.result=stored.get(key);q.onsuccess?.();});return q;},
      put(value,key){stored.set(key,value);queueMicrotask(()=>tx.oncomplete?.());}
    };}};return tx;
  }};req.onsuccess?.();
});return req;}};
const document={createElement(){return {content:{textContent:''},set innerHTML(v){
  this.content.textContent=String(v).replace(/<br\s*\/?\s*>/ig,'\n').replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/ig,' ').replace(/&amp;/ig,'&');
}};}};
const env=vm.createContext({console,setTimeout,clearTimeout,queueMicrotask,indexedDB,window:{indexedDB},
  document,localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  fetch:async name=>({ok:Object.hasOwn(data,name),json:async()=>data[name]})
});
for(const f of ['semantic-engine.js','story-engine.js','bridge-engine.js','bible-context.js',
  'recommendation-engine.js','repertoire-store.js','offline-api.js'])vm.runInContext(read(f),env,{filename:f});
const api=vm.runInContext('OfflineAPI',env);
const cases=[
  {query:'Filho Pródigo', expected:['Coletânea 2018:286','Coletânea 2018:264','Coletânea 2018:191'],negative:['Coletânea 2018:206']},
  {query:'Lucas 15:11',expected:['Coletânea 2018:286']},
  {query:'Ovelha perdida',expected:['Avulsos 2018:ERAM CEM OVELHAS','Coletânea 2018:259']},
  {query:'Lázaro',expected:['Coletânea 2018:704']},
  {query:'Jesus acalma a tempestade',expected:['Coletânea 2018:310']}
];
(async()=>{
  const imports=await api.request('/api/import',{data:groups});
  assert.ok(imports.count>=1400,'Catálogo inesperadamente reduzido: '+imports.count);
  const outcomes=[];
  for(const {query,expected,negative=[]} of cases){
    const result=await api.request('/api/search',{query,settings:{pageSize:10},_forRecommendations:true});
    const list=result._fullRanked;
    const toKey=x=>{
      const collection=x.collection||'';
      const label=String(x.number||'').trim();
      return collection+':'+label;
    };
    const matchesExpected=expected.map(key=>{
      const [collection,value]=key.split(':');
      const i=list.findIndex(x=>x.collection===collection&&(
        /^\d+$/.test(value)?Number(x.number)===Number(value):x.title.toUpperCase()===value));
      return {expected:key,rank:i<0?null:i+1};
    });
    const matchesNegative=negative.map(key=>{
      const [collection,value]=key.split(':');
      const i=list.findIndex(x=>x.collection===collection&&Number(x.number)===Number(value));
      return {negative:key,rank:i<0?null:i+1};
    });
    outcomes.push({query,count:list.length,top10:list.slice(0,10).map(x=>({title:x.title,collection:x.collection,
      number:x.number,score:x.relevance_score,type:x.match_type})),expected:matchesExpected,
      hardNegatives:matchesNegative});
  }
  console.log('Catálogo completo ('+imports.count+' hinos distintos):\n'+JSON.stringify(outcomes,null,2));
  const first=outcomes.find(x=>x.query==='Filho Pródigo');
  const son=first.expected.find(x=>x.expected==='Coletânea 2018:286');
  assert.ok(son.rank!==null,'O hino 286 não foi recuperado na avaliação real.');
  // Objetivo mínimo de recuperação. Não ajusta explicitamente pesos do hino.
  assert.ok(son.rank<=10,'Filho Pródigo: hino 286 fora do top 10, posição '+son.rank);
})().catch(e=>{console.error(e);process.exitCode=1;});
