'use strict';
/* Propriedades de RRF independentes de qualquer história ou hino específico. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/rrf-fusion.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source,context);
const rrf=vm.runInContext('FusionRRF',context);
assert.equal(rrf.K,60,'RRF deve usar k=60 documentado');
assert.equal(rrf.positions([{id:1},{id:1},{id:2}]).size,2,'Documento repetido não duplica contribuição');
assert.ok(Math.abs(rrf.positions([{id:7}]).get(7)-1/61)<1e-12);
const hymn=(id,rank,values={},other={})=>({
  id,title:'Hino '+id,match_type:'contexto',relevance_score:100-rank,
  _fusionSignals:{lexical:0,semantic:0,biblical:0,narrative:0,vector:0,...values},
  _fusionPenalty:1,...other});
const candidates=[
  hymn(1,1,{lexical:10,semantic:2,biblical:2,vector:.74}),
  hymn(2,2,{lexical:2,semantic:5,biblical:10,vector:.88}),
  hymn(3,3,{lexical:0,semantic:1,biblical:0,vector:.92}),
  hymn(4,4,{lexical:1,semantic:0,biblical:0,vector:0})
];
assert.strictEqual(rrf.rank(candidates.map(x=>({...x,_fusionSignals:{...x._fusionSignals,vector:0}})),candidates[0])?.id,undefined);
// Sem vetores: preserva a lista original, sem alterar referências/ordem.
const noVector=candidates.map(x=>({...x,_fusionSignals:{...x._fusionSignals,vector:0}}));
assert.strictEqual(rrf.rank(noVector),noVector);
assert.deepEqual(rrf.rank(noVector).map(x=>x.id),[1,2,3,4]);
const ranked=rrf.rank(candidates);
assert.equal(ranked.length,4);
assert.deepEqual([...ranked].map(x=>x.id).sort(),[1,2,3,4],'Sem perda ou repetição de candidatos');
assert.equal(ranked[0].id,2,'Consenso: evidência bíblica, temática e E5 complementam posição inicial');
assert.deepEqual(candidates.map(x=>x.id),[1,2,3,4],'RRF não modifica a lista original');
const exact=candidates.map(x=>({...x,match_type:x.id===4?'titulo_exato':x.match_type}));
assert.equal(rrf.rank(exact)[0].id,4,'Título exato nunca perde para vetor');
const narrative=candidates.map(x=>({...x,_narrativeTier:x.id===1?4:0}));
assert.equal(rrf.rank(narrative,{narrativePrimary:true})[0].id,1,'Tier narrativo de evidência direta preservado');
const denied=candidates.map(x=>({...x,_fusionPenalty:x.id===2?.55:1}));
assert.notEqual(rrf.rank(denied)[0].id,2,'Pedido explícito de menor prioridade é respeitado');
const strong=rrf.rank(candidates,{vectorMode:'strong'});
assert.equal(strong.length,4,'Modo forte não deve eliminar resultados');
const single=[hymn(1,1,{vector:.9})];
assert.strictEqual(rrf.rank(single),single,'Consulta com um único hino é estável');
// Resistência a valores incorretos/sem evidência: não gerar valores NaN no ranking.
const odd=[hymn(9,1,{vector:.7,lexical:NaN}),hymn(8,2,{vector:0,semantic:Infinity})];
assert.equal(rrf.rank(odd).length,2);
const large=Array.from({length:1557},(_,i)=>hymn(i+1,i+1,{
  lexical:i%4===0?100-i/50:0,semantic:i%7===0?1:0,biblical:i%17===0?i/4:0,
  narrative:i%23===0?i/3:0,vector:i<100?.74+i/2000:0
}));
const start=performance.now();
const output=rrf.rank(large);
assert.equal(output.length,1557);
assert.equal(new Set(output.map(x=>x.id)).size,1557);
assert.ok(performance.now()-start<1800,'RRF muito lento para a coletânea real');
console.log('RRF: fórmulas, consenso, fallback, título/narrativa, despriorização e 1557 candidatos aprovados.');
