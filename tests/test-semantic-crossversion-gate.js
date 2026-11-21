'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {inspect,calculate}=require('./qa_semantic_crossversion_agent.js');
const base=JSON.parse(fs.readFileSync(path.join(root,'qa/semantic-crossversion-baseline.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'qa/semantic-paraphrase-queries.json')));
function fixture(){
 const rows=base.rows.map((r,i)=>({query:manifest.queries[i],collection:r.collection,number:r.number,rank_without_e5:r.rank_without_e5,rank_with_e5:r.rank_with_e5}));
 return {schema_version:1,agent:'9-independent-semantic-search',status:'approved',review_status:'pending',cases:12,
 catalog_sha256:base.catalog_sha256,model_sha256:base.model_sha256,rows,
 without_e5:calculate(rows,'rank_without_e5'),with_e5:calculate(rows,'rank_with_e5'),negative_control_rank:24,number_exact_rank:1};
}
assert.equal(inspect(fixture(),base).decision,'approved');
const ranked=fixture();ranked.rows[0].rank_with_e5=71;
assert.equal(inspect(ranked,base).decision,'rejected','top10 loss must fail');
const query=fixture();query.rows[0].query='modified';
assert.equal(inspect(query,base).decision,'rejected','modified query must fail');
const missing=fixture();missing.rows.pop();
assert.equal(inspect(missing,base).decision,'rejected','missing test must fail');
const fabricated=fixture();fabricated.with_e5.recall_at_20=1;
assert.equal(inspect(fabricated,base).decision,'rejected','fake metrics must fail');
const unapproved=fixture();unapproved.status='pending';
assert.equal(inspect(unapproved,base).decision,'rejected','unapproved producer must fail');
const exact=fixture();exact.number_exact_rank=2;
assert.equal(inspect(exact,base).decision,'rejected','exact-number regression must fail');
console.log('Agent 10: 1 positive + 6 negative self-tests PASSED');