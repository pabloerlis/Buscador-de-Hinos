'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const W=require('../scripts/contextual_review_workbench');
const S=require('../scripts/contextual_review_sampler');
const h={id:23,number:'023',title:'Documento sintético',
  collectionRefs:[{id:'principal'}],
  lyrics:'A equipe organizou o trabalho no início do dia.\nO prazo mudou.\n\n'+
    'A reunião final trouxe decisões para o próximo ciclo.\nA equipe concluiu a tarefa.'};
const h2={id:24,number:'024',title:'Outro documento',
  collectionRefs:[{id:'principal'}],lyrics:'O grupo revisou planos.\n\nA decisão foi registrada.'};
const sha=S.fingerprint('corpus inventado de QA');
const audits=[{query:'planejamento',top10:[
  {id:23,pos:1,lexicalStatus:'revisão semântica necessária'},
  {id:24,pos:2,lexicalStatus:'apoio lexical em letra integral'}
],strongNotTop10:[]}];
const queue=S.buildReviewManifest({catalogSha256:sha,hymns:[h,h2],audits});
const index=new Map([[23,h],[24,h2]]);
assert.equal(W.verifyQueue(queue,sha,index).tasks.size,2);
assert.throws(()=>W.verifyQueue(queue,S.fingerprint('diferente'),index),/incompatível/);
const alteredIndex=new Map([[23,{...h,lyrics:'Letra diferente'}],[24,h2]]);
assert.throws(()=>W.verifyQueue(queue,sha,alteredIndex),/alterada/);
assert.equal(W.sourceHymn(h).collection,'principal');
const task=queue.relevance_tasks.find(x=>x.hymn_id===23);
const label={
  schema_version:1,task_id:task.task_id,hymn_id:task.hymn_id,
  lyrics_sha256:task.lyrics_sha256,query:task.query,grade:2,
  evidence_line_ids:['s0:l0','s1:l1'],
  reason:'O documento mostra mudanças e conclusão de uma tarefa',
  reviewer_alias:'revisor_teste',attested_read_full_lyrics:true,
  review_status:'human_recorded'
};
assert.equal(W.validateLabel(label,task,h),true);
for(const invalid of [
  {...label,grade:4},{...label,attested_read_full_lyrics:false},
  {...label,reviewer_alias:'ab'},{...label,lyrics_sha256:'0'.repeat(64)},
  {...label,evidence_line_ids:['s8:l9']},{...label,evidence_line_ids:[]},
  {...label,reason:h.lyrics.split('\n')[0]}
])assert.throws(()=>W.validateLabel(invalid,task,h));
const sample=queue.profile_candidates.find(x=>x.hymn_id===23);
assert.ok(sample,'Amostra de perfil não encontrada');
const draft=W.templateProfile(h,sample);
assert.equal(draft.annotation.stanzas.length,2);
assert.throws(()=>W.validateProfileDraft(draft,sample,h),/Declaração/);
draft.reviewer_alias='revisor_teste';
draft.attested_read_full_lyrics=true;
const g=draft.annotation.global;
Object.assign(g,{
  central_message:'Uma equipe conclui um projeto após reorganizar os prazos',
  narrator_perspective:'Observador externo',
  opening_situation:'A equipe iniciou a organização',
  conflict:'Houve mudança no prazo previsto',
  transformation:'A reunião encaminhou decisões',
  resolution:'Uma tarefa foi concluída',
  primary_themes:['Organização'],secondary_themes:['Mudança de prazo']
});
for(const key of ['central_message','narrator_perspective','opening_situation','conflict',
  'transformation','resolution','primary_themes','secondary_themes'])
  g.claim_evidence[key]=['s0:l0','s1:l1'];
for(let i=0;i<draft.annotation.stanzas.length;i++){
  const stanza=draft.annotation.stanzas[i];
  stanza.semantic_role=i?'Desfecho':'Início';
  stanza.summary=i?'O trabalho foi finalizado':'O cronograma inicial foi alterado';
  stanza.evidence_line_ids=['s'+i+':l0'];
}
const result=W.validateProfileDraft(draft,sample,h);
assert.equal(result.review_status,'human_recorded_not_independently_adjudicated');
assert.equal(result.profile.validation.status,'pending');
const invalid=JSON.parse(JSON.stringify(draft));
invalid.annotation.stanzas[0].evidence_line_ids=['s1:l0'];
assert.throws(()=>W.validateProfileDraft(invalid,sample,h),/Perfil inválido/);
assert.throws(()=>W.validateProfileDraft(draft,sample,{
  ...h,lyrics:h.lyrics.replace('concluiu','cancelou')
}),/edição/i);
const stats=W.counts(queue,{labels:[label],profiles:[result]});
assert.equal(stats.labels_done,1);
assert.equal(stats.profiles_done,1);
assert.equal(stats.independently_certified,false);
assert.throws(()=>W.reviewPath(path.join(__dirname,'..','app/src/main/assets/unsafe.json')),/Git\/APK/);
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'contextual-review-'));
try{
  const dest=path.join(folder,'records.json');
  const data={schema_version:1,labels:[label],profiles:[result]};
  W.writeLocal(dest,data);
  assert.deepEqual(W.readLocal(dest),data);
}finally{fs.rmSync(folder,{recursive:true,force:true});}
console.log('P1 WORKBENCH PASS: revisão local, evidência, hash, edição e limites.');
