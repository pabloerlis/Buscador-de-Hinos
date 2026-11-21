'use strict';
/*
 * Comparação pareada e reprodutível: RRF v2.6.3, eventos A desligados,
 * eventos A ligados e eventos B. As três árvores de código utilizam o mesmo
 * catálogo, os mesmos índices bíblicos e os mesmos vetores de consulta E5.
 * Sem letras nos relatórios, sem ajustes específicos no mecanismo de busca.
 *
 * Uso: node tests/qa_event_variant_matrix.js catalog.json vectors.json \
 *        /tmp/rrf/assets ./app/src/main/assets /tmp/event-b/assets
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto'),vm=require('node:vm');

const [catalogPath,vectorsPath,rrfDir,frameDir,alignDir]=process.argv.slice(2);
assert.ok([catalogPath,vectorsPath,rrfDir,frameDir,alignDir].every(Boolean),
  'Uso: node tests/qa_event_variant_matrix.js catalog.json vectors.json rrf-assets frames-assets alignment-assets');

const sharedFiles=['semantic-db.json','semantic-stories.json','semantic-bridge.json',
  'scripture-pt.json','bible-graph.json','e5-index.json'];
const shared=Object.fromEntries(sharedFiles.map(file=>[
  file,JSON.parse(fs.readFileSync(path.join(frameDir,file),'utf8'))
]));
const corpus=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const vectors=JSON.parse(fs.readFileSync(vectorsPath,'utf8'));
assert.ok(vectors.length>=7,'Esperadas ao menos 7 consultas E5 rotuladas');

const cases=vectors.map(x=>({query:x.query,positives:[[x.collection,x.number]],vector:x.vector}));
cases.push(
  {query:'Mulher do fluxo de sangue',positives:[['principal',67],['principal',261],['principal',374]],
    negatives:[['principal',10]]},
  {query:'Marcos 5:25-34',positives:[['principal',67],['principal',261],['principal',374]],
    negatives:[['principal',10]]},
  {query:'Marcos 10:46-52',positives:[['cia',62],['cia',63]]},
  {query:'João 11:1-44',positives:[['principal',704]]},
  {query:'Marcos 4:35-41',positives:[['principal',310]]},
  {query:'Lucas 15:11-32',positives:[['principal',286]]},
  {query:'Ovelha perdida',positives:[['principal',259]]}
);
assert.equal(cases.length,14,'A matriz fixada deve conter 14 consultas');
assert.equal(cases.reduce((n,c)=>n+c.positives.length,0),19,'Esperados 19 alvos rotulados');

const sourceNames=['scripture-index.js','semantic-engine.js','story-engine.js',
  'bridge-engine.js','bible-context.js','bible-graph-engine.js',
  'recommendation-engine.js','vector-index.js','rrf-fusion.js',
  'repertoire-store.js','offline-api.js'];
const normalizeNumber=n=>String(n??'').padStart(3,'0');
const rank=(ranked,[collection,number])=>{
  const n=normalizeNumber(number);
  const i=ranked.findIndex(x=>x.collection_ids?.includes(collection)&&normalizeNumber(x.number)===n);
  return i<0?null:i+1;
};
const metric=ranks=>{
  const n=ranks.length;
  const recall=k=>ranks.filter(x=>x!==null&&x<=k).length/n;
  const ndcg5=ranks.reduce((sum,r)=>sum+(r&&r<=5?1/Math.log2(r+1):0),0)/n;
  return {targets:n,recall_at_10:recall(10),recall_at_20:recall(20),ndcg_at_5:ndcg5};
};

function createEnvironment(assetDir){
  const files=new Set(fs.readdirSync(assetDir));
  const indexed=new Map(),prefs=new Map();
  const indexedDB={open(){
    const req={};
    queueMicrotask(()=>{
      req.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
        const tx={objectStore(){return {
          get(k){const q={};queueMicrotask(()=>{q.result=indexed.get(k);q.onsuccess?.();});return q;},
          put(v,k){indexed.set(k,v);queueMicrotask(()=>tx.oncomplete?.());}
        };}};return tx;
      }};req.onsuccess?.();
    });
    return req;
  }};
  const ctx=vm.createContext({console,crypto:crypto.webcrypto,TextEncoder,
    atob:s=>Buffer.from(s,'base64').toString('binary'),
    setTimeout,clearTimeout,queueMicrotask,indexedDB,
    window:{indexedDB,NativeVector:{status:()=>true}},
    localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
    document:{createElement(){return {content:{textContent:''},set innerHTML(s){
      this.content.textContent=String(s).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');
    }};}},
    fetch:async file=>({ok:Object.hasOwn(shared,file),json:async()=>shared[file]})
  });
  const scripts=sourceNames.flatMap(name=>{
    if(name!=='story-engine.js')return [name];
    return [
      ...(files.has('event-alignment.js')?['event-alignment.js']:[]),
      'story-engine.js',
      ...(files.has('event-frame-engine.js')?['event-frame-engine.js']:[])
    ];
  });
  for(const name of scripts)vm.runInContext(
    fs.readFileSync(path.join(assetDir,name),'utf8'),ctx,{filename:name}
  );
  return {api:vm.runInContext('OfflineAPI',ctx),ctx,
    hasFrames:files.has('event-frame-engine.js'),
    hasAlignment:files.has('event-alignment.js')};
}

async function evaluate(name,assetDir,eventEvidence){
  const env=createEnvironment(assetDir);
  const imported=await env.api.request('/api/import',{data:corpus});
  const status=await env.api.request('/api/status');
  assert.ok(imported.count>=1500,'Catálogo incompleto em '+name);
  assert.ok(status.vector_count>=1450,'Índice E5 não carregado em '+name);
  if(env.hasFrames)assert.ok(status.event_ready,'EventFrameEngine não iniciou');
  const rows=[];
  for(const item of cases){
    const started=performance.now();
    const response=await env.api.request('/api/search',{query:item.query,
      ...(item.vector?{vector_query:item.vector}:{}),
      settings:{bibleGraph:true,scripture:true,narratives:true,eventEvidence,
        mode:'balanced',strength:75,vectorMode:item.vector?'balanced':'off',
        fusionMode:'rrf',pageSize:10},
      _forRecommendations:true
    });
    assert.ok(Array.isArray(response._fullRanked),'Ranking não disponível: '+name+' / '+item.query);
    rows.push({query:item.query,
      positives:item.positives.map(([collection,number])=>({collection,
        number:normalizeNumber(number),rank:rank(response._fullRanked,[collection,number])})),
      negatives:(item.negatives||[]).map(([collection,number])=>({collection,
        number:normalizeNumber(number),rank:rank(response._fullRanked,[collection,number])})),
      elapsed_ms:Math.round(performance.now()-started)
    });
  }
  const grades=rows.flatMap(x=>x.positives.map(p=>p.rank));
  return {name,source:assetDir,events_enabled:eventEvidence,metrics:metric(grades),
    false_positive_top10:rows.flatMap(x=>x.negatives.filter(p=>p.rank!==null&&p.rank<=10)
      .map(p=>({query:x.query,collection:p.collection,number:p.number,rank:p.rank}))),
    rows,
    ...(env.hasAlignment?{negation_probe:(()=>{
      const alignment=vm.runInContext('EventAlignment',env.ctx);
      const negative=alignment.analyze({groups:[['filho'],['voltou'],['perdoou']]},
        'O filho não voltou\nO pai não perdoou');
      return {tier:negative.tier,score:negative.score,
        interpretation:'tier alto em ações negadas é falso positivo potencial'};
    })()}: {})
  };
}

(async()=>{
  const variants=[
    await evaluate('rrf_2_6_3',rrfDir,false),
    await evaluate('frames_2_6_4_off',frameDir,false),
    await evaluate('frames_2_6_4_on',frameDir,true),
    await evaluate('alignment_2_6_4_b',alignDir,true)
  ];
  const [baseline,disabled,frames,alignment]=variants;
  const summary=Object.fromEntries(variants.map(x=>[x.name,{...x.metrics,
    false_positive_top10:x.false_positive_top10.length,
    mean_query_ms:Math.round(x.rows.reduce((n,r)=>n+r.elapsed_ms,0)/x.rows.length),
    ...(x.negation_probe?{negation_probe:x.negation_probe}:{})}]));
  const report={schema_version:1,notes:[
    '14 consultas / 19 alvos; julgamentos parciais, sem reivindicação de relevância global',
    'Mesma biblioteca, mesmos vetores E5, mesmos arquivos de índices',
    'Nenhuma versão A/B deve ser mesclada sem revisão das posições individuais',
    'O probe de negação é diagnóstico e não altera os resultados de produção'
  ],catalog_count:corpus?.length||baseline.rows.length,cases:cases.length,
    source_commit:{baseline:'fda52c2fe548f5fcbcdd2bd9ea2359f02c774bcf',
      alignment:'1dda4aeeab7d7de4941736f34eb5a86240840b79'},
    summary,variants:variants.map(x=>({...x,source:undefined}))};
  const out=path.join(__dirname,'../qa-report/event-variant-matrix.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log('MATRIZ DE VARIANTES (mesmos casos/vetores): '+JSON.stringify(summary));
  // O motor desligado de A deve reproduzir exatamente a base RRF.
  assert.deepEqual(disabled.rows.map(x=>x.positives),baseline.rows.map(x=>x.positives),
    'Desligar eventos A não reproduz a ordem da versão RRF 2.6.3');
  assert.ok(frames.metrics.recall_at_10>=baseline.metrics.recall_at_10-1e-9,
    'A perdeu alvos relevantes de top10 em relação ao RRF');
  assert.ok(frames.metrics.ndcg_at_5>=baseline.metrics.ndcg_at_5-.04,
    'A prejudicou excessivamente nDCG@5 em relação ao RRF');
  // B pode superar A; comparar números e casos no relatório antes de selecionar.
  assert.equal(alignment.metrics.targets,frames.metrics.targets);
  console.log('MATRIZ DE VARIANTES: gerada e validada; decisão exige inspeção do relatório.');
})().catch(err=>{console.error(err);process.exitCode=1;});
