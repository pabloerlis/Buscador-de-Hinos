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
  let api=start();
  const save=payload=>api.request('/api/stories/save',payload);
  const search=(query,settings)=>api.request('/api/search',{query,settings});
  await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:[
    {title:'001 - O anúncio esperado',content:'Maranata, Cristo voltará. A igreja deve vigiar.'},
    {title:'002 - Louvor distante',content:'A igreja louva com gratidão.'}
  ]}]});
  await assert.rejects(save({label:'Filho Pródigo',reference:'Lucas 15:11'}),/Já existe/);
  await assert.rejects(save({label:'Uma história conhecida',reference:'Lucas 15:11-176'}),/referência bíblica válida/);
  await assert.rejects(save({label:'Uma história conhecida',clues:['Maranata','maranata']}),/duas pistas diferentes/);
  const entry=await save({label:'Igreja à espera',clues:['Maranata','Igreja']});
  assert.equal((await search(entry.label)).results[0]?.number,'001');
  assert.ok(!(await search(entry.label,{mode:'literal'})).story_matches.length);
  assert.ok(!(await search(entry.label,{narratives:false})).story_matches.length);
  const renamed=await save({id:entry.id,label:'Igreja que vigia',clues:entry.clues});
  assert.equal(renamed.id,entry.id);
  api=start();
  const aliased=await search('esperança no breve retorno',{customAliases:{[entry.id]:['esperança no breve retorno']}});
  assert.equal(aliased.results[0]?.number,'001');
  assert.equal(aliased.story_matches[0],renamed.label);
  assert.ok(!(await search(entry.label)).story_matches.length);
  const linked=await save({label:'Rute acompanha Noemi',reference:'Rute 1:16-18'});
  const list=await api.request('/api/stories');
  assert.ok(list.stories.some(story=>story.id===linked.id&&story.personal));
  assert.equal((await search(linked.label)).bible_reference,'Rute 1:16-18');
  console.log('Narrativas pessoais: validação, busca por pistas e referência, edição, associação e persistência aprovadas.');
})().catch(error=>{console.error(error);process.exitCode=1;});
