'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const ctx={crypto:webcrypto,TextEncoder,atob,console};
const reader=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/harrier-index.js'),'utf8')+'\nHarrierIndex',ctx);
const revision='dbaf6767003608562dd5b744bc443656a29c45bd',repo='onnx-community/harrier-oss-v1-0.6b-ONNX',catalog='da8e75932982123301affce688e45b4152c9e06e';
const schema='harrier-hymn-index-v1',catalogSha='a'.repeat(64);
const vector=(axis,value=127)=>{const b=Buffer.alloc(1024);b.writeInt8(value,axis);return b.toString('base64');};
const hash=s=>createHash('sha256').update(s).digest('hex');
function pack(records){
  const source={schema,model:repo,revision,variant:'q4f16',dimension:1024,quantization:'symmetric-int8-l2-renormalize',
    catalog_revision:catalog,catalog_sha256:catalogSha,count:records.length,records};
  const text=JSON.stringify(source);
  const manifest={schema,model:{repo,revision,variant:'q4f16',dimension:1024,runtime:'1.31.1',pooling:'sentence_embedding',normalization:'L2'},
    catalog:{revision:catalog,sha256:catalogSha},index:{sha256:hash(text),bytes:Buffer.byteLength(text),count:records.length,
    segments:records.reduce((s,r)=>s+r.v.length,0)}};
  return {manifest,text};
}
(async()=>{
  const h1={id:1,title:'Paz',lyrics:'A paz de Cristo'};
  const h2={id:2,title:'Vitória',lyrics:'O Senhor venceu'};
  const h3={id:3,title:'Esperança',lyrics:'Espero em Deus'};
  const f1=await reader.fingerprint(h1),f2=await reader.fingerprint(h2),f3=await reader.fingerprint(h3);
  assert.equal(f1,await reader.fingerprint({title:'PÁZ',lyrics:'A paz\n de Cristo'}));
  const records=[{f:f1,v:[vector(0)]},{f:f2,v:[vector(1),vector(0,64)]},{f:f3,v:[vector(0,-127)]}];
  const {manifest,text}=pack(records),db=await reader.open(manifest,text);
  assert.equal(db.status().ready,false);
  assert.equal((await db.attach([h1,h2,h3,{id:4,title:'Paz',lyrics:'letra diferente'}])).count,3);
  const q=Array(1024).fill(0);q[0]=1;
  assert.equal(db.checkQuery(q),true);assert.equal(db.checkQuery(Array(384).fill(1)),false);
  assert.equal(db.checkQuery(Array(1024).fill(0)),false);
  assert.equal(JSON.stringify(db.topForQuery(q).map(x=>x.id)),'[1,2,3]');
  assert.equal(db.topForQuery(q)[2].similarity,-1);
  assert.equal(JSON.stringify(db.topForHymn(1).map(x=>x.id)),'[2,3]');
  assert.equal(db.topForQuery(q,0).length,0);
  assert.equal(db.topForQuery(q,-1).length,0);
  await assert.rejects(reader.open({...manifest,model:{...manifest.model,dimension:384}},text),/Manifesto/);
  await assert.rejects(reader.open(manifest,text+' '),/Integridade/);
  for(const bad of [[records[0],records[0]],[{f:f1,v:[Buffer.alloc(1024).toString('base64')]}],[{f:f1,v:[vector(0,-128)]}],[{f:f1,v:['AA==']}]]) {
    const p=pack(bad);await assert.rejects(reader.open(p.manifest,p.text));
  }
  await db.attach([]);assert.equal(db.status().count,0);
  console.log('Harrier index: integridade, revisão, 1024D, fingerprints, quantização, ranking e casos negativos aprovados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
