'use strict';
const fs=require('node:fs'),path=require('node:path');
const fixture=require('./fixture-agent'),catalog=require('./catalog-agent');
const out=process.env.REPORT_DIR||'reports/validation';
fs.mkdirSync(out,{recursive:true});
const line=(value)=>String(value??'').replace(/\|/g,'/').replace(/[\r\n]+/g,' ');
function renderChecks(name,r){
  if(!r)return '## '+name+'\n\nNão executado (falha de infraestrutura).\n';
  let s='## '+name+'\n\n';
  s+='- Verificações: '+r.checks.length+'\n- Aprovadas: '+r.checks.filter(c=>c.pass).length+'\n- Falhas: '+r.checks.filter(c=>!c.pass).length+'\n\n';
  s+='| Resultado | Verificação | Detalhe |\n|---|---|---|\n';
  for(const c of r.checks)s+='| '+(c.pass?'PASS':'FAIL')+' | '+line(c.name)+' | '+line(c.details||'—')+' |\n';
  if(r.warnings?.length){s+='\n### Alertas para revisão humana\n\n';for(const w of r.warnings)s+='- '+line(w)+'\n';}
  return s+'\n';
}
function auditReport(r){
  if(!r)return '';
  let s='## Análise semântica do catálogo real\n\n';
  s+='O avaliador usa **todas as estrofes da letra original**, nunca somente o trecho exibido no cartão. Os grupos de palavras são um **oráculo lexical independente**, não equivalem a compreensão semântica por um especialista. Um resultado sem dois grupos não é automaticamente falso positivo: exige inspeção humana. A ausência no top 10 de um hino com pistas lexicais não prova falso negativo sem anotação humana.\n\n';
  s+='| Consulta | Retorno total | Apoio textual no top 5 (proxy) | Potenciais omissões fortes |\n|---|---:|---:|---:|\n';
  for(const a of r.audits)s+='| '+line(a.query)+' | '+a.total+' | '+a.proxyStrongTop5+'/5 | '+a.strongNotTop10.length+' mostradas |\n';
  for(const a of r.audits){
    s+='\n### '+line(a.query)+'\n\n';
    s+='| Posição | Hino | Afinidade exibida | Evidência na letra inteira |\n|---:|---|---:|---|\n';
    for(const h of a.top10)s+='| '+h.pos+' | '+line(h.number||'—')+' · '+line(h.title)+' | '+h.score+'% | '+line(h.lexicalStatus)+' ('+h.evidenceGroups.map(g=>g.join(', ')).filter(Boolean).join(' / ')+') |\n';
    if(a.strongNotTop10.length){
      s+='\nCandidatos com grupos de indícios fora do top 10 (até 5): '+a.strongNotTop10.map(x=>line(x.number||'—')+' · '+line(x.title)).join('; ')+'. Requerem validação humana.\n';
    }
  }
  s+='\n## Recomendações de hinos semelhantes\n\n';
  for(const x of r.recommendations){
    s+='### '+line(x.anchor.title)+'\n\n';
    if(!x.evaluated.length)s+='Nenhuma sugestão elegível.\n\n';
    for(const v of x.evaluated)s+='- '+line(v.title)+' — afinidade '+v.compatibility+'%; vocabulário compartilhado da letra inteira: '+(v.sharedVocabulary.join(', ')||'não identificado')+'\n';
    s+='\n';
  }
  return s;
}
(async()=>{
  const began=new Date().toISOString();
  let f=null,c=null;const errors=[];
  try{f=await fixture.run();}catch(e){errors.push('Agente de casos integrais: '+e.stack);}
  try{c=await catalog.run(process.argv[2]||'.tmp/catalog-2018.json');}catch(e){errors.push('Agente de catálogo: '+e.stack);}
  const checks=[...(f?.checks||[]),...(c?.checks||[])],passed=Boolean(f?.passed&&c?.passed&&!errors.length);
  const result={status:passed?'PASS':'FAIL',began,finished:new Date().toISOString(),
    commit:process.env.GITHUB_SHA||'execução local',fixture:f,catalog:c,errors};
  fs.writeFileSync(path.join(out,'resultado-agentes.json'),JSON.stringify(result,null,2));
  let full='# Relatório técnico — agentes de teste semântico (letra integral)\n\n';
  full+='**Veredito: '+result.status+'** · commit '+result.commit+' · '+result.finished+'\n\n';
  full+='## Escopo e limites\n\n';
  full+='- Agentes independentes: casos adversariais, auditor do catálogo real, consolidador do relatório.\n';
  full+='- Execução do mesmo OfflineAPI do Android em Node.js, sem aparelho físico ou modelo E5/GGUF.\n';
  full+='- Textos das letras usados apenas durante o teste; relatórios não reproduzem letras completas.\n';
  full+='- A validação quantitativa não substitui interpretação contextual humana; porcentagens do app não são probabilidades.\n';
  if(c)full+='- Fonte real: '+c.rawCount+' registros brutos, '+c.importedCount+' importados únicos, '+c.checkedEntireLyrics+' letras lidas, SHA-256 '+c.catalogSha256+'.\n';
  full+='- Consultas reais: '+(c?.cases||0)+'; cenários sintéticos de múltiplas estrofes: '+(f?.scenarioCount||0)+'.\n';
  full+='- Total de verificações: '+checks.length+', aprovadas: '+checks.filter(x=>x.pass).length+', falhas: '+checks.filter(x=>!x.pass).length+'.\n\n';
  full+=renderChecks('Agente 1 — casos integrais',f);
  full+=renderChecks('Agente 2 — auditor de letras reais',c);
  full+=auditReport(c);
  if(errors.length)full+='\n## Erros de execução\n\n'+errors.map(e=>'- '+line(e)).join('\n')+'\n';
  full+='\n## Próxima etapa\n\nCorrigir primeiro as verificações FAIL (principalmente a regressão do hino nº 286). Para julgar efetivamente falsos positivos e falsos negativos, criar um conjunto de relevância anotado por leitores independentes a partir de **letras completas**, após revisar os casos sinalizados. Reexecutar os agentes e só então liberar a compilação do APK.\n';
  fs.writeFileSync(path.join(out,'relatorio-completo.md'),full);
  let brief='# Relatório simples — busca semântica\n\n';
  brief+='**Resultado: '+result.status+'**\n\n';
  brief+='Agentes: casos com letras inteiras; auditor do catálogo real; gerador de relatórios.\n\n';
  brief+='- '+(f?.scenarioCount||0)+' cenários integrais e '+(c?.cases||0)+' consultas ao catálogo real.\n';
  brief+='- '+(c?.checkedEntireLyrics||0)+' letras completas examinadas.\n';
  brief+='- '+checks.filter(x=>x.pass).length+' verificações aprovadas; '+checks.filter(x=>!x.pass).length+' reprovadas.\n';
  brief+='- '+((c?.warnings||[]).length+(f?.warnings||[]).length)+' alertas semânticos para revisão.\n';
  if(!passed){
    brief+='\n### Bloqueios\n\n';
    for(const x of checks.filter(x=>!x.pass).slice(0,10))brief+='- '+line(x.name)+(x.details?' — '+line(x.details):'')+'\n';
    for(const e of errors)brief+='- '+line(e)+'\n';
  }
  brief+='\nA avaliação automática examina letras inteiras, mas **não certifica compreensão semântica humana**. Veja as evidências e lacunas no relatório completo.\n';
  fs.writeFileSync(path.join(out,'relatorio-simples.md'),brief);
  console.log(brief);
  console.log('Relatórios escritos em '+out);
  if(!passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
