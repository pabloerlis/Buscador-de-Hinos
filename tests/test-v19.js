'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const dir=path.join(__dirname,'../app/src/main/assets');
const read=n=>fs.readFileSync(path.join(dir,n),'utf8');
const cache=new Map();
const storage={open(){const req={};setTimeout(()=>{req.result={objectStoreNames:{contains:()=>true},transaction(){const tx={objectStore(){return {get(key){const q={};setTimeout(()=>{q.result=cache.get(key);q.onsuccess?.();},0);return q;},put(value,key){setTimeout(()=>{cache.set(key,value);tx.oncomplete?.();},0);return {};}};}};return tx;},close(){}};req.onsuccess?.();},0);return req;}};
const parsed=Object.fromEntries(['semantic-db.json','semantic-stories.json','semantic-bridge.json'].map(x=>[x,JSON.parse(read(x))]));
const ctx={window:{indexedDB:storage},indexedDB:storage,console,setTimeout,clearTimeout,fetch:async url=>{const key=String(url).split('/').at(-1);if(!(key in parsed))throw Error('Network access blocked in test: '+key);return {ok:true,json:async()=>parsed[key]};},document:{createElement(){return {content:{textContent:''},set innerHTML(value){this.content.textContent=value.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'');}};}}};
const repertoireMemory=new Map();
ctx.localStorage={getItem:k=>repertoireMemory.get(k)||null,setItem:(k,v)=>repertoireMemory.set(k,String(v)),removeItem:k=>repertoireMemory.delete(k)};
vm.createContext(ctx);
for(const name of ['semantic-engine.js','story-engine.js','bridge-engine.js','bible-context.js','recommendation-engine.js','repertoire-store.js','offline-api.js'])vm.runInContext(read(name),ctx);
const api=vm.runInContext('OfflineAPI',ctx);
const lyric1='Estive longe de ti e agora voltei meu Pai. Retornei arrependido ao teu abraço, fui recebido em casa e encontrei perdão e misericórdia. Senhor, perdoa-me.';
const lyric2='A ovelhinha perdida no deserto foi encontrada pelo bom pastor. Sua voz suave me chama, me resgata e me faz descansar no seu redil. Ele me conduz.';
const lyric3='Agradeço por tua bondade e tua proteção. Quero cantar alegremente e celebrar tua presença, pois tua graça renovou meu viver e minha esperança.';
const lyric4='O Senhor me guia nas águas tranquilas e pelo vale escuro. Não temerei nenhum mal, pois está comigo seu cajado, e sua presença me consola.';
const sample=[
 {name:'Coletânea 2018',songs:[{title:'001 - Voltei para o Pai',content:lyric1},{title:'002 - Ovelha e Pastor',content:lyric2}]},
 {name:'Avulsos 2018',songs:[{title:'003 - Voltei para o Pai',content:lyric1},{title:'001 - Dia de Gratidão',content:lyric3}]},
 {name:'CIA 2018',songs:[{title:'001 - Confio no Senhor',content:lyric4},{title:'002 - Louvor do Redil',content:lyric2}]},
 {name:'Coletânea Antiga',songs:[{title:'8888 - NÃO IMPORTAR',content:'Grupo antigo ignorado e não exibido nos resultados da busca.'}]},
 {name:'Test',songs:[{title:'0001 - invalid sample',content:'A song in another language should not be indexed here.'}]}
];
const filter=(id)=>({collections:{principal:id==='principal',avulsos:id==='avulsos',cia:id==='cia',pessoal:false},recContext:false});
(async()=>{
 assert.equal((await api.request('/api/status')).ready,false);
 const imported=await api.request('/api/import',{data:sample});
 assert.equal(imported.count,4,'Deduplicação de letras idênticas entre coletâneas');
 assert.equal(imported.added,4);
 assert.equal(imported.duplicates,2);
 assert.equal(imported.processed,6);
 let status=await api.request('/api/status');
 assert.equal(status.hymn_count,4);
 assert.equal(status.collections.principal,2);assert.equal(status.collections.avulsos,2);assert.equal(status.collections.cia,2);
 assert.equal(status.collections.pessoal,0);
 const reimport=await api.request('/api/import',{data:sample});
 assert.equal(reimport.added,0,'Reimportação idempotente');
 assert.equal(reimport.count,4);
 const noOld=await api.request('/api/search',{query:'NÃO IMPORTAR'});assert.equal(noOld.total,0);
 const avulsos=await api.request('/api/search',{query:'gratidão',settings:filter('avulsos')});
 assert.ok(avulsos.results.some(x=>x.title==='Dia de Gratidão'));
 assert.ok(avulsos.results.every(x=>x.collection_ids.includes('avulsos')));
 const principal=await api.request('/api/search',{query:'gratidão',settings:filter('principal')});
 assert.ok(!principal.results.some(x=>x.title==='Dia de Gratidão'));
 const byNumber=await api.request('/api/search',{query:'hino 1'});
 assert.equal(byNumber.total,3,'Mesmo número em três coleções aponta a registros diferentes');
 const ciaNumber=await api.request('/api/search',{query:'CIA 1'});
 assert.equal(ciaNumber.total,1);assert.equal(ciaNumber.results[0].title,'Confio no Senhor');
 const avNumber=await api.request('/api/search',{query:'avulsos 3'});
 assert.equal(avNumber.total,1);assert.equal(avNumber.results[0].number,'003');
 const merged=await api.request('/api/hymns/1');
 assert.equal(merged.collectionRefs.length,2);
 assert.deepEqual([...merged.collections].sort(),['avulsos','principal']);
 const similar=await api.request('/api/recommend',{hymn_id:1,settings:{...filter('cia'),recContext:false}});
 assert.ok(similar.results.every(x=>x.collection==='CIA 2018'||x.collection==='Coletânea 2018'), 'Resultado deduplicado mantém origem primária');
 assert.ok(similar.results.every(x=>[2,4].includes(x.id)),'Recomendação respeita filtro CIA mesmo quando origem primária difere');
 const nobody=await api.request('/api/search',{query:'pastor',settings:{collections:{principal:false,avulsos:false,cia:false,pessoal:false}}});assert.equal(nobody.total,0);
 const custom=await api.request('/api/import',{data:{name:'Repertório Pessoal',songs:[{title:'019 - Nova canção particular',content:'Uma letra pessoal de esperança e fé em tempos difíceis, com amor, proteção e confiança, que não repete nenhuma outra.'}]}});
 assert.equal(custom.count,5);assert.equal((await api.request('/api/status')).collections.pessoal,1);
 assert.equal((await api.request('/api/search',{query:'nova canção',settings:filter('principal')})).results.some(x=>x.title==='Nova canção particular'),false);
 const stored=cache.get('hymns');assert.equal(stored.hymns.length,5);assert.equal(stored.hymns[0].collectionRefs.length,2);
 assert.match(read('index.html'),/id="collection-cia"/);assert.match(read('index.html'),/data-collection="avulsos"/);
 assert.match(read('app.js'),/settings-collection-counts/);
 console.log('v1.9: múltiplas coleções, filtros, numeração, deduplicação, reimportação e recomendações aprovados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
