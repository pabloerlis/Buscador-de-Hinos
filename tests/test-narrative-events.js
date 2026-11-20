'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const db=JSON.parse(read('semantic-stories.json'));
const isolated=vm.createContext({storyData:db});
vm.runInContext(read('story-engine.js'),isolated,{filename:'story-engine.js'});
const engine=vm.runInContext('StoryEngine.create(storyData)',isolated);

const strong=[
  'Eu quis te deixar, ó Pai, buscando liberdade em outro lugar.',
  'A caminhada foi difícil: tudo perdi e a solidão tomou conta de mim.',
  'Arrependido, lembrei-me da casa do Pai e decidi voltar.',
  'Voltei, meu Pai, e me abraçaste quando cheguei à porta.',
  'Houve festa e toda a família cantou com alegria.'
].join('\n');
const medium=[
  'Fui embora da casa do Pai, desejando seguir meus caminhos.',
  'Arrependido e contrito, voltei meu Pai e encontrei abrigo.',
  'Agora quero permanecer junto de ti para sempre.'
].join('\n');
const generic=[
  'Meu Pai me dá perdão e misericórdia em cada jornada.',
  'Eu te louvo e espero em teu amor, meu Pai, minha alegria.',
  'Recebe meu canto e fortalece meu coração na fé.'
].join('\n');
const sheep=[
  'Uma ovelha perdida caminhava longe do aprisco.',
  'O pastor me procurou até que me achou pelo caminho.',
  'Carregou de volta ao redil e houve alegria no céu.'
].join('\n');

const profile=engine.indexHymn('Um dia eu quis te deixar',strong);
const prodigal=profile.find(s=>s.id==='filho_prodigo');
assert.ok(prodigal,'A história deve ser indexada');
assert.equal(prodigal.events.length,6,'Seis acontecimentos distintos');
assert.ok(prodigal.orderedEvents>=4,'A sequência da narrativa deve ser reconhecida');
assert.equal(prodigal.perspective,'filho em primeira pessoa');
const sonIntent=engine.interpret('Filho Pródigo');
const sonScore=engine.evaluate(profile,sonIntent);
assert.equal(sonScore.tier,2,'História completa tem prioridade sobre semelhança temática');
assert.match(sonScore.reasons[0],/afastamento.*perda.*arrependimento.*retorno/);
const weak=engine.indexHymn('Canto de Gratidão',generic).find(s=>s.id==='filho_prodigo');
if(weak)assert.equal(weak.events.length,0,'Uma menção ao Pai não comprova a narrativa');
const sheepProfile=engine.indexHymn('O Pastor que procura',sheep);
assert.ok(sheepProfile.some(s=>s.id==='ovelha_perdida'&&s.events.length>=3),
  'O índice de eventos também se aplica a outra narrativa');

const data=Object.fromEntries(['semantic-db.json','semantic-stories.json','semantic-bridge.json']
  .map(name=>[name,JSON.parse(read(name))]));
const memory=new Map(),preferences=new Map();
const indexedDB={open(){
  const req={};
  setTimeout(()=>{
    req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
      const transaction={objectStore(){return {
        get(key){const q={};setTimeout(()=>{q.result=memory.get(key);q.onsuccess?.();},0);return q;},
        put(value,key){setTimeout(()=>{memory.set(key,value);transaction.oncomplete?.();},0);}
      };}};return transaction;
    }};
    req.onsuccess?.();
  },0);
  return req;
}};
const context=vm.createContext({console,setTimeout,clearTimeout,indexedDB,window:{indexedDB},
  localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,String(value))},
  fetch:async name=>({ok:Object.hasOwn(data,name),json:async()=>data[name]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(value){
    this.content.textContent=value.replace(/<[^>]*>/g,'');
  }};}}
});
for(const file of ['semantic-engine.js','story-engine.js','bridge-engine.js','bible-context.js',
  'recommendation-engine.js','repertoire-store.js','offline-api.js']){
  vm.runInContext(read(file),context,{filename:file});
}
const api=vm.runInContext('OfflineAPI',context);
const songs=[
  {title:'286 - Um dia eu quis te deixar',content:strong},
  {title:'201 - O filho arrependido',content:medium},
  {title:'206 - Louvor ao Pai',content:generic},
  {title:'208 - O pastor procura',content:sheep},
  {title:'209 - Gratidão',content:'Agradeço pela paz e pela força de Deus. A esperança em seu cuidado e a alegria me sustentam.'}
];
const grades=new Map([['286',3],['201',2],['206',0],['208',0],['209',0]]);
const dcg=list=>list.slice(0,5).reduce((sum,grade,i)=>sum+(2**grade-1)/Math.log2(i+2),0);
(async()=>{
  const imported=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs}]});
  assert.equal(imported.count,5);
  for(const query of ['Filho Pródigo','Lucas 15:11']){
    const found=await api.request('/api/search',{query,settings:{pageSize:5}});
    assert.equal(found.results[0]?.number,'286','A narrativa deve liderar: '+query);
    assert.match(found.results[0].reason,/Narrativa Filho Pródigo/);
    const measured=dcg(found.results.map(s=>grades.get(s.number)||0))/dcg([3,2]);
    assert.ok(measured>=0.9,'nDCG@5 abaixo do esperado: '+query+' '+measured);
    assert.ok(found.results.some(s=>s.number==='286'),'Recall@5 da narrativa: '+query);
  }
  const lost=await api.request('/api/search',{query:'Ovelha perdida'});
  assert.equal(lost.results[0]?.number,'208','Outro conjunto de eventos deve funcionar');
  const literal=await api.request('/api/search',{query:'Filho Pródigo',settings:{mode:'literal'}});
  assert.ok(!literal.results.some(s=>s.number==='286'),'Modo literal não deve usar eventos');
  const original=await api.request('/api/search',{query:'Filho Pródigo'});
  const id=original.results[0].id;
  await api.request('/api/repertoire/mark',{hymn_id:id,not_learned:true});
  const hidden=await api.request('/api/search',{query:'Filho Pródigo'});
  assert.ok(!hidden.results.some(s=>s.id===id));
  assert.equal(hidden.not_learned_results[0].id,id);
  assert.equal(hidden.not_learned_results[0].relevance_percent,original.results[0].relevance_percent);
  console.log('Narrativas: 6 eventos, perspectiva, ranking, nDCG@5, Recall@5, literal e repertório aprovados.');
})().catch(error=>{console.error(error);process.exitCode=1;});
