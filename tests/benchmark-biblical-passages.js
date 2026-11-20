'use strict';
/* Avaliação de passagens contra o catálogo real: sem guardar letras no APK. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=process.argv[2];if(!source)throw Error('Informe um JSON de hinos para avaliar.');
const assets=path.join(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(assets,name),'utf8');
const files=['semantic-db.json','semantic-stories.json','semantic-bridge.json','scripture-pt.json','bible-graph.json'];
const data=Object.fromEntries(files.map(name=>[name,JSON.parse(read(name))]));
const cache=new Map(),preferences=new Map();
const indexedDB={open(){
  const request={};
  queueMicrotask(()=>{
    request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
      const transaction={objectStore(){return {
        get(key){const result={};queueMicrotask(()=>{result.result=cache.get(key);result.onsuccess?.();});return result;},
        put(value,key){cache.set(key,value);queueMicrotask(()=>transaction.oncomplete?.());}
      };}};return transaction;
    }};
    request.onsuccess?.();
  });return request;
}};
const context=vm.createContext({console,setTimeout,clearTimeout,queueMicrotask,indexedDB,window:{indexedDB},
  localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,String(value))},
  fetch:async url=>({ok:Object.hasOwn(data,url),json:async()=>data[url]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(x){
    this.content.textContent=String(x).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'');
  }};}}
});
for(const name of ['scripture-index.js','semantic-engine.js','story-engine.js','bridge-engine.js',
  'bible-context.js','bible-graph-engine.js','recommendation-engine.js','repertoire-store.js','offline-api.js']){
  vm.runInContext(read(name),context,{filename:name});
}
const request=vm.runInContext('OfflineAPI.request',context);
const cases=[
  {query:'Mulher do fluxo de sangue',positive:[['Coletânea 2018',67],['Coletânea 2018',261],['Coletânea 2018',374]],negative:[['Coletânea 2018',10]]},
  {query:'Marcos 5:25-34',positive:[['Coletânea 2018',67],['Coletânea 2018',261],['Coletânea 2018',374]],negative:[['Coletânea 2018',10]]},
  {query:'Marcos 10:46-52',positive:[['CIA 2018',62],['CIA 2018',63]]},
  {query:'João 11:1-44',positive:[['Coletânea 2018',704]]},
  {query:'Marcos 4:35-41',positive:[['Coletânea 2018',310]]}
];
(async()=>{
  const groups=JSON.parse(fs.readFileSync(source,'utf8'));
  const imported=await request('/api/import',{data:groups});
  assert.ok(imported.count>=1400,'Catálogo menor do que o esperado: '+imported.count);
  const outcome=[];
  for(const item of cases){
    const result=await request('/api/search',{query:item.query,settings:{pageSize:10},_forRecommendations:true});
    const ranked=result._fullRanked;
    const index=(collection,number)=>ranked.findIndex(x=>
      x.collection===collection&&Number(x.number)===number);
    const expected=item.positive.map(([collection,number])=>{
      const i=index(collection,number);return {number,position:i<0?null:i+1};
    });
    const falsePositive=(item.negative||[]).map(([collection,number])=>{
      const i=index(collection,number);return {number,position:i<0?null:i+1};
    });
    outcome.push({query:item.query,expected,falsePositive,
      top10:ranked.slice(0,10).map(x=>({number:x.number,title:x.title,
        collection:x.collection,score:x.relevance_score,reason:x.reason}))});
  }
  console.log('BENCHMARK_BIBLICO '+JSON.stringify({count:imported.count,outcome}));
  for(const row of outcome){
    assert.ok(row.expected.some(x=>x.position&&x.position<=20),
      'Nenhum hino diretamente relacionado recuperado no top 20: '+row.query);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
