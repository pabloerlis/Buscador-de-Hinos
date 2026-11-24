'use strict';
/* Agente de relevância: métricas reprodutíveis, sem treinar nem codificar
   soluções particulares. Letras baixadas apenas durante o CI, nunca no APK. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const catalogPath=process.argv[2];
if(!catalogPath || !fs.existsSync(catalogPath)){
  console.error('Uso: node tests/qa-metrics.js /tmp/catalogo-2018.json');
  process.exit(2);
}
const root=path.join(__dirname,'..');
const limits=JSON.parse(fs.readFileSync(path.join(root,'qa/metrics-baseline.json'),'utf8'));
assert.equal(limits.schema_version,1);

function runScript(name){
  try{
    return execFileSync(process.execPath,[path.join(__dirname,name),catalogPath],{
      encoding:'utf8',cwd:root,timeout:120000,maxBuffer:10*1024*1024
    });
  }catch(e){
    console.error('Benchmark '+name+' reprovado:\n'+String(e.stdout||'')+'\n'+String(e.stderr||e.message));
    process.exit(1);
  }
}
const narrativeLog=runScript('benchmark-narratives.js');
const start=narrativeLog.indexOf('Catálogo completo (');
assert.ok(start>=0,'Relatório narrativo ausente');
const open=narrativeLog.indexOf('\n[',start);
assert.ok(open>=0,'Dados do relatório narrativo ausentes');
const narrative=JSON.parse(narrativeLog.slice(open+1).trim());
const bibleLog=runScript('benchmark-biblical-passages.js');
const line=bibleLog.split(/\r?\n/).find(x=>x.startsWith('BENCHMARK_BIBLICO '));
assert.ok(line,'Relatório bíblico ausente');
const bible=JSON.parse(line.slice('BENCHMARK_BIBLICO '.length));
assert.ok(bible.count>=1400,'Catálogo bíblico incompleto');
assert.ok(Array.isArray(narrative)&&narrative.length>=5,'Poucas consultas narrativas no benchmark');
assert.ok(Array.isArray(bible.outcome)&&bible.outcome.length>=5,'Poucas consultas bíblicas no benchmark');

function metricRows(rows,selector){
  return rows.map(row=>{
    const all=selector(row);
    assert.ok(all.length>0,'Consulta sem rótulos: '+row.query);
    const ranks=all.map(x=>x==null?null:Number(x));
    function recall(k){
      return ranks.filter(r=>Number.isInteger(r)&&r>0&&r<=k).length/ranks.length;
    }
    function gain(k){
      const dcg=ranks.reduce((sum,r)=>sum+(r!==null&&r>0&&r<=k?1/Math.log2(r+1):0),0);
      const ideal=Array.from({length:Math.min(k,ranks.length)},(_,i)=>1/Math.log2(i+2))
        .reduce((sum,x)=>sum+x,0);
      return ideal>0?dcg/ideal:0;
    }
    return {query:row.query,positives:ranks.length,positions:ranks,
      recall_at_10:recall(10),recall_at_20:recall(20),ndcg_at_5:gain(5)};
  });
}
const suites={
  narrative:metricRows(narrative,row=>row.expected.map(x=>x.rank)),
  biblical:metricRows(bible.outcome,row=>row.expected.map(x=>x.position))
};
const report={schema_version:1,source:'catálogo público 2018',catalog_size:bible.count,suites:{}};
let failed=false;
for(const [name,rows] of Object.entries(suites)){
  const avg=key=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
  const metrics={
    macro_recall_at_10:avg('recall_at_10'),
    macro_recall_at_20:avg('recall_at_20'),
    macro_ndcg_at_5:avg('ndcg_at_5')
  };
  const rules=limits[name];
  const checks=[
    ['macro_recall_at_10',rules.min_macro_recall_at_10],
    ['macro_recall_at_20',rules.min_macro_recall_at_20],
    ['macro_ndcg_at_5',rules.min_macro_ndcg_at_5]
  ];
  for(const [key,min] of checks){
    if(metrics[key]+1e-9<min){
      console.error('REGRESSÃO '+name+' '+key+': '+metrics[key].toFixed(3)+' < '+min);
      failed=true;
    }
  }
  report.suites[name]={count:rows.length,metrics,thresholds:rules,cases:rows};
  console.log('AGENTE DE RELEVÂNCIA — '+name+': '+JSON.stringify(metrics));
}
const experimental = metricRows(bible.experimental, row=>row.expected.map(x=>x.position));
const summarize = rows => Object.fromEntries(['recall_at_10','recall_at_20','ndcg_at_5'].map(key=>
  ['macro_'+key, rows.reduce((total,row)=>total+row[key],0)/rows.length]));
report.experimental_context_rerank = {
  count:experimental.length,
  metrics:summarize(experimental),
  cases:experimental,
  false_positives:bible.outcome.map((row,index)=>({
    query:row.query, baseline:row.falsePositive, experimental:bible.experimental[index].falsePositive
  }))
};
console.log('ORDEM CONTEXTUAL EXPERIMENTAL — '+JSON.stringify(report.experimental_context_rerank.metrics));
const file=path.join(root,'qa-report','metrics.json');
fs.mkdirSync(path.dirname(file),{recursive:true});
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
console.log('Relatório sem letras: '+file);
if(failed)process.exit(1);
console.log('AGENTE DE RELEVÂNCIA — APROVADO. Casos rotulados não são uma avaliação exaustiva.');
