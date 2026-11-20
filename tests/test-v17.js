'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const base=path.join(__dirname,'../app/src/main/assets');
const read=x=>fs.readFileSync(path.join(base,x),'utf8');
const semantic=JSON.parse(read('semantic-db.json'));
const narratives=JSON.parse(read('semantic-stories.json'));
const bridge=JSON.parse(read('semantic-bridge.json'));
const bible={schema_version:1,version:'almeida-livre',revision:'fixture',source:'dados sintéticos de testes',books:{
  Ps:{'23':['','O Senhor é o meu pastor; nada me faltará.','Ele faz me descansar em pastos verdejantes.','Ainda que eu ande pelo vale da sombra, não temerei.']},
  Luke:{'15':['','Um homem tinha dois filhos.','','','','','','','','','','O filho saiu de casa e ficou distante.','Ele perdeu tudo e se arrependeu.','Voltou para a casa do seu pai.','O pai o recebeu com amor e misericórdia.']},
  Mark:{'4':['','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','Jesus repreendeu o vento e disse ao mar: aquieta-te.']},
  John:{'3':[...Array(17).fill('')].map((x,i)=>i===16?'Deus amou o mundo e ofereceu seu Filho para a salvação.':x)}
}};
const store=new Map();const idb={open(){const req={};setTimeout(()=>{req.result={objectStoreNames:{contains:()=>true},transaction(){const tx={objectStore(){return {get(key){const r={};setTimeout(()=>{r.result=store.get(key);r.onsuccess?.();},0);return r;},put(value,key){setTimeout(()=>{store.set(key,value);tx.oncomplete?.();},0);}};}};return tx;},close(){}};req.onsuccess?.();},0);return req;}};
const document={createElement(){return {content:{textContent:''},set innerHTML(s){this.content.textContent=s.replace(/<[^>]+>/g,'');}};}};
const fetch=async(url)=>({ok:true,json:async()=>String(url).includes('scripture-pt')?bible:String(url).includes('semantic-bridge')?bridge:String(url).includes('semantic-stories')?narratives:semantic});
const ctx={window:{indexedDB:idb},indexedDB:idb,setTimeout,clearTimeout,console,document,fetch};const repertoireMemory=new Map();
ctx.localStorage={getItem:k=>repertoireMemory.get(k)||null,setItem:(k,v)=>repertoireMemory.set(k,String(v)),removeItem:k=>repertoireMemory.delete(k)};
vm.createContext(ctx);
for(const name of ['semantic-engine.js','story-engine.js','scripture-index.js','bridge-engine.js','bible-context.js','recommendation-engine.js','repertoire-store.js','offline-api.js'])vm.runInContext(read(name),ctx);
const api=vm.runInContext('OfflineAPI',ctx);
const scripture=vm.runInContext('ScriptureIndex',ctx).create(bible);
assert.equal(scripture.lookup('Hinos para João 3:16').reference,'João 3:16');
assert.equal(scripture.lookup('Salmo 23').verses.length,3);
assert.equal(scripture.lookup('Lucas 15:11-14').verses.length,4);
assert.equal(scripture.lookup('Mateus 99:99'),null);
assert.equal(vm.runInContext('ScriptureIndex.parse("Jo 3:16")',ctx).id,'John');
assert.equal(vm.runInContext('ScriptureIndex.parse("Jó 3:16")',ctx).id,'Job');
assert.equal(vm.runInContext('ScriptureIndex.parse("1 João 4:8")',ctx).id,'1John');
assert.equal(vm.runInContext('ScriptureIndex.parse("1 Coríntios 13:4-7")',ctx).id,'1Cor');
assert.equal(vm.runInContext('ScriptureIndex.parse("Filho Pródigo")',ctx),null);
assert.ok(bridge.entries.length>=20);
const sample=[
  {title:'001 - Descanso na presença',content:'A paz do Senhor me sustenta. Estou em seguro refúgio; posso confiar e descansar.'},
  {title:'002 - Palavra de arrependimento',content:'De volta à tua casa, Pai, encontro perdão. Arrependido, voltei pra ti.'},
  {title:'003 - Ele salvou',content:'A graça e a salvação do Senhor alcançaram minha vida. Cristo me amou.'},
  {title:'004 - Filho amado',content:'O Filho de Deus nasceu para anunciar o Reino. Filho do Pai eterno.'},
  {title:'005 - Salmo do pastor',content:'O Senhor é meu pastor, meu abrigo, me guiará pelas veredas e no vale.'},
  {title:'006 - Descanso do coração',content:'A beleza da criação revela grande poder e o céu resplandece.'},
  {title:'007 - Tempestade e esperança',content:'Em meio à tempestade, Deus me dá paz e aquieta o vento.'}
];
(async()=>{
 const imported=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:sample}]});assert.equal(imported.count,7);
 const status=await api.request('/api/status');assert.equal(status.scripture_ready,true);assert.equal(status.scripture_books,4);assert.equal(status.bridge_ready,true);
 let r=await api.request('/api/search',{query:'Não consigo dormir'});
 assert.equal(r.results[0].number,'001','A ponte lexical deve reconhecer paz e confiança sem palavras iguais na consulta');
 assert.ok(r.interpretation.some(x=>x.startsWith('Associação lexical:')));
 assert.ok(!r.results.some(x=>x.number==='004'),'O tema não pode ser inventado por causa de Pai/Filho');
 r=await api.request('/api/search',{query:'Filho Pródigo'});
 assert.equal(r.results[0].number,'002');assert.ok(!r.results.some(x=>x.number==='004'));
 r=await api.request('/api/search',{query:'João 3:16'});
 assert.ok(r.results.some(x=>x.number==='003'));
 assert.equal(r.bible_reference,'João 3:16');assert.equal(r.bible_verses,1);
 assert.ok(r.interpretation.some(x=>x.includes('Bíblia Livre offline')));
 r=await api.request('/api/search',{query:'Salmo 23'});
 assert.equal(r.bible_reference,'Salmo 23');assert.ok(r.results.some(x=>x.number==='005'));
 const noBible=await api.request('/api/search',{query:'Salmo 23',settings:{scripture:false}});
 assert.equal(noBible.bible_verses,0);
 const noBridge=await api.request('/api/search',{query:'Não consigo dormir',settings:{bridge:false}});
 assert.ok(!noBridge.interpretation.some(x=>x.startsWith('Associação lexical')));
 const detail=await api.request('/api/recommend',{hymn_id:2,original_query:'Filho Pródigo'});
 assert.ok(Array.isArray(detail.results));
 console.log('Testes v1.7: Bíblia local, referências, ponte lexical, segurança e retrocompatibilidade aprovados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
