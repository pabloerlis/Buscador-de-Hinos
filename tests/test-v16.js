'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dir=path.join(__dirname,'../app/src/main/assets');const file=x=>fs.readFileSync(path.join(dir,x),'utf8');
const themes=JSON.parse(file('semantic-db.json')),stories=JSON.parse(file('semantic-stories.json'));
const cache=new Map();
const storage={open(){const r={};setTimeout(()=>{r.result={objectStoreNames:{contains:()=>true},transaction(){const tx={objectStore(){return {get(key){const q={};setTimeout(()=>{q.result=cache.get(key);q.onsuccess?.();},0);return q;},put(value,key){setTimeout(()=>{cache.set(key,value);tx.oncomplete?.();},0);}};}};return tx;},close(){}};r.onsuccess?.();},0);return r;}};
const ctx={window:{indexedDB:storage},indexedDB:storage,console,setTimeout,clearTimeout,
 document:{createElement(){return {content:{textContent:''},set innerHTML(html){this.content.textContent=html.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'');}};}},
 fetch:async url=>({ok:true,json:async()=>String(url).includes('semantic-stories')?stories:themes})};
vm.createContext(ctx);for(const name of ['semantic-engine.js','story-engine.js','bible-context.js','recommendation-engine.js','offline-api.js'])vm.runInContext(file(name),ctx);
const api=vm.runInContext('OfflineAPI',ctx);
const sample=[
 {title:'001 - Voltei pra ti meu pai',content:'Estive longe de ti, mas regressei. Voltei pra ti meu Pai, perdoa-me e acolhe o coração perdido.'},
 {title:'002 - Doce reencontro',content:'Longe andei, hoje quero retornar à casa do pai. Seu perdão me alcançou, meu pai me recebeu.'},
 {title:'003 - Filho amado',content:'O filho foi chamado. Nosso Senhor e o Pai são eternamente glorificados.'},
 {title:'004 - Resgate do pastor',content:'A ovelha se perdeu no deserto. O pastor a encontrou e trouxe de volta ao redil.'},
 {title:'005 - Agradecimento',content:'Dou graças pela bondade, pelo amor e pela vida. Quero agradecer sempre.'},
 {title:'006 - Gratidão sem fim',content:'Sou grato pela misericórdia. Dou graças e agradeço pela esperança que o Senhor trouxe.'},
 {title:'007 - Louvor da manhã',content:'Agradeço por meu alimento, celebro com felicidade e alegria o novo dia.'},
 {title:'008 - Cristo acalma',content:'O mar e as ondas se agitaram. A tempestade cessou e o vento se calou.'},
 {title:'009 - O novo retorno',content:'Meu pai me acolheu quando voltei, estou arrependido. Sou filho que foi perdoado.'},
 {title:'010 - Caminho da redenção',content:'Confessei minha culpa, retornei ao pai, fui perdoado. O perdido agora foi achado.'},
 {title:'011 - Paz verdadeira',content:'No descanso da alma há paz e confiança, não temo o amanhã.'},
 {title:'012 - Graça e salvação',content:'O sacrifício na cruz traz remissão do pecado e redenção.'}
];
(async()=>{
 const imported=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs:sample}]});assert.equal(imported.count,12);
 const initial=await api.request('/api/search',{query:'Filho Pródigo'});assert.equal(initial.results[0].number,'001');
 const request={hymn_id:1,original_query:'Filho Pródigo',active_query:'Filho Pródigo',settings:{recCount:5,recWeight:65}};
 let r=await api.request('/api/recommend',request);
 assert.ok(r.results.length>0,'Recomendações devem aparecer');
 assert.equal(r.anchor_id,1);assert.equal(r.weight_percent,65);
 console.log('Recomendações retorno:',r.results.map(x=>({n:x.number,sim:x.similarity_percent,q:x.query_percent,combined:x.compatibility_percent,reason:x.reason.slice(0,55)})));
 assert.ok(r.results.slice(0,4).some(x=>x.number==='002'),'Deve recomendar retorno e perdão sem a palavra filho');
 assert.ok(r.results.some(x=>x.number==='009'||x.number==='010'),'Narrativas similares deveriam aparecer');
 assert.ok(!r.results.some(x=>x.number==='003'),'A palavra genérica filho não é afinidade suficiente');
 assert.ok(r.results.every(x=>Number.isInteger(x.compatibility_percent)&&x.compatibility_percent>=0&&x.compatibility_percent<=100));
 assert.ok(r.results.every(x=>x.reason&&x.reason.includes('comum')||x.reason.includes('letras')));
 assert.ok(r.results.every(x=>x.query_percent!==null&&x.similarity_percent!==null));
 assert.ok(r.results.every((x,i,a)=>i===0||a[i-1].compatibility_percent>=x.compatibility_percent));
 const changed=await api.request('/api/recommend',{...request,hymn_id:2,visited:[1,2]});
 assert.ok(!changed.results.some(x=>x.id===1||x.id===2));
 assert.ok(changed.results.some(x=>x.number==='009'||x.number==='010'),'Segundo clique deve gerar novas sugestões');
 const back=await api.request('/api/recommend',{...request,visited:[1]});assert.ok(back.results.some(x=>x.number==='002'));
 const byLyrics=await api.request('/api/recommend',{...request,settings:{recWeight:100}});
 assert.ok(byLyrics.results.every(x=>x.compatibility_percent===x.similarity_percent));
 const byQuery=await api.request('/api/recommend',{...request,settings:{recWeight:0}});
 assert.ok(byQuery.results.every(x=>x.compatibility_percent===x.query_percent));
 const noQuery=await api.request('/api/recommend',{...request,original_query:'',active_query:'',settings:{recWeight:0}});
 assert.equal(noQuery.weight_percent,100);
 assert.ok(noQuery.results.every(x=>x.query_percent===null&&x.compatibility_percent===x.similarity_percent));
 const hide=await api.request('/api/recommend',{...request,settings:{recBreakdown:false}});
 assert.ok(hide.results.every(x=>!('query_percent' in x)&&!('similarity_percent' in x)));
 const visitedOff=await api.request('/api/recommend',{...request,visited:[2],settings:{recAvoidVisited:false}});
 assert.ok(visitedOff.results.some(x=>x.id===2));
 const all=await api.request('/api/recommend',{...request,settings:{recCount:10}});
 assert.ok(all.results.length>=r.results.length && all.results.length<=10);
 const cut=await api.request('/api/recommend',{...request,settings:{recContext:false}});
 assert.equal(cut.original_query,'');assert.equal(cut.weight_percent,100);
 assert.equal(api.searchOptions({recWeight:-4}).recWeight,0);
 assert.equal(api.searchOptions({recWeight:150}).recWeight,100);
 assert.equal(api.searchOptions({recCount:99}).recCount,5);
 await assert.rejects(api.request('/api/recommend',{hymn_id:999,settings:{}}),/não encontrado/i);
 console.log('Testes v1.6: recomendações sem IA, mudança de âncora, contexto inicial, percentuais e anti-loop aprovados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
