'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const memory=new Map();
const fakeIndexedDB={open(){const request={result:null};setTimeout(()=>{request.result={
  objectStoreNames:{contains:n=>n==='cache'},
  createObjectStore(){},
  transaction(_,mode){const tx={objectStore(){return {
    get(key){const req={};setTimeout(()=>{req.result=memory.get(key);req.onsuccess?.();},0);return req;},
    put(value,key){setTimeout(()=>{memory.set(key,value);tx.oncomplete?.();},0);}
  };}};return tx;},close(){}};request.onupgradeneeded?.();request.onsuccess?.();},0);return request;}};
const window={indexedDB:fakeIndexedDB};
const document={createElement(tag){assert.equal(tag,'template');return {content:{textContent:''},set innerHTML(html){this.content.textContent=html.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');}};}};
const dbPath=path.join(__dirname,'../app/src/main/assets/semantic-db.json');
const db=JSON.parse(fs.readFileSync(dbPath,'utf8'));
const ctx={window,document,indexedDB:fakeIndexedDB,setTimeout,clearTimeout,console,fetch:async(url)=>{if(String(url).endsWith('semantic-db.json'))return {ok:true,json:async()=>db};throw Error('No network in tests');}};
const repertoireMemory=new Map();
ctx.localStorage={getItem:k=>repertoireMemory.get(k)||null,setItem:(k,v)=>repertoireMemory.set(k,String(v)),removeItem:k=>repertoireMemory.delete(k)};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/semantic-engine.js'),'utf8')+'\nthis.engine=SemanticEngine;',ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/bible-context.js'),'utf8')+'\nthis.bible=BibleContext;',ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/repertoire-store.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/offline-api.js'),'utf8')+'\nthis.api=OfflineAPI;',ctx);
const api=ctx.api;
const samples=[
  {title:'001 - Fé e descanso',content:'Em Deus posso confiar<br>Ele é meu refúgio e amparo'},
  {title:'002 - Louvor e gratidão',content:'Louvamos e agradecemos pela bondade do Senhor'},
  {title:'003 - Segunda vinda',content:'Maranata, Cristo voltará. A igreja deve vigiar.'},
  {title:'004 - Consolação',content:'Na tristeza, minha paz e meu consolo estão em Deus.'},
  ...Array.from({length:8},(_,i)=>({title:`${String(i+5).padStart(3,'0')} - Gratidão ${i}`,content:'Sou grato ao Senhor e canto louvor com alegria.'}))
];
(async()=>{
 const status=await api.request('/api/status');assert.equal(status.ready,false);
 assert.equal(api.normalize('FÉ, ESPERANÇA'),'fe, esperanca');
 assert.equal(api.parseTitle(' 125 - JESUS SALVA ').number,'125');
 assert.equal(api.parseTitle('Hino 7 - Esperança').number,'007');
 assert.equal(api.parseTitle('Sem número').number,null);
 let importResult=await api.request('/api/import',{data:[{name:'Outra',songs:[{title:'1 - Outro',content:'Outro'}]},{name:'Coletânea 2018',songs:samples}]});
 assert.equal(importResult.count,12);
 assert.equal(importResult.edition,'2018');
 assert.equal((await api.request('/api/status')).hymn_count,12);
 assert.equal((await api.request('/api/status')).semantic_ready,true);
 assert.equal((await api.request('/api/status')).semantic_topics,41);
 let r=await api.request('/api/search',{query:'Hino 1'});
 assert.equal(r.total,1);assert.equal(r.results[0].number,'001');assert.equal(r.results[0].relevance_percent,100);assert.equal(r.results[0].match_type,'numero');
 r=await api.request('/api/search',{query:'Maranata'});assert.ok(r.results.some(x=>x.number==='003'));
 r=await api.request('/api/search',{query:'confiar'});assert.ok(r.results.some(x=>x.number==='001'));
 r=await api.request('/api/search',{query:'gratidão'});assert.equal(r.results.length,5);assert.equal(r.has_more,true);assert.ok(r.results.every(x=>x.relevance_percent>=20&&x.relevance_percent<=98));
 const next=await api.request('/api/search',{query:'gratidão',page:2});assert.equal(next.page,2);assert.ok(next.results.length>0);assert.ok(!r.results.some(a=>next.results.some(b=>a.id===b.id)));
 const d=await api.request('/api/hymns/3');assert.equal(d.number,'003');assert.match(d.lyrics,/Maranata/);assert.ok(d.topics.includes('Volta de Jesus'));
 const ps=await api.request('/api/search',{query:'Salmo 23'});assert.equal(ps.bible_reference,'Salmo 23');assert.match(ps.summary,/pastor|cuidado/i);
 const withHints=await api.request('/api/search',{query:'esperança',semantic_hints:['consolo','refúgio']});assert.equal(withHints.used_ai,true);
 const anxiety=await api.request('/api/search',{query:'ansiedade'});
 assert.ok(anxiety.results.some(x=>x.number==='001'),'Ansiedade deve alcançar confiança/refúgio via relação temática');
 assert.match(anxiety.results.find(x=>x.number==='001').reason,/contextual|refúgio|amparo/i);
 const suffering=await api.request('/api/search',{query:'momentos difíceis'});
 assert.ok(suffering.results.some(x=>x.number==='004')||suffering.results.some(x=>x.number==='001'),'Sofrimento deve alcançar consolo/confiança relacionados');
 const watch=await api.request('/api/search',{query:'preparação da igreja'});
 assert.ok(watch.results.some(x=>x.number==='003'),'Preparação deve alcançar hinos que falam de vigiar/volta');
 const refine=await api.request('/api/search',{query:'sem alegria',refine:true,previous:'gratidão'});assert.ok(refine.excluded.includes('alegria'));assert.ok(refine.results.every(x=>x.number==='002'));
 const nothing=await api.request('/api/search',{query:'xyzabcnotfound'});assert.equal(nothing.total,0);
 const prior=await api.request('/api/status');
 await assert.rejects(api.request('/api/import',{data:{invalid:true}}),/Nenhuma coleção/);
 assert.equal((await api.request('/api/status')).hymn_count,prior.hymn_count);
 console.log('Testes offline, semânticos, versículos e percentuais: 39 verificações aprovadas.');
})().catch(e=>{console.error(e);process.exitCode=1;});
