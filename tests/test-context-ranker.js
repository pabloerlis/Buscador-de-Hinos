'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {profile, compare, score, weights} = require('../app/src/main/assets/context-ranker.js');
const trained = require('../scripts/train_context_ranker.js');

assert.deepEqual(weights, trained, 'Pesos empacotados devem corresponder ao treino reproduzível');
const scene = profile('O pastor procurou a ovelha. O pastor encontrou a ovelha. O pastor acolheu a ovelha.');
const support = 'O pastor buscou a ovelha. O pastor achou a ovelha. O pastor recebeu a ovelha.';
const contrasts = [
  'A ovelha procurou o pastor. A ovelha encontrou o pastor. A ovelha acolheu o pastor.',
  'O pastor procurou a ovelha. O pastor encontrou a ovelha. O pastor não acolheu a ovelha.',
  'O pastor acolheu a ovelha. O pastor encontrou a ovelha. O pastor procurou a ovelha.',
  'O pastor acolheu a ovelha. Todos estavam contentes. O jantar estava na mesa. O frio já foi embora.'
];
const relevant = score(compare(scene, profile(support)));
for (const contrast of contrasts) assert.ok(relevant > score(compare(scene, profile(contrast))), contrast);
assert.equal(score(compare(profile('O vento soprou.'), profile(support))), 0);
assert.deepEqual(compare(scene, profile(support + ' ' + support)), compare(scene, profile(support)));

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
const ctx = vm.createContext({
  window, indexedDB, document, setTimeout, console,
  localStorage:{getItem:()=>null, setItem:()=>{}},
  fetch:async name=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(assets,name),'utf8'))})
});
for (const file of ['semantic-engine.js','story-engine.js','scripture-index.js','bible-graph-engine.js','bible-context.js','repertoire-store.js','context-ranker.js','offline-api.js']){
  vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),ctx,{filename:file});
}
const api = vm.runInContext('OfflineAPI', ctx);
(async ()=>{
  await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:[
    {title:'001 - A força da bondade',content:'A mulher ouviu Jesus. A mulher não tocou a roupa. Jesus não salvou a mulher.'},
    {title:'002 - O socorro esperado',content:'A mulher ouviu Jesus. A mulher tocou a roupa. Jesus salvou a mulher.'},
    {title:'003 - A jornada dos discípulos',content:'O povo foi atrás de Jesus. Os discípulos ouviram as palavras de fé.'}
  ]}]});
  const search = (query,settings) => api.request('/api/search',{query,settings});
  const normal = await search('Hino 2',{});
  assert.equal(normal.results[0].number,'002');
  assert.equal(normal.results[0].relevance_percent,100);
  assert.deepEqual(await search('Hino 2',{contextRerank:true}),normal);
  assert.deepEqual(await search('O socorro esperado',{contextRerank:true}),await search('O socorro esperado',{}));
  assert.deepEqual(await search('Ovelha perdida',{mode:'literal',contextRerank:true}),await search('Ovelha perdida',{mode:'literal'}));
  // Mesmo universo de candidatos e percentuais da busca original ao reordenar.
  const query = 'Marcos 5:25-34';
  const baseline = await search(query,{});
  const experiment = await search(query,{contextRerank:true});
  assert.ok(baseline.results.length>1);
  assert.equal(baseline.results[0].number,'001');
  assert.equal(experiment.results[0].number,'002');
  assert.equal(experiment.context_reranked,true);
  assert.deepEqual(experiment.results.map(hit=>[hit.id,hit.relevance_percent]).sort(),baseline.results.map(hit=>[hit.id,hit.relevance_percent]).sort());
  assert.ok(experiment.results.every(hit=>!Object.hasOwn(hit,'_contextOrder')));
  assert.equal(api.searchOptions().contextRerank,false);
  console.log('Reordenador: treino, contrastes, caminhos exatos e integração offline aprovados.');
})().catch(error=>{console.error(error);process.exitCode=1;});
