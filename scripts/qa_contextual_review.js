'use strict';
// Runs only in GitHub's temporary QA workspace against pinned licensed catalog.
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const {makeRuntime}=require('../tests/agents/runtime');
const Sampler=require('./contextual_review_sampler');
const [catalogPath,agentPath,outputPath]=process.argv.slice(2);
if(!catalogPath||!agentPath||!outputPath)
  throw Error('Uso: node scripts/qa_contextual_review.js catalog.json resultado-agentes.json output.json');
(async()=>{
  const catalogBytes=fs.readFileSync(catalogPath);
  const sourceHash=crypto.createHash('sha256').update(catalogBytes).digest('hex');
  const catalog=JSON.parse(catalogBytes.toString('utf8'));
  const agent=JSON.parse(fs.readFileSync(agentPath,'utf8'));
  if(agent.status!=='PASS'||agent.catalog?.catalogSha256!==sourceHash||
    agent.catalog?.checkedEntireLyrics<1500||agent.catalog?.audits?.length<22)
    throw Error('Relatório de agentes de letras completas incompleto ou pertence a outra fonte');
  const api=makeRuntime();
  const imported=await api.request('/api/import',{data:catalog});
  if(imported.count!==agent.catalog.importedCount)throw Error('Importação diverge da auditoria');
  const hymns=[];
  for(let id=1;id<=imported.count;id++){
    const h=await api.request('/api/hymns/'+id);
    hymns.push({id:h.id,number:h.number,title:h.title,lyrics:h.lyrics});
  }
  const manifest=Sampler.buildReviewManifest({
    catalogSha256:sourceHash,hymns,audits:agent.catalog.audits
  });
  if(manifest.counts.relevance_tasks<40||manifest.counts.profile_candidates<24||
    manifest.counts.reserved_review_tasks<3)
    throw Error('Amostra insuficiente: '+JSON.stringify(manifest.counts));
  // The output contains neither original lyrics nor any snippet, including in nested fields.
  const contents=JSON.stringify(manifest,null,2)+'\n';
  for(const h of hymns){
    const normalized=h.lyrics.trim();
    if(normalized.length>40&&contents.includes(normalized))
      throw Error('Vazamento de letra integral');
  }
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,contents,'utf8');
  console.log(JSON.stringify({status:manifest.status,source_catalog_sha256:sourceHash,
    ...manifest.counts},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
