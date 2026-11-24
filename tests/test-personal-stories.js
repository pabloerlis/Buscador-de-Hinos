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
  saved.set('hinos-narrativas-pessoais-v1',JSON.stringify([
    {id:'local_story_1',label:'Vigília da igreja',reference:'',clues:['Maranata','Igreja']}
  ]));
  saved.set('hinos-search-preferences-v15',JSON.stringify({
    customAliases:{local_story_1:['esperança da igreja']}
  }));
  let api=start();
  const save=payload=>api.request('/api/stories/save',payload);
  const search=(query,settings)=>api.request('/api/search',{query,settings});
  await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:[
    {title:'001 - O anúncio esperado',content:'Maranata, Cristo voltará. A igreja deve vigiar.'},
    {title:'002 - Louvor distante',content:'A igreja louva com gratidão.'}
  ]}]});
  assert.equal((await search('esperança da igreja')).results[0]?.number,'001');
  saved.clear();
  api=start();
  assert.equal((await search('esperança da igreja')).results[0]?.number,'001');
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
  const exported=JSON.parse(JSON.stringify(await api.request('/api/dictionary/export')));
  assert.equal(exported.version,1);
  assert.equal(exported.associations.local_story_1[0],'esperança da igreja');
  assert.ok(!Object.hasOwn(exported,'hymns'));
  const restore=raw=>api.request('/api/dictionary/restore',raw);
  await assert.rejects(restore({...exported,version:9}),/versão/);
  await assert.rejects(restore({...exported,associations:{local_story_99:['pista sem história']}}),/sem narrativa/);
  await assert.rejects(restore({...exported,stories:[{...exported.stories[0],clues:['Rute','Noemi']}],associations:{}}),/Renomeie/);
  assert.equal((await api.request('/api/dictionary/export')).stories.length,3);
  const restored=await restore({...exported,stories:[
    {id:'local_story_1',label:'O encontro de espera',reference:'',clues:['Maranata','Igreja']}
  ],associations:{local_story_1:['cântico para aguardar','esperança da igreja']}});
  assert.equal(restored.addedStories,1);
  assert.equal(restored.addedAliases,1);
  assert.equal(restored.conflicts,1);
  assert.equal((await search('cântico para aguardar')).story_matches[0],'O encontro de espera');
  assert.equal((await search('esperança da igreja')).story_matches[0],'Vigília da igreja');
  const repeat=await restore(exported);
  assert.equal(repeat.addedStories+repeat.addedAliases,0);
  await assert.rejects(api.request('/api/dictionary/aliases',{previous:{},associations:{}}),/mudou/);
  const before=await api.request('/api/dictionary/export');
  memory.delete('personal-dictionary-v1');
  api=start();
  await restore(before);
  assert.equal((await search('cântico para aguardar')).story_matches[0],'O encontro de espera');
  assert.equal((await api.request('/api/dictionary/export')).stories.length,4);
  console.log('Narrativas pessoais: validação, busca por pistas e referência, edição, persistência, migração e restauração aprovadas.');
})().catch(error=>{console.error(error);process.exitCode=1;});
