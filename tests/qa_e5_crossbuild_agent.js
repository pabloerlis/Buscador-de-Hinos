'use strict';
/* Agent 9 independently checks packaged E5 index and semantic query fingerprints. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const evidence=json('qa-report/e5-stability.json'),reference=json('qa/e5-stability-reference.json');
const vectors=json('qa-report/e5-paraphrase-vectors.json'),index=json('app/src/main/assets/e5-index.json');
assert.equal(evidence.schema_version,1);
assert.equal(evidence.status,'approved');
assert.equal(evidence.configuration,'cpu_single_thread_uint8_deterministic_x64quantprecision_onnxruntime_1.20.1');
assert.equal(evidence.same_session_equal,true);
assert.equal(evidence.fresh_session_equal,true);
assert.ok(evidence.recomputed_index_passages_equal>=64);
assert.equal(reference.status,'locked');
assert.equal(evidence.baseline_matched,true);
assert.equal(vectors.queries.length,12);
assert.equal(vectors.vector_serialization,'onnx_float32_to_float16_to_float32_canonical');
assert.equal(index.count,1557);
assert.equal(index.passages,10496);
const computed={
 model_sha256:sha('app/src/main/assets/e5-model.onnx'),
 tokenizer_sha256:vectors.tokenizer_sha256,
 catalog_sha256:index.source_sha256,
 index_sha256:sha('app/src/main/assets/e5-index.json'),
 queries_sha256:sha('qa-report/e5-paraphrase-vectors.json')
};
assert.deepEqual(evidence.fingerprint,computed);
assert.deepEqual(reference.fingerprint,computed);
console.log('AGENT 9: cross-build E5 index and query fingerprints match locked baseline');
