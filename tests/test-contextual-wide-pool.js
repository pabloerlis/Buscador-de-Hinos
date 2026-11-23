'use strict';
const assert=require('node:assert/strict');
const {buildPool,MODES}=require('../scripts/contextual_wide_pool');
const ids=a=>a.map(id=>({id}));
const baseline=ids(Array.from({length:42},(_,i)=>i+1));
const source={
  baseline,
  context:ids([101,102,103,104,105,...Array.from({length:30},(_,i)=>i+1)]),
  literal:ids([201,202,203,204,205]),
  legacy:ids([301,302,303,304,305])
};
assert.deepEqual(MODES,['baseline','context','literal','legacy']);
const pool=buildPool(source,{limit:60,pageSize:5,excludedIds:[102,202]});
assert.equal(pool.comparison_mode,'shadow_only_no_production_change');
assert.equal(pool.not_a_relevance_metric,true);
assert.equal(pool.returned_count,55);
assert.deepEqual(pool.candidates.slice(0,10).map(x=>x.hymn_id),
  Array.from({length:10},(_,i)=>i+1));
assert.equal(pool.protected_top10,10);
assert.equal(pool.candidates.find(x=>x.hymn_id===1).outside_visible_page,false);
assert.equal(pool.candidates.find(x=>x.hymn_id===6).outside_visible_page,true);
assert.ok(pool.candidates.some(x=>x.hymn_id===101&&x.novel_vs_baseline_full));
assert.ok(pool.candidates.some(x=>x.hymn_id===201&&x.novel_vs_baseline_full));
assert.ok(pool.candidates.some(x=>x.hymn_id===301&&x.novel_vs_baseline_full));
assert.ok(!pool.candidates.some(x=>[102,202].includes(x.hymn_id)));
assert.ok(pool.candidates.every(x=>x.review_status==='unjudged_candidate'));
assert.equal(pool.candidates.find(x=>x.hymn_id===101).source_positions.context,1);
assert.equal(pool.candidates.find(x=>x.hymn_id===101).baseline_position,null);
assert.ok(pool.beyond_visible_page>0&&pool.beyond_baseline_top10>0);
assert.ok(pool.novel_vs_baseline_full>=3);
const again=buildPool(source,{limit:60,pageSize:5,excludedIds:[102,202]});
assert.deepEqual(pool,again,'Seleção deve ser determinística');
const capped=buildPool({baseline:ids(Array.from({length:80},(_,i)=>i+1)),
  context:ids(Array.from({length:80},(_,i)=>i+101))},{limit:60});
assert.equal(capped.returned_count,60);
assert.equal(capped.protected_top10,10);
const tiny=buildPool({baseline:ids([10,12]),context:ids([20,21])});
assert.deepEqual(tiny.candidates.map(x=>x.hymn_id),[10,12,20,21]);
assert.equal(tiny.protected_top10,2);
const numberOnly=buildPool({baseline:ids([47])});
assert.equal(numberOnly.returned_count,1);
assert.deepEqual(numberOnly.candidates.map(x=>x.hymn_id),[47]);
const duplicates=[{id:1},{id:1}];
assert.throws(()=>buildPool({baseline:duplicates}),/duplicado/);
assert.throws(()=>buildPool({baseline:ids([1]),context:ids([{bad:true}])}),/ID de candidato/);
assert.throws(()=>buildPool({baseline:ids([1])},{limit:5}),/limites/);
assert.throws(()=>buildPool({baseline:ids([1])},{excludedIds:[0]}),/Exclusão/);
assert.throws(()=>buildPool({baseline:ids([1]),context:'falso'}),/Fonte inválida/);
console.log('P2 SHADOW POOL PASS: paginação, baseline, fontes adicionais, exclusões e fallback.');
