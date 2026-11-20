'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const dir=path.join(__dirname,'../app/src/main/assets');
const read=x=>fs.readFileSync(path.join(dir,x),'utf8');
const normalize=x=>x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const hash=x=>crypto.createHash('sha256').update(normalize(x)).digest('hex').slice(0,24);
const text=[{id:1,number:'001',title:'Voltei ao Pai',lyrics:'De volta a casa, arrependido e perdoado.'},
{id:2,number:'002',title:'Salvação',lyrics:'A graça do Senhor me salvou.'}];
const vector=Buffer.alloc(384);vector[0]=127;
const records=text.map(h=>({id:h.id,n:h.number,t:normalize(h.title),f:hash(h.title+'|'+h.lyrics),v:[vector.toString('base64'),vector.toString('base64')]}));
const ctx={crypto:crypto.webcrypto,TextEncoder,atob:x=>Buffer.from(x,'base64').toString('binary'),
setTimeout,fetch:async()=>({ok:true,json:async()=>({dimension:384,records,count:2})})};vm.createContext(ctx);
vm.runInContext(read('vector-index.js'),ctx);
(async()=>{const vi=vm.runInContext('VectorIndex',ctx);let s=await vi.configure(text);
assert.equal(s.count,2);assert.equal(vi.topForQuery([1,...Array(383).fill(0)]).length,2);
s=await vi.configure(text.map(h=>({...h,lyrics:'texto alterado'})));
assert.equal(s.ready,false);assert.match(read('index.html'),/id="vector-mode"/);
console.log('E5 index and fingerprint tests passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
