'use strict';
// Independent episode relevance gate. Labels are provisional and only used in QA.
// An unreviewed hymn is never automatically assigned grade zero.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const groups=[
 {id:'hemorrhage',queries:['Marcos 5:25-34','Mulher do fluxo de sangue','Uma mulher sofria havia doze anos; no meio da multidão tocou a roupa de Jesus confiando que seria curada','Depois de anos de doença, alguém se aproximou do Mestre por trás e recuperou a saúde ao tocar seu manto'],targets:[['principal','261'],['principal','067'],['principal','374']]},
 {id:'prodigal',queries:['Lucas 15:11-32','Filho pródigo','Um jovem deixou a casa de seu pai, perdeu tudo, arrependeu-se e voltou; foi recebido com misericórdia','Depois de viver longe de casa e desperdiçar sua herança, decidiu regressar e pedir perdão ao pai'],targets:[['principal','286'],['principal','191'],['avulsos','VEM Ó PRÓDIGO']],weak:[['principal','264']]},
 {id:'blind',queries:['Marcos 10:46-52','Bartimeu','Um mendigo cego gritou pelo Filho de Davi à beira do caminho, apesar de mandarem que se calasse, e recuperou a visão'],targets:[['cia','062'],['cia','063']]},
 {id:'lazarus',queries:['João 11:1-44','Ressurreição de Lázaro','Jesus chamou para fora do sepulcro um amigo que já havia morrido'],targets:[['principal','704'],['avulsos','LÁZARO']]},
 {id:'storm',queries:['Marcos 4:35-41','Jesus acalma a tempestade','Durante uma travessia os discípulos temeram morrer; Cristo ordenou ao vento e ao mar que se aquietassem'],targets:[['principal','310']]},
 {id:'sheep',queries:['Lucas 15:3-7','Ovelha perdida','O pastor deixou o rebanho para procurar uma única ovelha que havia se extraviado e voltou alegre com ela'],targets:[['principal','259'],['avulsos','ERAM CEM OVELHAS']]}
];
if(process.argv[2]==='--queries'){console.log(JSON.stringify(groups.flatMap(g=>g.queries)));process.exit(0);}
const [catalogPath,vectorPath]=process.argv.slice(2);
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const raw=fs.readFileSync(catalogPath),catalog=JSON.parse(raw);
const vectors=JSON.parse(fs.readFileSync(vectorPath,'utf8'));
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'57d42fb0bcc881a62b210dd1a3972822d2c39856f7a01278e104d407bf1b747a');
const names=['semantic-db.json','semantic-bridge.json','semantic-stories.json',
  'scripture-pt.json','bible-graph.json','e5-index.json'];
const data=Object.fromEntries(names.map(n=>[n,JSON.parse(fs.readFileSync(path.join(assets,n),'utf8'))]));
const mem=new Map(),prefs=new Map();
const indexedDB={open(){const req={};queueMicrotask(()=>{
  req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tx={objectStore(){return {
      get(k){const q={};queueMicrotask(()=>{q.result=mem.get(k);q.onsuccess?.();});return q;},
      put(v,k){mem.set(k,v);queueMicrotask(()=>tx.oncomplete?.());}
    };}};return tx;
  }};req.onsuccess?.();});return req;
}};
const context=vm.createContext({console,crypto:crypto.webcrypto,TextEncoder,indexedDB,
  atob:s=>Buffer.from(s,'base64').toString('binary'),queueMicrotask,setTimeout,clearTimeout,
  window:{indexedDB,NativeVector:{status:()=>true}},
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
  fetch:async n=>({ok:Object.hasOwn(data,n),json:async()=>data[n]}),
  document:{createElement(){return {content:{textContent:''},set innerHTML(s){
    this.content.textContent=String(s).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');
  }};}}});
for(const n of ['scripture-index.js','semantic-engine.js','story-engine.js',
 'event-frame-engine.js','bridge-engine.js','bible-context.js','bible-graph-engine.js',
 'recommendation-engine.js','vector-index.js','rrf-fusion.js','repertoire-store.js','offline-api.js'])
  vm.runInContext(fs.readFileSync(path.join(assets,n),'utf8'),context,{filename:n});
const api=vm.runInContext('OfflineAPI',context);

function matches(hit,[collection,value]){
 return hit.collection_ids?.includes(collection)&&(/^\d+$/.test(value)?String(hit.number||'').padStart(3,'0')===value:String(hit.title).toUpperCase()===value);
}
(async()=>{
 const imported=await api.request('/api/import',{data:catalog});
 const status=await api.request('/api/status');
 assert.equal(imported.count,1557);assert.ok(status.vector_count>=1450);
 const rows=[];
 for(const g of groups)for(const query of g.queries){
  const vector=vectors[query];assert.ok(Array.isArray(vector)&&vector.length===384&&vector.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...vector)-1)<.03);
  const payload={query,vector_query:vector,_forRecommendations:true,settings:{bibleGraph:true,scripture:true,narratives:true,eventEvidence:true,mode:'balanced',strength:75,vectorMode:'balanced',fusionMode:'rrf',pageSize:10}};
  const result=await api.request('/api/search',payload);
  assert.ok(Array.isArray(result._fullRanked));
  const ranked=result._fullRanked;
  const first=ranked.findIndex(h=>g.targets.some(t=>matches(h,t)))+1;
  const weak=ranked.findIndex(h=>(g.weak||[]).some(t=>matches(h,t)))+1;
  const top=ranked.slice(0,10).map(h=>({collection:h.collection,number:h.number,title:h.title,score:h.relevance_score,review:g.targets.some(t=>matches(h,t))?'provisional_positive':(g.weak||[]).some(t=>matches(h,t))?'user_contested':'unreviewed'}));
  const row={episode:g.id,query,first_known_positive:first||null,user_contested_rank:weak||null,top10:top,pass:first>0&&first<=3&&(!weak||weak>3)};
  rows.push(row);console.log(JSON.stringify(row));
 }
 const report={schema_version:1,catalog_count:imported.count,vector_count:status.vector_count,criteria:'At least one provisional positive in top 3 for every formulation; user-contested hymn 264 outside top 3 for explicit prodigal episode; other hymns unreviewed, not negatives.',human_review_status:'pending',nli_inference:false,rows,known_positive_top1:rows.filter(r=>r.first_known_positive===1).length/rows.length,known_positive_top3:rows.filter(r=>r.first_known_positive&&r.first_known_positive<=3).length/rows.length,failed:rows.filter(r=>!r.pass).length};
 fs.mkdirSync(path.join(root,'qa-report'),{recursive:true});
 fs.writeFileSync(path.join(root,'qa-report/contextual-absolute.json'),JSON.stringify(report,null,2)+'\n');
 console.log('ABSOLUTE QUALITY GATE '+JSON.stringify({cases:rows.length,top1:report.known_positive_top1,top3:report.known_positive_top3,failed:report.failed}));
 if(report.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
