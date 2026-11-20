'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const assets=path.join(__dirname,'../app/src/main/assets');
const source=n=>fs.readFileSync(path.join(assets,n),'utf8');
const db=JSON.parse(source('semantic-db.json'));
const memory=new Map();
const idb={open(){const req={};setTimeout(()=>{req.result={objectStoreNames:{contains:()=>true},transaction(){const tx={objectStore(){return {get(key){const q={};setTimeout(()=>{q.result=memory.get(key);q.onsuccess?.();},0);return q;},put(obj,key){setTimeout(()=>{memory.set(key,obj);tx.oncomplete?.();},0);}};}};return tx;},close(){}};req.onsuccess?.();},0);return req;}};
const context={window:{indexedDB:idb},indexedDB:idb,setTimeout,console,fetch:async u=>({ok:true,json:async()=>db}),document:{createElement:()=>({content:{textContent:''},set innerHTML(v){this.content.textContent=v.replace(/<[^>]*>/g,'');}})}};
vm.createContext(context);
for(const f of ['semantic-engine.js','bible-context.js','offline-api.js'])vm.runInContext(source(f),context);
const api=vm.runInContext('OfflineAPI',context);
(async()=>{
 const data=[{name:'Coletânea 2018',songs:[
  {title:'001 - Descanso em Deus',content:'Confio no Senhor. Em seu refúgio posso descansar.'},
  {title:'002 - Jesus vem',content:'Maranata, igreja preparada para Jesus voltar.'},
  {title:'003 - Gratidão',content:'Agradeço por tua bondade.'},
  {title:'004 - Amor',content:'Seu amor alcança toda a terra.'}]}];
 await api.request('/api/import',{data});
 const labels=api.semanticLabels();assert.ok(labels.includes('Confiança'));
 assert.deepEqual(Array.from(api.validateHints(['Confiança','CONFIANÇA','tema inventado','Esperança'])),['Confiança','Esperança']);
 assert.ok((await api.request('/api/search',{query:'ansiedade'})).results.some(x=>x.number==='001'));
 const h=await api.request('/api/search',{query:'ansiedade',semantic_hints:['confiança','inexistente']});
 assert.equal(h.used_ai,true);assert.deepEqual(Array.from(h.applied_hints),['Confiança']);
 const none=await api.request('/api/search',{query:'gratidão',semantic_hints:['paradoxo inventado']});
 assert.equal(none.used_ai,false);assert.equal(none.results[0].number,'003');
 const number=await api.request('/api/search',{query:'Hino 2'});assert.equal(number.total,1);assert.equal(number.results[0].number,'002');
 const noresults=await api.request('/api/search',{query:'palavramuitorara'});assert.equal(noresults.total,0);
 console.log('Novos testes v1.4: 11 verificações de índices e validação da IA aprovadas.');
})().catch(err=>{console.error(err);process.exitCode=1;});
