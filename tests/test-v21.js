'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const fixtures=Object.fromEntries(['semantic-db.json','semantic-stories.json','semantic-bridge.json'].map(x=>[x,JSON.parse(read(x))]));
const cache=new Map(),prefs=new Map();
const idb={open(){const r={};setTimeout(()=>{r.result={objectStoreNames:{contains:()=>true},transaction(){const tx={objectStore(){return {get(key){const q={};setTimeout(()=>{q.result=cache.get(key);q.onsuccess?.();},0);return q;},put(value,key){setTimeout(()=>{cache.set(key,value);tx.oncomplete?.();},0);}};}};return tx;},close(){}};r.onsuccess?.();},0);return r;}};
const makeContext=()=>{
  const ctx={window:{indexedDB:idb},indexedDB:idb,console,setTimeout,clearTimeout,
    localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
    fetch:async url=>{let name=String(url).split('/').at(-1);if(!(name in fixtures))throw Error('Sem internet: '+name);return {ok:true,json:async()=>fixtures[name]};},
    document:{createElement(){return {content:{textContent:''},set innerHTML(x){this.content.textContent=x.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');}};}}};
  vm.createContext(ctx);
  for(const file of ['semantic-engine.js','story-engine.js','bridge-engine.js','bible-context.js','recommendation-engine.js','repertoire-store.js','offline-api.js'])vm.runInContext(read(file),ctx);
  return vm.runInContext('OfflineAPI',ctx);
};
const lyrics=[
'Voltei para o meu pai, arrependido fui recebido em casa, teu perdão me deu vida e a misericórdia me alcançou.',
'Eu deixei meu lar e agora quero regressar, meu coração deseja o abraço do pai, seu perdão me alcançou.',
'Ovelha perdida no deserto o pastor veio encontrar, de volta ao aprisco ele me leva e cuida de mim.',
'Sou grato por tua bondade, quero dar graças pelo amor do Senhor e pela esperança que renova tudo.',
'Meu pai me recebeu quando retornei de longe, hoje tenho paz e a alegria do encontro, seu amor me restaurou.',
'Confio em ti, Jesus, tu és meu refúgio e minha força, me convidas a descansar quando aflito estou.'
];
const groups=[{name:'Coletânea 2018',songs:lyrics.map((content,i)=>({title:`00${i+1} - Música ${i+1}`,content}))},
  {name:'Avulsos 2018',songs:[{title:'100 - Música repetida',content:lyrics[0]}]}];
(async()=>{
  let api=makeContext();
  const imp=await api.request('/api/import',{data:groups});assert.equal(imp.count,6);
  const initial=await api.request('/api/search',{query:'Filho Pródigo',settings:{pageSize:5}});
  assert.ok(initial.results.length>=2,'Busca inicial precisa ter alternativas');
  const id=initial.results[0].id;
  let marked=await api.request('/api/repertoire/mark',{hymn_id:id,not_learned:true});assert.equal(marked.ok,true);
  assert.equal(marked.count,1);
  let found=await api.request('/api/search',{query:'Filho Pródigo',settings:{pageSize:5}});
  assert.equal(found.total,initial.total-1,'O hino não aprendido sai somente das indicações principais');
  assert.equal(found.not_learned_total,1);
  assert.ok(!found.results.some(x=>x.id===id));
  assert.equal(found.not_learned_results[0].id,id);
  assert.equal(found.not_learned_results[0].relevance_percent,initial.results[0].relevance_percent,'A afinidade é preservada');
  const byNumber=await api.request('/api/search',{query:'Hino 1'});
  assert.equal(byNumber.total+byNumber.not_learned_total,1,'Pesquisa exata ainda localiza hino não aprendido');
  const detail=await api.request('/api/hymns/'+id);assert.ok(detail.lyrics);
  let rec=await api.request('/api/recommend',{hymn_id:2,original_query:'Filho Pródigo',settings:{recContext:false}});
  assert.ok(!rec.results.some(x=>x.id===id),'Recomendações principais não podem sugerir hinos não aprendidos');
  if(rec.not_learned_total)assert.ok(rec.not_learned_results.some(x=>x.id===id),'Mas a gaveta de relacionados os preserva');
  const reimport=await api.request('/api/import',{data:groups});assert.equal(reimport.added,0);
  assert.equal((await api.request('/api/repertoire')).count,1,'Reimportar não pode apagar a lista');
  // Simular atualização da interface: nova execução com a mesma biblioteca e armazenamento local.
  api=makeContext();
  assert.equal((await api.request('/api/repertoire')).count,1,'Persistência após reinicializar o JavaScript');
  assert.equal((await api.request('/api/search',{query:'Filho Pródigo'})).not_learned_total,1);
  marked=await api.request('/api/repertoire/mark',{hymn_id:id,not_learned:false});assert.equal(marked.count,0);
  const restored=await api.request('/api/search',{query:'Filho Pródigo'});
  assert.equal(restored.total,initial.total,'Restaurar hino não precisa refazer o índice');
  assert.equal(restored.not_learned_total,0);
  await assert.rejects(api.request('/api/repertoire/mark',{hymn_id:9999,not_learned:true}),/não encontrado/);
  const html=read('index.html'),app=read('app.js'),css=read('style.css');
  assert.match(html,/repertoire-store\.js/);
  for(const name of ['not-learned-search','not-learned-list','related-unlearned','modal-repertoire-toggle','knowledge-list'])assert.ok(html.includes('id="'+name+'"'),name);
  assert.match(app,/RepertoireUI\.renderSearch\(result\)/);
  assert.match(app,/not_learned_page:next/);
  assert.match(app,/RepertoireUI\.renderRelated\(response\)/);
  assert.match(css,/\.unlearned-drawer/);
  const gradle=fs.readFileSync(path.join(root,'../../../build.gradle'),'utf8');
  assert.match(gradle,/versionName '2\.1\.0'/);
  console.log('v2.1: marcação persistente, deduplicação, reimportação, ranking, recomendações, recuperação, UI e versão aprovados.');
})().catch(error=>{console.error(error);process.exitCode=1;});
