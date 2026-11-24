'use strict';
// Migrated v1.8 contract: same fingerprint matching and rejection of changed
// lyrics, now using the selected Harrier model instead of the retired E5 index.
const fs=require('fs'),assert=require('assert'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const dir=path.join(__dirname,'../app/src/main/assets'),read=x=>fs.readFileSync(path.join(dir,x),'utf8');
const normalize=x=>x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const text=[{id:1,number:'001',title:'Voltei ao Pai',lyrics:'De volta a casa, arrependido e perdoado.'},
{id:2,number:'002',title:'Salvação',lyrics:'A graça do Senhor me salvou.'}];
const vector=Buffer.alloc(1024);vector[0]=127;
const records=text.map(h=>({f:hash(normalize(h.title+'|'+h.lyrics)).slice(0,24),v:[vector.toString('base64'),vector.toString('base64')]}));
const schema='harrier-hymn-index-v1',repo='onnx-community/harrier-oss-v1-0.6b-ONNX',revision='dbaf6767003608562dd5b744bc443656a29c45bd',catalog='da8e75932982123301affce688e45b4152c9e06e',sourceSha='a'.repeat(64);
const source=JSON.stringify({schema,model:repo,revision,variant:'q4f16',dimension:1024,quantization:'symmetric-int8-l2-renormalize',catalog_revision:catalog,catalog_sha256:sourceSha,count:2,records});
const manifest={schema,model:{repo,revision,variant:'q4f16',dimension:1024,runtime:'1.31.1',pooling:'sentence_embedding',normalization:'L2'},catalog:{revision:catalog,sha256:sourceSha},index:{sha256:hash(source),bytes:Buffer.byteLength(source),count:2,segments:4}};
let ready=true;
const ctx={window:{NativeHarrierPackage:{status:()=>JSON.stringify({ready})}},crypto:crypto.webcrypto,TextEncoder,atob:x=>Buffer.from(x,'base64').toString('binary'),
setTimeout,fetch:async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>manifest}:{ok:true,text:async()=>source}};
vm.createContext(ctx);vm.runInContext(read('harrier-index.js'),ctx);vm.runInContext(read('vector-index.js'),ctx);
(async()=>{const vi=vm.runInContext('VectorIndex',ctx);let s=await vi.configure(text);
assert.equal(s.count,2);assert.equal(vi.topForQuery([1,...Array(1023).fill(0)]).length,2);
assert.equal(vi.topForQuery([1,...Array(383).fill(0)]).length,0);
s=await vi.configure(text.map(h=>({...h,lyrics:'texto alterado'})));
assert.equal(s.ready,false);assert.match(read('index.html'),/id="vector-mode"/);
s=await vi.configure(text);assert.equal(s.count,2);
ready=false;assert.equal(vi.status().ready,false);assert.equal(vi.topForQuery([1,...Array(1023).fill(0)]).length,0);
console.log('Contrato v1.8 preservado: índice Harrier, fingerprints, dimensão e disponibilidade aprovados.');})().catch(e=>{console.error(e);process.exitCode=1;});
