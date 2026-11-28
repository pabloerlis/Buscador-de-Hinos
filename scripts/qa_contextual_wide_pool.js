'use strict';
/* P2 shadow-only recovery measurement against the same real catalog and queries.
 * IMPORTANT: not a relevance metric; only IDs, ranks and provenance exported.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {makeRuntime}=require('../tests/agents/runtime');
const Pool=require('./contextual_wide_pool');
const [catalogPath,agentPath,outPath]=process.argv.slice(2);
if(!catalogPath||!agentPath||!outPath)
  throw Error('Uso: node scripts/qa_contextual_wide_pool.js catalog.json resultado-agentes.json relatorio.json');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
(async()=>{
  const bytes=fs.readFileSync(catalogPath),sourceHash=hash(bytes);
  const report=JSON.parse(fs.readFileSync(agentPath,'utf8'));
  if(report.status!=='PASS'||report.catalog?.catalogSha256!==sourceHash||
    report.catalog?.checkedEntireLyrics<1500||!Array.isArray(report.catalog.audits))
    throw Error('Auditoria/versão do catálogo incompatível');
  const api=makeRuntime();
  const imported=await api.request('/api/import',{data:JSON.parse(bytes.toString('utf8'))});
  if(imported.count!==report.catalog.importedCount)throw Error('Importação não reproduzível');
  const notLearned=new Set((await api.request('/api/repertoire')).not_learned.map(x=>x.id));
  const rows=[];
  for(const audit of report.catalog.audits){
    if(typeof audit.query!=='string'||audit.query.length>500)throw Error('Consulta inválida');
    const variants={};
    const configs={
      baseline:{mode:'balanced',fusionMode:'rrf'},
      context:{mode:'context',fusionMode:'rrf'},
      literal:{mode:'literal',fusionMode:'rrf'},
      legacy:{mode:'balanced',fusionMode:'legacy'}
    };
    for(const name of Pool.MODES){
      const result=await api.request('/api/search',{
        query:audit.query,parsed_query:true,page:1,_forRecommendations:true,
        settings:{...configs[name],pageSize:5,vectorMode:'off',minAffinity:0}
      });
      if(!Array.isArray(result._fullRanked))throw Error('Ranking completo indisponível');
      variants[name]=result._fullRanked;
    }
    const pool=Pool.buildPool(variants,{limit:60,pageSize:5,excludedIds:[...notLearned]});
    if(pool.protected_top10!==Math.min(10,variants.baseline.filter(r=>!notLearned.has(r.id)).length))
      throw Error('Top10 baseline alterado');
    rows.push({query:audit.query,...pool});
  }
  const result={
    schema_version:1,source_catalog_sha256:sourceHash,
    imported_hymns:imported.count,
    query_count:rows.length,
    available_variants:Pool.MODES,
    vector_mode:'off_in_node_qa_no_onnx_embedding',
    label_status:'NO_HUMAN_RELEVANCE_JUDGMENTS',
    no_default_ranking_changed:true,
    totals:{
      pool_candidates:rows.reduce((n,row)=>n+row.returned_count,0),
      outside_visible_page:rows.reduce((n,row)=>n+row.beyond_visible_page,0),
      outside_baseline_top10:rows.reduce((n,row)=>n+row.beyond_baseline_top10,0),
      novel_vs_baseline_full:rows.reduce((n,row)=>n+row.novel_vs_baseline_full,0)
    },
    queries:rows
  };
  const json=JSON.stringify(result,null,2)+'\n';
  // Never serialize any content of the catalog beyond IDs and ranks.
  if(json.includes('"lyrics"')||json.includes('"snippet"')||
    json.includes('"reason"')||json.includes('"text"'))
    throw Error('Campo de texto proibido no relatório');
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,json);
  console.log(JSON.stringify({
    query_count:result.query_count,source_sha256:sourceHash,...result.totals,
    notice:'Candidate-pool coverage ONLY; no semantic relevance metric'
  },null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
