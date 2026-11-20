'use strict';
/* Ponta a ponta do backend JS: importação -> hash -> E5 int8 por estrofe
   -> ranking -> trecho justificável -> filtros de repertório. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const assets=path.join(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(assets,name),'utf8');
const data=Object.fromEntries(['semantic-db.json','semantic-bridge.json','semantic-stories.json',
  'scripture-pt.json','bible-graph.json'].filter(name=>fs.existsSync(path.join(assets,name)))
  .map(name=>[name,JSON.parse(read(name))]));
const input=[
  {title:'001 - Um encontro',content:'Primeira manhã distante\nO povo saiu da praça\n\nA alma buscou um sinal\nNo manto achou sua resposta\nRecebeu consolo e vida\n\nO dia ficou tranquilo'},
  {title:'002 - Um canto distante',content:'O campo coberto de flores\nA brisa passeia na serra'},
  {title:'003 - Uma outra mensagem',content:'O caminho era longo\nVi um novo horizonte'}
];
function norm(x){return String(x).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();}
function fp(title,lyrics){return crypto.createHash('sha256').update(norm(title+'|'+lyrics)).digest('hex').slice(0,24);}
function vec(idx){const bytes=Buffer.alloc(384);bytes[idx]=127;return bytes.toString('base64');}
const records=[
  {id:1,t:'um encontro',f:fp('Um encontro',input[0].content),s:[[0,2],[2,5],[5,6]],v:[vec(0),vec(1),vec(2)]},
  {id:2,t:'um canto distante',f:fp('Um canto distante',input[1].content),s:[[0,2]],v:[vec(0)]},
  {id:3,t:'uma outra mensagem',f:fp('Uma outra mensagem',input[2].content),s:[[0,2]],v:[vec(2)]}
];
data['e5-index.json']={version:3,dimension:384,count:3,passages:5,records};
const database=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{
  req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tr={objectStore(){return {
      get(key){const result={};queueMicrotask(()=>{result.result=database.get(key);result.onsuccess?.();});return result;},
      put(value,key){database.set(key,value);queueMicrotask(()=>tr.oncomplete?.());}
    };}};return tr;
  }};
  req.onsuccess?.();
});return req;}};
const doc={createElement(){return {content:{textContent:''},set innerHTML(x){
  this.content.textContent=String(x).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'');
}};}};
const ctx=vm.createContext({console,crypto:crypto.webcrypto,TextEncoder,atob:s=>Buffer.from(s,'base64').toString('binary'),
  setTimeout,clearTimeout,queueMicrotask,window:{indexedDB,NativeVector:{status:()=>true}},indexedDB,document:doc,
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  fetch:async name=>({ok:Object.hasOwn(data,name),json:async()=>data[name]})});
for(const name of ['scripture-index.js','semantic-engine.js','story-engine.js','bridge-engine.js',
  'bible-context.js','bible-graph-engine.js','recommendation-engine.js','vector-index.js','rrf-fusion.js',
  'repertoire-store.js','offline-api.js'])
  vm.runInContext(read(name),ctx,{filename:name});
const request=vm.runInContext('OfflineAPI.request',ctx);
const queryVector=[0,1,...Array(382).fill(0)];
(async()=>{
  const imported=await request('/api/import',{data:[{name:'Coletânea 2018',songs:input}]});
  assert.equal(imported.count,3);
  const status=await request('/api/status');
  assert.equal(status.vector_count,3,'Importação e indexação E5 devem ocorrer juntas');
  assert.equal(status.vector_status.passages,5);
  const query='buscaacontecimentossemtermosidênticos';
  const result=await request('/api/search',{query,vector_query:queryVector,
    settings:{vectorMode:'balanced',mode:'balanced',pageSize:10}});
  assert.ok(result.results.length>0,'Embedding precisa recuperar canções sem token lexical');
  assert.equal(result.results[0].number,'001','Hino com evidência na estrofe central precisa vencer');
  assert.match(result.results[0].snippet,/No manto achou sua resposta/,'Snippet deve vir da passagem recuperada');
  assert.equal(result.results[0].vector_similarity,100);
  assert.ok(result.interpretation?.some?.(x=>x.includes('trechos'))||
            (result.results[0].reason||'').includes('E5'), 'Exibir evidência de resultado E5');
  const fallback=await request('/api/search',{query,vector_query:queryVector,settings:{vectorMode:'balanced',fusionMode:'legacy',pageSize:10}});
  const fused=await request('/api/search',{query,vector_query:queryVector,settings:{vectorMode:'balanced',fusionMode:'rrf',pageSize:10}});
  assert.equal(fallback.results[0].number,'001','Ranking aditivo continua disponível');
  assert.equal(fused.results[0].number,'001','RRF precisa recuperar estrofe central com E5');
  assert.ok(!fused.results[0]._fusionSignals,'Sinais internos não devem vazar nos cartões da interface');
  assert.ok(fused.interpretation?.some?.(x=>x.includes('RRF')) || fused.results[0].snippet.includes('manto'),'Diagnóstico RRF ou evidência textual ausente');
  const off=await request('/api/search',{query,vector_query:queryVector,settings:{vectorMode:'off',pageSize:10}});
  assert.equal(off.total,0,'Desativar E5 não pode simular semântica neural');
  const literal=await request('/api/search',{query:'Hino 002',vector_query:queryVector,
    settings:{vectorMode:'strong',pageSize:10}});
  assert.equal(literal.results[0]?.number,'002','Número exato tem prioridade sobre E5');
  await request('/api/repertoire/mark',{hymn_id:1,not_learned:true});
  const hidden=await request('/api/search',{query,vector_query:queryVector,settings:{vectorMode:'balanced',pageSize:10}});
  assert.ok(!hidden.results.some(x=>x.number==='001'),'Não aprendido não pode poluir lista principal');
  assert.ok(hidden.not_learned_results.some(x=>x.number==='001'),
    'Não aprendido deve continuar consultável em área separada');
  console.log('INTEGRAÇÃO E5 — APROVADA: importação, hash, estrofe central, busca offline, evidência, modo off, número e repertório.');
})().catch(error=>{console.error(error);process.exitCode=1;});
