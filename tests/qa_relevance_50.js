'use strict';
/*
 * Etapa 6: benchmark exploratório de 50 consultas, mesmas fontes e configurações,
 * sem alterar o ranking. A avaliação semântica e os testes exatos são SEPARADOS.
 * Julgamentos antigos foram herdados; paráfrases ainda precisam de revisão humana.
 * NUNCA guardar letras de hinos no repositório ou nos relatórios.
 *
 * node tests/qa_relevance_50.js catalog.json e5-vectors.json rrf-assets current-assets
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const [catalogPath,vectorsPath,rrfDir,currentDir,paraphraseVectorsPath]=process.argv.slice(2);
assert.ok([catalogPath,vectorsPath,rrfDir,currentDir,paraphraseVectorsPath].every(Boolean),
  'Uso: node tests/qa_relevance_50.js catalog.json vectors.json rrf-assets current-assets paraphrase-vectors.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const vectors=JSON.parse(fs.readFileSync(vectorsPath,'utf8'));
assert.ok(Array.isArray(vectors)&&vectors.length===7,'São necessárias as mesmas 7 consultas E5 fixadas.');
const groups=Array.isArray(catalog)?catalog:Array.isArray(catalog.collections)?catalog.collections:
  Array.isArray(catalog.coletaneas)?catalog.coletaneas:Array.isArray(catalog.data)?catalog.data:[catalog];
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const collectionId=s=>{
  const n=norm(s);
  if(/(?:coletanea|coletania).*2018|principal/.test(n))return 'principal';
  if(/(?:^|\s)(?:cia|cias)(?:\s|$)|criancas|intermediarios|adolescentes/.test(n))return 'cia';
  if(/avulsos?/.test(n))return 'avulsos';
  return 'pessoal';
};
const parseTitle=raw=>{
  const title=String(raw||'').replace(/<[^>]*>/g,'').trim().replace(/\s+/g,' ');
  const p=title.match(/^(?:(?:hino|louvor)\s+)?(\d{1,4})\s*(?:[-–—.:)]\s*|\s+)(.+)$/i);
  return p?{title:p[2].trim(),number:p[1].padStart(3,'0')}:{title,number:null};
};
const songEntries=groups.filter(g=>Array.isArray(g?.songs)&&collectionId(g.name)!=='pessoal')
  .flatMap(g=>g.songs.map(raw=>{
    const parsed=parseTitle(raw?.title||raw?.titulo);
    const provided=raw?.number??raw?.numero;
    const number=provided!=null&&/^\d+$/.test(String(provided))?
      String(provided).padStart(3,'0'):parsed.number;
    return {title:parsed.title,number,collection:collectionId(g.name),
      hasContent:typeof(raw?.content??raw?.letra)==='string'&&String(raw?.content??raw?.letra).length>40};
  })).filter(x=>x.title&&x.hasContent);
assert.ok(songEntries.length>=1500,'Catálogo insuficiente para gerar controles de título.');
const matchSong=(source,target)=>source.collection===target.collection &&
  (target.title?norm(source.title)===norm(target.title):
    String(source.number||'')===String(target.number||''));
const make=(query,category,positives,intent,provenance,extra={})=>({
  query,category,positives,relation_id:intent,provenance,...extra
});
const curated=vectors.map((v,i)=>make(v.query,'semantic_legacy',
  [{collection:v.collection,number:String(v.number).padStart(3,'0')}],
  'e5_'+i,'baseline_historico_e5',{vector:v.vector}));
curated.push(
  make('Mulher do fluxo de sangue','semantic_legacy',
    [67,261,374].map(number=>({collection:'principal',number:String(number).padStart(3,'0')})),
    'marcos_5_25','benchmark_biblico_anterior',{negatives:[{collection:'principal',number:'010'}]}),
  make('Marcos 5:25-34','semantic_legacy',
    [67,261,374].map(number=>({collection:'principal',number:String(number).padStart(3,'0')})),
    'marcos_5_25','benchmark_biblico_anterior',{negatives:[{collection:'principal',number:'010'}]}),
  make('Marcos 10:46-52','semantic_legacy',
    [62,63].map(number=>({collection:'cia',number:String(number).padStart(3,'0')})),
    'marcos_10_46','benchmark_biblico_anterior'),
  make('João 11:1-44','semantic_legacy',
    [{collection:'principal',number:'704'}],'joao_11','benchmark_biblico_anterior'),
  make('Marcos 4:35-41','semantic_legacy',
    [{collection:'principal',number:'310'}],'marcos_4_35','benchmark_biblico_anterior'),
  make('Lucas 15:11-32','semantic_legacy',
    [{collection:'principal',number:'286'}],'lucas_15_11','benchmark_biblico_anterior'),
  make('Ovelha perdida','semantic_legacy',
    [{collection:'principal',number:'259'}],'lucas_15_4','benchmark_narrativo_anterior')
);
assert.equal(curated.length,14);
const paraphrases=[
  ['Uma mulher enferma tocou nas vestes de Jesus e foi curada','principal','261','marcos_5_25'],
  ['Doença de muitos anos foi curada depois de tocar no manto','principal','067','marcos_5_25'],
  ['A multidão cercava Jesus quando a mulher tocou sua roupa','principal','374','marcos_5_25'],
  ['O cego clamou à beira do caminho e voltou a enxergar','cia','062','marcos_10_46'],
  ['O cego chamou o Mestre e recebeu a visão','cia','063','marcos_10_46'],
  ['Um morto foi chamado para fora do túmulo','principal','704','joao_11'],
  ['Jesus ressuscitou o amigo que estava sepultado','principal','704','joao_11'],
  ['O vento e as ondas obedeceram ao comando de Jesus','principal','310','marcos_4_35'],
  ['Os discípulos tiveram medo de naufragar durante a travessia','principal','310','marcos_4_35'],
  ['O pastor foi procurar a ovelha que havia se extraviado','principal','259','lucas_15_4'],
  ['O filho arrependido voltou e seu pai o acolheu','principal','286','lucas_15_11'],
  ['O pai recebeu com perdão aquele filho que havia partido','principal','286','lucas_15_11']
].map(([query,collection,number,intent])=>make(query,'semantic_paraphrase',
  [{collection,number}],intent,'parafrase_de_passagem_requer_revisao_humana'));
assert.equal(paraphrases.length,12);
const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../qa/semantic-paraphrase-queries.json'),'utf8'));
const generated=JSON.parse(fs.readFileSync(paraphraseVectorsPath,'utf8'));
assert.equal(manifest.schema_version,1);
assert.equal(manifest.human_review_status,'pending');
assert.deepEqual(manifest.queries,paraphrases.map(p=>p.query),'Paráfrases de QA divergentes do manifesto');
assert.equal(generated.schema_version,1);
assert.equal(generated.source_kind,'actual_e5_onnx_inference');
assert.equal(generated.human_review_status,'pending');
assert.equal(generated.model_sha256,'4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c');
assert.equal(generated.queries.length,12,'Faltam embeddings reais para paráfrases');
for(let i=0;i<paraphrases.length;i++){
  const row=generated.queries[i], expected=paraphrases[i];
  assert.equal(row.query,expected.query,'Vetor E5 pertence a outra consulta');
  assert.ok(Array.isArray(row.vector)&&row.vector.length===384,'Dimensão E5 inválida');
  assert.ok(row.vector.every(Number.isFinite),'Vetor E5 não finito');
  const norm=Math.hypot(...row.vector);
  assert.ok(norm>.97&&norm<1.03,'Vetor E5 não normalizado');
  expected.vector=row.vector;
}

const numberControls=[
  ['hino 67','principal','067'],['hino 261','principal','261'],
  ['hino 374','principal','374'],['hino 704','principal','704'],
  ['hino 310','principal','310'],['hino 286','principal','286'],
  ['hino 259','principal','259'],['cia 62','cia','062']
].map(([query,collection,number])=>make(query,'exact_number',
  [{collection,number}],collection+':'+number,'numero_do_catalogo_fonte'));
assert.equal(numberControls.length,8);
const distinct=new Set([...curated,...paraphrases,...numberControls].map(x=>norm(x.query)));
const titleCandidates=Object.fromEntries(['principal','cia','avulsos'].map(id=>[id,
  songEntries.filter(x=>x.collection===id&&x.title.length>=12&&x.title.length<=70&&
    !/^\d+$/.test(x.title)&&x.number).sort((a,b)=>
      Number(a.number)-Number(b.number)||a.title.localeCompare(b.title,'pt'))]));
const titles=[];
for(const [id,quota] of [['principal',10],['cia',4],['avulsos',2]]){
  const list=titleCandidates[id]||[];
  for(let j=0;j<quota;j++){
    let hit=null;
    const seed=list.length?Math.floor((j+.5)*list.length/quota):0;
    for(let k=0;k<list.length;k++){
      const candidate=list[(seed+k)%list.length];
      if(!distinct.has(norm(candidate.title))){hit=candidate;break;}
    }
    if(!hit)continue;
    distinct.add(norm(hit.title));
    titles.push(make(hit.title,'exact_title',
      [{collection:hit.collection,number:hit.number,title:hit.title}],
      'title_'+hit.collection+'_'+hit.number,'titulo_do_catalogo_fonte'));
  }
}
if(titles.length<16){
  const rest=Object.values(titleCandidates).flat();
  for(const song of rest){
    if(titles.length>=16)break;
    if(distinct.has(norm(song.title)))continue;
    distinct.add(norm(song.title));
    titles.push(make(song.title,'exact_title',
      [{collection:song.collection,number:song.number,title:song.title}],
      'title_'+song.collection+'_'+song.number,'titulo_do_catalogo_fonte'));
  }
}
assert.equal(titles.length,16,'Faltam títulos distintos verificados no catálogo.');
const cases=[...curated,...paraphrases,...numberControls,...titles];
assert.equal(cases.length,50);
assert.ok(new Set(cases.map(x=>norm(x.query))).size>=47,
  'Consultas repetidas em excesso; o benchmark não tem 50 exemplos distintos.');
for(const item of cases)for(const target of item.positives){
  assert.ok(songEntries.some(x=>matchSong(x,target)),
    'Rótulo ausente do catálogo pinado: '+item.query+' '+JSON.stringify(target));
}
const shared=Object.fromEntries(['semantic-db.json','semantic-stories.json','semantic-bridge.json',
  'scripture-pt.json','bible-graph.json','e5-index.json'].map(name=>
    [name,JSON.parse(fs.readFileSync(path.join(currentDir,name),'utf8'))]));
const scripts=['scripture-index.js','semantic-engine.js','story-engine.js',
  'bridge-engine.js','bible-context.js','bible-graph-engine.js',
  'recommendation-engine.js','vector-index.js','rrf-fusion.js','repertoire-store.js',
  'offline-api.js'];
function environment(directory){
  const mem=new Map(),prefs=new Map();
  const indexedDB={open(){
    const request={};queueMicrotask(()=>{
      request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
        const tr={objectStore(){return {
          get(k){const q={};queueMicrotask(()=>{q.result=mem.get(k);q.onsuccess?.();});return q;},
          put(v,k){mem.set(k,v);queueMicrotask(()=>tr.oncomplete?.());}
        };}};return tr;
      }};request.onsuccess?.();
    });return request;
  }};
  const ctx=vm.createContext({console,crypto:crypto.webcrypto,TextEncoder,
    atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout,clearTimeout,
    queueMicrotask,indexedDB,window:{indexedDB,NativeVector:{status:()=>true}},
    localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))},
    document:{createElement(){return {content:{textContent:''},set innerHTML(s){
      this.content.textContent=String(s).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'');
    }};}},
    fetch:async f=>({ok:Object.hasOwn(shared,f),json:async()=>shared[f]})
  });
  for(const file of scripts.flatMap(name=>name==='story-engine.js'?
    ['story-engine.js',...(fs.existsSync(path.join(directory,'event-frame-engine.js'))?
      ['event-frame-engine.js']:[])]:[name]))
    vm.runInContext(fs.readFileSync(path.join(directory,file),'utf8'),ctx,{filename:file});
  return vm.runInContext('OfflineAPI',ctx);
}
const normalizeNumber=x=>String(x??'').padStart(3,'0');
const locate=(list,tar)=>{
  const idx=list.findIndex(x=>x.collection_ids?.includes(tar.collection) &&
    normalizeNumber(x.number)===normalizeNumber(tar.number) &&
    (!tar.title||norm(x.title)===norm(tar.title)));
  return idx<0?null:idx+1;
};
const measure=(rows)=>{
  const ranks=rows.flatMap(x=>x.positives.map(y=>y.rank));
  const recall=k=>ranks.filter(x=>x!==null&&x<=k).length/(ranks.length||1);
  const ndcg=k=>ranks.reduce((a,r)=>a+(r&&r<=k?1/Math.log2(r+1):0),0)/(ranks.length||1);
  const mrr20=rows.reduce((a,row)=>{
    const relevant=row.positives.map(x=>x.rank).filter(x=>x&&x<=20);
    return a+(relevant.length?1/Math.min(...relevant):0);
  },0)/(rows.length||1);
  return {queries:rows.length,targets:ranks.length,recall_at_10:recall(10),
    recall_at_20:recall(20),ndcg_at_5:ndcg(5),mrr_at_20:mrr20};
};
async function evaluate(name,directory){
  const api=environment(directory);
  const imported=await api.request('/api/import',{data:catalog});
  const status=await api.request('/api/status');
  assert.ok(imported.count>=1500&&status.vector_count>=1450,'Base ou E5 não inicializou: '+name);
  const output=[];
  for(const c of cases){
    const t0=performance.now();
    const opts={query:c.query,_forRecommendations:true,
      settings:{bibleGraph:true,scripture:true,narratives:true,eventEvidence:true,
        mode:'balanced',strength:75,vectorMode:c.vector?'balanced':'off',
        fusionMode:'rrf',pageSize:10},
      ...(c.vector?{vector_query:c.vector}:{})};
    const result=await api.request('/api/search',opts);
    assert.ok(Array.isArray(result._fullRanked),'Ranking ausente: '+name+'/'+c.query);
    output.push({query:c.query,category:c.category,e5_used:Boolean(c.vector),relation_id:c.relation_id,
      provenance:c.provenance,
      positives:c.positives.map(p=>({...p,rank:locate(result._fullRanked,p)})),
      negatives:(c.negatives||[]).map(p=>({...p,rank:locate(result._fullRanked,p)})),
      elapsed_ms:Math.round(performance.now()-t0)});
  }
  return {name,catalog_count:imported.count,rows:output,metrics:measure(output),
    categories:Object.fromEntries([...new Set(output.map(x=>x.category))].map(category=>
      [category,measure(output.filter(x=>x.category===category))]))};
}
(async()=>{
  const baseline=await evaluate('rrf_2_6_3',rrfDir);
  const current=await evaluate('event_frames_2_6_6',currentDir);
  const worsening=[];
  for(let i=0;i<cases.length;i++){
    for(let j=0;j<cases[i].positives.length;j++){
      const before=baseline.rows[i].positives[j].rank;
      const after=current.rows[i].positives[j].rank;
      if(before!==null&&(after===null||after>before))
        worsening.push({query:cases[i].query,category:cases[i].category,
          target:cases[i].positives[j],before,after});
    }
  }
  const report={schema_version:2,e5_coverage:{
    semantic_paraphrase_queries:12,semantic_paraphrase_vectors:paraphrases.filter(p=>p.vector).length,
    semantic_legacy_vectors:curated.filter(p=>p.vector).length,
    source_kind:generated.source_kind,model_sha256:generated.model_sha256,
    tokenizer_revision:generated.tokenizer_revision
  },catalog_sha256:crypto.createHash('sha256')
    .update(fs.readFileSync(catalogPath)).digest('hex'),catalog_count:current.catalog_count,
    case_count:cases.length,category_counts:Object.fromEntries(
      [...new Set(cases.map(x=>x.category))].map(x=>[x,cases.filter(c=>c.category===x).length])),
    caveats:['Rótulos semânticos de paráfrases aguardam revisão humana independente',
      'Títulos e números são testes de contrato, não provas de entendimento semântico',
      'Paráfrases da mesma passagem são correlacionadas; não interpretar como 50 intenções independentes',
      'Os 12 vetores E5 das paráfrases são de inferência ONNX real, mesma consulta nas duas versões',
      'Resultados representam apenas alvos conhecidos, não recall completo da biblioteca',
      'Nenhuma letra é redistribuída nos relatórios'],
    human_review_status:'pending',baseline,current,worsened_cases:worsening};
  const out=path.resolve(__dirname,'../qa-report/relevance-50.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  assert.equal(current.metrics.queries,50);
  assert.equal(current.categories.semantic_legacy.queries,14);
  assert.equal(current.categories.semantic_paraphrase.queries,12);
  assert.equal(current.categories.exact_title.queries,16);
  assert.equal(current.categories.exact_number.queries,8);
  console.log('QA 50 — '+JSON.stringify({
    baseline:baseline.metrics,current:current.metrics,categories:current.categories,
    worsened:worsening.length,human_review_status:report.human_review_status
  }));
  // O conjunto legado ainda é testado no gate da matriz A/B (14/19).
  // A amostra ampliada é exploratória; não criar limite de relevância
  // derivado da própria execução. Falhas de integridade continuam bloqueantes.
  console.log('QA 50 — relatório íntegro; revisão humana das paráfrases continua pendente.');
})().catch(err=>{console.error(err);process.exitCode=1;});
