'use strict';
const assert=require('node:assert/strict');
const S=require('../scripts/contextual_review_sampler');
const h=Array.from({length:72},(_,i)=>({
  id:i+1,number:String(i+1),title:'Documento '+(i+1),
  lyrics:[
    'A equipe trabalhou no primeiro período e organizou o projeto.\nO grupo planejou uma tarefa adicional.',
    'Não abandonamos a decisão da reunião.\nEu acompanhei as mudanças e propus ajustes.',
    'A conclusão descreveu as correções e entregou o produto.\nTodos conferiram os resultados finais.'
  ].join('\n\n')+(i%3===0?'\n\nA equipe fez uma revisão final para a coordenação.':'')
}));
const audits=[
  {query:'contexto A',top10:[
    {id:1,pos:1,lexicalStatus:'revisão semântica necessária'},
    {id:2,pos:2,lexicalStatus:'apoio lexical em letra integral'}],
    strongNotTop10:[{id:11},{id:12}]},
  {query:'contexto B',top10:[
    {id:4,pos:1,lexicalStatus:'revisão semântica necessária'},
    {id:3,pos:2,lexicalStatus:'apoio lexical em letra integral'}],
    strongNotTop10:[{id:13}]}
];
const source=S.fingerprint('fixture invented for QA');
const m=S.buildReviewManifest({catalogSha256:source,hymns:h,audits});
assert.equal(m.status,'awaiting_independent_human_review');
assert.equal(m.counts.queries,2);
assert.equal(m.counts.relevance_tasks,7);
assert.ok(m.profile_candidates.length>=18,'Amostra estratificada insuficiente');
assert.ok(m.profile_candidates.length<=36);
assert.ok(m.relevance_tasks.every(t=>t.relevance_grade===null&&
  t.evidence_line_ids.length===0&&t.review_status==='pending_human'));
assert.ok(m.profile_candidates.every(t=>t.semantic_profile===null));
const twice=S.buildReviewManifest({catalogSha256:source,hymns:h,audits});
assert.deepEqual(m,twice,'Seleção deve ser determinística');
assert.ok(!JSON.stringify(m).includes('A equipe trabalhou no primeiro período'),
  'Amostra pública não pode conter texto original');
assert.ok(m.relevance_tasks.some(t=>t.reason==='outside_top10_lexical_proxy'));
const changed=h.map(x=>({...x}));
changed[0]={...changed[0],lyrics:changed[0].lyrics.replace('primeiro','segundo')};
const revised=S.buildReviewManifest({catalogSha256:source,hymns:changed,audits});
assert.notEqual(revised.relevance_tasks[0].lyrics_sha256,m.relevance_tasks[0].lyrics_sha256);
assert.ok(S.features(h[0].lyrics).negation_proxy);
assert.ok(S.features(h[0].lyrics).first_person_proxy);
assert.throws(()=>S.buildReviewManifest({
  catalogSha256:source,hymns:h,audits:[{query:'erro',top10:[{id:999}],strongNotTop10:[]}]
}),/inexistente/);
console.log('P1 REVIEW PASS: amostra determinística, estratos, integridade e zero rótulos inventados.');
