'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
const dir=path.join(__dirname,'../app/src/main/assets');
const normalize=x=>String(x).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const hash=h=>crypto.createHash('sha256').update(normalize(h.title+'|'+h.lyrics)).digest('hex').slice(0,24);
const song=[
  {id:1,title:'Um exemplo de cura',lyrics:'A primeira estrofe fala de esperança\nnoite escura no coração\n\nSegunda estrofe do encontro\nalguém tocou nas vestes\nfoi curado pela fé\n\nNo fim há gratidão'},
  {id:2,title:'Um exemplo de batalha',lyrics:'Eu sigo a marcha\nmeu escudo forte\n\nDia de tribulação\nesperando a salvação'},
  {id:3,title:'Outra passagem',lyrics:'Manto branco\n\nGrande multidão e oração'}
];
function encode(index,value){
  const buffer=Buffer.alloc(384);buffer[index]=value;
  return buffer.toString('base64');
}
const vec0=encode(0,127),vec1=encode(1,127),vec2=encode(2,127);
const records=[
  {f:hash(song[0]),t:normalize(song[0].title),v:[vec0,vec1,vec2],s:[[0,2],[2,5],[5,6]]},
  {f:hash(song[1]),t:normalize(song[1].title),v:[vec0],s:[[0,2]]},
  {f:hash(song[2]),t:normalize(song[2].title),v:[vec2],s:[[0,1]]}
];
const fakeFetch=async()=>({ok:true,json:async()=>({version:3,dimension:384,count:3,passages:5,records})});
const ctx={crypto:crypto.webcrypto,TextEncoder,atob:s=>Buffer.from(s,'base64').toString('binary'),fetch:fakeFetch,setTimeout};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(dir,'vector-index.js'),'utf8'),ctx);
const vi=vm.runInContext('VectorIndex',ctx);
(async()=>{
  const state=await vi.configure(song);
  assert.equal(state.count,3);
  assert.equal(state.passages,5);
  assert.equal(state.mode,'trechos distribuídos');
  const query=[0,1,...Array(382).fill(0)];
  const hit=vi.topForQuery(query,3);
  assert.equal(hit[0].id,1,'trecho intermediário deve vencer');
  assert.equal(JSON.stringify(hit[0].range),JSON.stringify([2,5]));
  assert.match(vi.passageForSong(song[0],hit[0].range),/alguém tocou nas vestes/);
  assert.ok(!vi.passageForSong(song[0],[999,1000]));
  assert.ok(!vi.checkQuery(Array(384).fill(NaN)));
  const related=vi.topForHymn(1);
  assert.equal(related.length,2);
  const mismatched=song.map(h=>({...h,lyrics:h.lyrics+' texto alterado'}));
  const disabled=await vi.configure(mismatched);
  assert.equal(disabled.count,0,'não usar embedding se a letra importada for diferente');
  console.log('AGENTE E5 JS — APROVADO: estrofe intermediária, segurança por fingerprint, vetor 384D, ausência de textos inventados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
