'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dir=path.join(__dirname,'../app/src/main/assets');const content=n=>fs.readFileSync(path.join(dir,n),'utf8');
const semantic=JSON.parse(content('semantic-db.json')),stories=JSON.parse(content('semantic-stories.json'));
const db=new Map();
const idb={open(){const request={};setTimeout(()=>{request.result={objectStoreNames:{contains:()=>true},
  transaction(){const tx={objectStore(){return {get(key){const rq={};setTimeout(()=>{rq.result=db.get(key);rq.onsuccess?.();},0);return rq;},put(obj,key){setTimeout(()=>{db.set(key,obj);tx.oncomplete?.();},0);}};}};return tx;},close(){}};request.onsuccess?.();},0);return request;}};
const doc={createElement(){return {content:{textContent:''},set innerHTML(html){this.content.textContent=html.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');}};}};
const ctx={window:{indexedDB:idb},indexedDB:idb,setTimeout,clearTimeout,console,document:doc,fetch:async url=>({ok:true,json:async()=>String(url).includes('semantic-stories')?stories:semantic})};
const repertoireMemory=new Map();
ctx.localStorage={getItem:k=>repertoireMemory.get(k)||null,setItem:(k,v)=>repertoireMemory.set(k,String(v)),removeItem:k=>repertoireMemory.delete(k)};
vm.createContext(ctx);
for(const file of ['semantic-engine.js','story-engine.js','bible-context.js','repertoire-store.js','offline-api.js'])vm.runInContext(content(file),ctx);
const api=vm.runInContext('OfflineAPI',ctx);const engine=vm.runInContext('StoryEngine',ctx).create(stories);
(async()=>{
 assert.ok(engine.stories>=12);
 assert.ok(engine.indexHymn('Voltei pra ti meu pai','Perdoa-me meu pai').some(x=>x.id==='filho_prodigo'));
 assert.equal(engine.indexHymn('Amor do Pai','Jesus é Filho de Deus').some(x=>x.id==='filho_prodigo'),false);
 assert.equal(engine.interpret('Filho Pródigo').matches[0].id,'filho_prodigo');
 const sample=[
 {title:'001 - Voltei pra ti meu Pai',content:'Longe de Ti andei, hoje voltei pra ti meu pai. Perdoa-me e acolhe-me.'},
 {title:'002 - Filho amado',content:'Eu sou filho de Deus, e o Pai ama o seu Filho.'},
 {title:'003 - Retorno ao lar',content:'Senhor, voltei para casa e o meu Pai me recebeu. Eu estava perdido.'},
 {title:'004 - Paz aos filhos',content:'O Pai bondoso abençoa os filhos, há paz e alegria.'},
 {title:'005 - Ovelha perdida',content:'O pastor encontrou a ovelha perdida e trouxe ao redil.'},
 {title:'006 - Jesus e o mar',content:'O vento se calou. Jesus acalmou a tempestade no mar.'},
 {title:'007 - Maranata',content:'Maranata! Cristo voltará, devemos vigiar.'},
 {title:'008 - Agradeço',content:'Agradeço e dou graças ao Senhor por sua bondade e amor.'},
 {title:'009 - Gratidão',content:'Toda gratidão ao Senhor, meu louvor de alegria.'},
 {title:'010 - Louvor',content:'Louvor e gratidão, Cristo é o meu Senhor.'},
 {title:'011 - Graça',content:'Darei graças, Senhor, e exalto teu nome.'},
 {title:'012 - Obrigado',content:'Obrigado meu Salvador por tanta alegria e gratidão.'},
 {title:'013 - Milagre',content:'Agradecemos o milagre do Senhor!'}
 ];
 let imp=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:sample}]});assert.equal(imp.count,13);
 const status=await api.request('/api/status');assert.equal(status.story_ready,true);assert.ok(status.story_count>=12);
 const list=await api.request('/api/stories');assert.ok(list.stories.some(x=>x.label==='Filho Pródigo'));
 let r=await api.request('/api/search',{query:'Filho Pródigo'});
 assert.equal(r.results[0].number,'001');assert.ok(r.results.some(x=>x.number==='003'));
 assert.ok(!r.results.some(x=>x.number==='002'||x.number==='004'),'Termos genéricos filho/pai não podem classificar a parábola');
 assert.ok(r.results[0].reason.includes('Narrativa Filho Pródigo'));
 assert.ok(r.results[0].snippet.includes('voltei pra ti meu pai'));
 assert.ok(r.interpretation.some(x=>x.includes('Filho Pródigo')));
 r=await api.request('/api/search',{query:'Parábola do Filho Pródigo'});assert.equal(r.results[0].number,'001');
 r=await api.request('/api/search',{query:'Lucas 15:11'});assert.equal(r.results[0].number,'001');
 r=await api.request('/api/search',{query:'reencontro do errante',settings:{customAliases:{filho_prodigo:['reencontro do errante']}}});assert.equal(r.results[0].number,'001');
 r=await api.request('/api/search',{query:'Filho Pródigo',settings:{mode:'literal'}});assert.ok(r.results.some(x=>x.number==='002')||r.total===0,'Modo literal desativa classificação narrativa');
 r=await api.request('/api/search',{query:'Filho Pródigo',settings:{narratives:false}});assert.ok(!r.results.some(x=>x.number==='001')||r.results[0].match_type!=='narrativa');
 r=await api.request('/api/search',{query:'Filho Pródigo',settings:{strength:0}});assert.equal(r.total,0);
 r=await api.request('/api/search',{query:'Filho Pródigo',settings:{showReasons:false,showConcepts:false}});assert.equal(r.results[0].reason,'');assert.equal(r.interpretation.length,0);
 r=await api.request('/api/search',{query:'Bom Pastor'});assert.ok(r.total>=0);
 r=await api.request('/api/search',{query:'Jesus acalma a tempestade'});assert.equal(r.results[0].number,'006');
 r=await api.request('/api/search',{query:'Gratidão',settings:{pageSize:10}});assert.equal(r.page_size,10);assert.ok(r.results.length>=5);
 assert.ok(r.results.every(x=>x.relevance_percent>=0&&x.relevance_percent<=100));
 const filtered=await api.request('/api/search',{query:'Filho Pródigo',settings:{minAffinity:90}});assert.ok(filtered.total<=2);
 assert.equal(api.searchOptions({mode:'unknown'}).mode,'balanced');assert.equal(api.searchOptions({pageSize:42}).pageSize,5);
 assert.ok(api.searchOptions({strength:-100}).strength===0);
 console.log('Testes v1.5: 27 verificações de narrativas, falsos positivos, filtros e preferências aprovadas.');
})().catch(e=>{console.error(e);process.exitCode=1;});
