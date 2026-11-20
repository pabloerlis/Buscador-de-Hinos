'use strict';
/* QA real sem redistribuir letras: mesma versão do catálogo, mesmas consultas,
 * comparação pareada com o motor de ações DESLIGADO/ATIVADO.
 * Combina exemplos diretos, hard negatives, buscas por referência e vetores.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),
  crypto=require('node:crypto'),vm=require('node:vm');
const catalogPath=process.argv[2],vectorPath=process.argv[3];
assert.ok(catalogPath&&vectorPath,'Uso: node tests/qa_event_ranking.js catalogo.json vetores.json');
const root=path.join(__dirname,'../app/src/main/assets'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const data=Object.fromEntries(['semantic-db.json','semantic-stories.json','semantic-bridge.json',
  'scripture-pt.json','bible-graph.json','e5-index.json']
  .map(f=>[f,JSON.parse(read(f))]));
const db=new Map(),prefs=new Map();
const indexedDB={open(){
  const req={};queueMicrotask(()=>{
    req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
      const tx={objectStore(){return {
        get(k){const rq={};queueMicrotask(()=>{rq.result=db.get(k);rq.onsuccess?.();});return rq;},
        put(v,k){db.set(k,v);queueMicrotask(()=>tx.oncomplete?.());}
      };}};return tx;
    }};req.onsuccess?.();
  });return req;
}};
const doc={createElement(){return {content:{textContent:''},set innerHTML(s){
  this.content.textContent=String(s).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');
}};}};
const env=vm.createContext({console,crypto:crypto.webcrypto,TextEncoder,
  atob:s=>Buffer.from(s,'base64').toString('binary'),
  setTimeout,clearTimeout,queueMicrotask,indexedDB,window:{indexedDB,NativeVector:{status:()=>true}},
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  document:doc,fetch:async f=>({ok:Object.hasOwn(data,f),json:async()=>data[f]})});
for(const name of ['scripture-index.js','semantic-engine.js','story-engine.js','event-frame-engine.js',
  'bridge-engine.js','bible-context.js','bible-graph-engine.js','recommendation-engine.js',
  'vector-index.js','rrf-fusion.js','repertoire-store.js','offline-api.js'])
    vm.runInContext(read(name),env,{filename:name});
const api=vm.runInContext('OfflineAPI',env);
const vectors=JSON.parse(fs.readFileSync(vectorPath,'utf8'));
const cases=vectors.map(v=>({query:v.query,positive:[[v.collection,v.number]],vector:v.vector}));
cases.push(
  {query:'Mulher do fluxo de sangue',positive:[['principal',67],['principal',261],['principal',374]],negative:[['principal',10]]},
  {query:'Marcos 5:25-34',positive:[['principal',67],['principal',261],['principal',374]],negative:[['principal',10]]},
  {query:'Marcos 10:46-52',positive:[['cia',62],['cia',63]]},
  {query:'João 11:1-44',positive:[['principal',704]]},
  {query:'Marcos 4:35-41',positive:[['principal',310]]},
  {query:'Lucas 15:11-32',positive:[['principal',286]]},
  {query:'Ovelha perdida',positive:[['principal',259]]}
);
assert.ok(cases.length>=14);
const normalizeId=x=>String(x||'').padStart(3,'0');
function rank(ranked,collection,number){
  const i=ranked.findIndex(x=>x.collection_ids?.includes(collection)&&normalizeId(x.number)===normalizeId(number));
  return i<0?null:i+1;
}
function evalMetrics(rows,key){
  const graded=rows.flatMap(x=>x.positives.map(p=>x[key].find(y=>y.collection===p.collection&&y.number===p.number)?.rank??null));
  const count=graded.length;
  const recall=k=>graded.filter(x=>x!==null&&x<=k).length/count;
  const ndcg=()=>graded.reduce((v,r)=>v+(r&&r<=5?1/Math.log2(r+1):0),0)/count;
  return {count,recall_at_10:recall(10),recall_at_20:recall(20),ndcg_at_5:ndcg()};
}
(async()=>{
  const data=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
  const imported=await api.request('/api/import',{data});
  const status=await api.request('/api/status');
  assert.ok(imported.count>=1500,'Coletânea de avaliação incompleta');
  assert.ok(status.event_ready&&status.event_stats?.episodes>=48,
    'O motor de acontecimentos não foi realmente carregado no OfflineAPI');
  const outcomes=[];
  let eventEvidence=0;
  for(const item of cases){
    const results={};
    for(const on of [false,true]){
      const settings={eventEvidence:on,bibleGraph:true,scripture:true,narratives:true,
        mode:'balanced',strength:75,vectorMode:item.vector?'balanced':'off',fusionMode:'rrf',pageSize:10};
      const begin=performance.now();
      const result=await api.request('/api/search',{query:item.query,
        ...(item.vector?{vector_query:item.vector}:{}),settings,_forRecommendations:true});
      const records=result._fullRanked;
      results[on?'on':'off']=(item.positive||[]).map(([collection,number])=>({
        collection,number:normalizeId(number),rank:rank(records,collection,number)
      }));
      results[on?'latencyOn':'latencyOff']=performance.now()-begin;
      if(on)eventEvidence+=records.slice(0,40).filter(x=>x.match_type==='acontecimento').length;
      if(on&&(item.negative||[]).length){
        for(const [collection,number] of item.negative){
          const position=rank(records,collection,number);
          assert.ok(position===null||position>10,
            'Falso positivo puramente temático entrou no top10: '+item.query+' '+number+' posição '+position);
        }
      }
    }
    outcomes.push({query:item.query,positives:(item.positive||[]).map(([collection,number])=>({collection,number:normalizeId(number)})),
      off:results.off,on:results.on,
      elapsed_ms_off:Math.round(results.latencyOff),elapsed_ms_on:Math.round(results.latencyOn)});
  }
  const baseline=evalMetrics(outcomes,'off'),current=evalMetrics(outcomes,'on');
  const report={schema_version:1,catalog:imported.count,cases:outcomes.length,positives:current.count,
    baseline,current,eventMatchesInTop40:eventEvidence,results:outcomes};
  const dest=path.join(__dirname,'../qa-report/event-ranking.json');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
  console.log('AGENTE EVENTOS — MÉTRICAS '+JSON.stringify({baseline,current,
    eventMatchesInTop40:eventEvidence,count:outcomes.length}));
  // Todos os hinos relevantes são rotulados apenas em parte; comparam-se
  // OS MESMOS casos nas duas configurações, sem exceções por hino.
  const maxLoss=1/current.count;
  assert.ok(current.recall_at_20+1e-9>=baseline.recall_at_20-maxLoss,
    'Eventos perderam mais de um hino relevante no top20');
  assert.ok(current.ndcg_at_5+1e-9>=baseline.ndcg_at_5-.04,
    'Ações prejudicaram excessivamente o topo dos resultados');
  assert.ok(eventEvidence>=2,'Motor de acontecimentos não influencia nenhum resultado com evidência suficiente');
  console.log('AGENTE EVENTOS — APROVADO: sem regressão significativa, evidência rastreável e controle desligável.');
})().catch(e=>{console.error(e);process.exitCode=1;});
