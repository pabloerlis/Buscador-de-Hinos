'use strict';
// Regressão por múltiplas narrativas: nenhuma exceção por ID/número/título.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const db=JSON.parse(read('semantic-stories.json'));
const context=vm.createContext({db});
vm.runInContext(read('story-engine.js'),context,{filename:'story-engine.js'});
const engine=vm.runInContext('StoryEngine.create(db)',context);

const fixtures=[
  {number:'286',title:'Um dia eu quis te deixar',story:'filho_prodigo',
    query:'Filho Pródigo',
    positive:'Eu deixei tudo e parti, abandonei o meu lar.\nNo caminho perdi o que tinha e fiquei sozinho.\nPor fim voltei para o meu pai, que me recebeu com alegria.',
    negative:'Meu pai, sou pecador e voltarei ao teu amor. Eu canto o teu perdão e a tua paz.'},
  {number:'208',title:'O pastor reencontra',story:'ovelha_perdida',
    query:'Ovelha perdida',
    positive:'Uma ovelha perdida se afastou do redil.\nO pastor procurou por ela e a encontrou no deserto.\nTrouxe a ovelha de volta ao rebanho.',
    negative:'O pastor cuida do rebanho. Eu louvo o Senhor por sua proteção e seu cuidado.'},
  {number:'309',title:'O viajante socorre',story:'bom_samaritano',
    query:'Bom Samaritano',
    positive:'Um homem ferido caiu na estrada.\nOutro viajante socorreu o caído e cuidou das feridas.\nDemonstrou compaixão e o ajudou a seguir.',
    negative:'As feridas da vida me ensinam amor e misericórdia. Eu busco o consolo do Senhor.'},
  {number:'310',title:'O mestre e as ondas',story:'tempestade',
    query:'Jesus acalma a tempestade',
    positive:'Uma tempestade agitou o barco e o vento se ergueu.\nJesus acalmou as ondas e repreendeu o mar.\nDepois reinou a paz.',
    negative:'O Senhor me dá paz quando o vento sopra. Espero com confiança e fé.'}
];
for(const item of fixtures){
  const p=engine.indexHymn(item.title,item.positive).find(x=>x.id===item.story);
  assert.ok(p,'Deve recuperar '+item.story);
  assert.equal(p.tier,2,'Três grupos e ações justificam confiança alta: '+item.story);
  assert.ok(p.localCoverage>=3);
  const neg=engine.indexHymn('Oração e esperança',item.negative).find(x=>x.id===item.story);
  assert.ok(!neg||neg.tier<2,'Pistas genéricas não devem valer como narrativa forte: '+item.story);
  const score=engine.evaluate([p],engine.interpret(item.query));
  assert.equal(score.tier,2,'Avaliação de '+item.story);
}
assert.equal(db.stories.some(s=>Array.isArray(s.events)||Array.isArray(s.anchors)),false,
  'Não incluir léxico ad hoc por narrativa');
const inflected=engine.indexHymn('Volta e reconciliação',
  'Parti de casa. Tudo perdi por minha escolha. Enfim voltei para o meu pai.');
assert.ok(inflected.some(s=>s.id==='filho_prodigo'&&s.evidence.some(x=>x==='perdido')),
  'Flexões como perdi/perdido devem ser consideradas em qualquer história');
const distant=engine.indexHymn('Lembrança',[
  'Meu pai me aconselhou a viver com bondade.','',
  'Em outra ocasião, eu perdi tudo na estrada.','',
  'Em uma viagem distante, eu voltei para casa.'
].join('\n'));
assert.ok(!distant.some(s=>s.id==='filho_prodigo'&&s.tier===2),
  'Pistas espalhadas por estrofes não comprovam sequência local');

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
const env=vm.createContext({console,setTimeout,clearTimeout,indexedDB,window:{indexedDB},
  localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,String(value))},
  fetch:async name=>({ok:Object.hasOwn(data,name),json:async()=>data[name]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(value){
    this.content.textContent=value.replace(/<[^>]*>/g,'');
  }};}}
});
for(const file of ['semantic-engine.js','story-engine.js','bridge-engine.js','bible-context.js',
  'recommendation-engine.js','repertoire-store.js','offline-api.js']){
  vm.runInContext(read(file),env,{filename:file});
}
const api=vm.runInContext('OfflineAPI',env);
const songs=fixtures.flatMap((item,i)=>[
  {title:item.number+' - '+item.title,content:item.positive},
  {title:(420+i)+' - Louvor genérico '+(i+1),content:item.negative}
]);
const dcg=list=>list.slice(0,5).reduce((sum,grade,i)=>sum+(2**grade-1)/Math.log2(i+2),0);
(async()=>{
  const imported=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs}]});
  assert.equal(imported.count,8);
  const records=[];
  for(const item of fixtures){
    const result=await api.request('/api/search',{query:item.query,settings:{pageSize:5}});
    assert.equal(result.results[0]?.number,item.number,'Primeiro resultado: '+item.query);
    const grades=result.results.map(x=>x.number===item.number?3:0);
    assert.ok(dcg(grades)/dcg([3])>=.9,'nDCG@5: '+item.query);
    assert.ok(result.results.some(x=>x.number===item.number),'Recall@5: '+item.query);
    records.push({query:item.query,rank1:result.results[0].number});
  }
  const ref=await api.request('/api/search',{query:'Lucas 15:11'});
  assert.ok(ref.results.some(x=>x.number==='286'),'A referência bíblica deve recuperar a história');
  const literal=await api.request('/api/search',{query:'Filho Pródigo',settings:{mode:'literal'}});
  assert.ok(!literal.results.some(x=>x.number==='286'),'Modo literal permanece isolado');
  const baseline=await api.request('/api/search',{query:'Filho Pródigo'});
  const id=baseline.results[0].id;
  await api.request('/api/repertoire/mark',{hymn_id:id,not_learned:true});
  const hidden=await api.request('/api/search',{query:'Filho Pródigo'});
  assert.ok(!hidden.results.some(x=>x.id===id),'Hino não aprendido fora da lista principal');
  assert.equal(hidden.not_learned_results[0].id,id);
  assert.equal(hidden.not_learned_results[0].relevance_percent,baseline.results[0].relevance_percent);
  console.log('Narrativas genéricas aprovadas: '+JSON.stringify(records));
})().catch(error=>{console.error(error);process.exitCode=1;});
