'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const memory = new Map();
const indexedDB = {open(){
  const request = {};
  setTimeout(() => {
    request.result = {close(){}, transaction(){
      const transaction = {objectStore(){return {
        get(key){
          const read = {};
          setTimeout(() => { read.result = memory.get(key); read.onsuccess(); }, 0);
          return read;
        },
        put(value,key){setTimeout(() => { memory.set(key,value); transaction.oncomplete(); }, 0);}
      };}};
      return transaction;
    }};
    request.onsuccess();
  }, 0);
  return request;
}};
const window = {indexedDB};
const document = {createElement(){return {content:{textContent:''},set innerHTML(value){this.content.textContent=value.replace(/<[^>]+>/g,'');}};}};
const saved = new Map();
function start(){
  const ctx = vm.createContext({
    window, indexedDB, document, setTimeout, console,
    localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},
    fetch:async name=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(assets,name),'utf8'))})
  });
  for (const file of ['semantic-engine.js','story-engine.js','scripture-index.js','bible-graph-engine.js','bible-context.js','repertoire-store.js','context-ranker.js','offline-api.js']){
    vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),ctx,{filename:file});
  }
  return vm.runInContext('OfflineAPI', ctx);
}

(async ()=>{
  const api=start();
  await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:[
    {title:'001 - Canto da manhã',content:'Paz e alegria neste dia.'},
    {title:'002 - Canto da tarde',content:'Serenidade e alegria neste dia.'},
    {title:'003 - Canto da noite',content:'Paz com júbilo e felicidade.'},
    {title:'004 - Paz anunciada',content:'Dia de alegria e esperança.'},
    {title:'005 - Canto de esperança',content:'Ansiedade e alegria neste dia.'},
    {title:'006 - Canto de viagem',content:'Rapaz toma o caminho com alegria.'},
    {title:'007 - Canto ao longe',content:'Paz, alegria e gratidão a Deus.'}
  ]}]});
  const filter=(term,options={})=>({term,...options});
  const search=(term_filters,query='',options={})=>api.request('/api/search',{query,term_filters,...options});
  const numbers=result=>Array.from(result.results,hit=>hit.number);
  const peace=filter('páz',{field:'lyrics'});
  const joy=filter('alegria',{field:'lyrics'});
  assert.deepEqual(numbers(await search([peace,joy])),['001','007']);
  assert.deepEqual(numbers(await search([{...peace,synonyms:true},joy])),['001','002','007']);
  assert.deepEqual(numbers(await search([peace,{...joy,synonyms:true}])),['001','003','007']);
  assert.deepEqual(numbers(await search([peace,filter('gratidão',{kind:'exclude'})])),['001','003']);
  assert.deepEqual(numbers(await search([filter('paz',{field:'title'})])),['004']);
  assert.deepEqual(numbers(await search([filter('gratidão a Deus')])),['007']);
  assert.deepEqual(numbers(await search([peace,filter('júbilo',{kind:'prefer'})])),['003','001','007']);
  assert.deepEqual(numbers(await search([filter('paz',{kind:'exclude',synonyms:true,field:'lyrics'})])),['004','005','006']);
  assert.deepEqual(numbers(await search([joy],'Hino 3')),[]);
  assert.deepEqual(numbers(await search([{...joy,synonyms:true}],'Hino 3')),['003']);
  assert.deepEqual(numbers(await search([filter('paz',{kind:'exclude'})],'',{page:2})),[]);
  const first=await search([filter('alegria')]);
  const second=await search([filter('alegria')],'',{page:2,parsed_query:true});
  assert.equal(first.total,6);
  assert.equal(second.page,2);
  assert.equal(second.total,6);
  assert.deepEqual(numbers(second),['007']);
  assert.ok(first.results.every(hit=>hit.match_type==='filtro'));
  console.log('Filtros ao vivo: termo exato, sinônimos independentes, escopo, exclusão, preferência, número e paginação aprovados.');
})().catch(error=>{console.error(error);process.exitCode=1;});
