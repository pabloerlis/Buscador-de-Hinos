'use strict';
// Fabricated non-musical administrative text; no hymn lyrics in tests.
const assert=require('node:assert/strict');
const P=require('../scripts/semantic_profile_poc.js');
const h={id:7042,collection:'principal',title:'Documento inventado',
  lyrics:'A equipe cancelou a saída. Ninguém saiu da unidade.\nO prazo foi alterado.\n\n'+
  'O material chegou após a alteração.\nA reunião terminou com o problema resolvido.'};
const analysis={
  global:{
    central_message:'Uma equipe reorganiza uma tarefa e resolve o problema depois do atraso',
    narrator_perspective:'Relato externo em terceira pessoa',
    opening_situation:'Uma saída prevista não ocorreu',
    conflict:'A previsão inicial foi afetada por mudança de prazo',
    transformation:'O material chegou posteriormente',
    resolution:'O problema foi resolvido ao término da reunião',
    primary_themes:['Reorganização de tarefas'],secondary_themes:['Atrasos'],
    incidental_mentions:['Unidade'],negated_events:['Saída não realizada'],
    biblical_parallels:[],
    claim_evidence:{
      central_message:['s0:l0','s1:l1'],narrator_perspective:['s0:l0'],
      opening_situation:['s0:l0'],conflict:['s0:l1'],
      transformation:['s1:l0'],resolution:['s1:l1'],
      primary_themes:['s0:l1','s1:l1'],secondary_themes:['s0:l1'],
      incidental_mentions:['s0:l0'],negated_events:['s0:l0'],biblical_parallels:[]
    }
  },
  stanzas:[
    {stanza_index:0,semantic_role:'Situação inicial e obstáculo',
      summary:'A tarefa não começou e seu prazo mudou',evidence_line_ids:['s0:l0','s0:l1']},
    {stanza_index:1,semantic_role:'Resolução',
      summary:'A entrega permitiu concluir a pendência',evidence_line_ids:['s1:l0','s1:l1']}
  ]
};
const profile=P.createProfile(h,analysis);
const clone=x=>JSON.parse(JSON.stringify(x));
const reject=(a,b,label)=>assert.equal(P.validateProfile(a,b).ok,false,label);
assert.equal(P.VERSION,1);
assert.equal(profile.validation.status,'pending');
assert.equal(profile.profile_generator.method,'fixture');
assert.deepEqual(P.parseLyrics(h.lyrics).map(s=>s.length),[2,2]);
assert.equal(P.lineRefs(h.lyrics).size,4);
assert.equal(P.validateProfile(h,profile).ok,true);
assert.match(P.embeddingText(profile),/problema depois do atraso/u);
assert.ok(!JSON.stringify(profile).includes(h.lyrics));
reject({...h,lyrics:h.lyrics.replace('resolvido','pendente')},profile,'Desfecho alterado');
reject({...h,lyrics:h.lyrics.replace('cancelou','não cancelou')},profile,'Negação alterada');
reject({...h,title:'Outra edição'},profile,'Título alterado');
let p=clone(profile);
p.stanzas[0].evidence_line_ids=['s1:l0'];
reject(h,p,'Evidência na estrofe errada');
p=clone(profile);p.global.claim_evidence.resolution=['s8:l99'];
reject(h,p,'Linha inexistente');
p=clone(profile);p.stanzas.pop();
reject(h,p,'Falta desfecho');
p=clone(profile);p.global.claim_evidence.central_message=[];
reject(h,p,'Alegação não justificada');
p=clone(profile);p.global.central_message=h.lyrics.split('\n')[0];
reject(h,p,'Texto original longo copiado');
p=clone(profile);p.validation={status:'verified',method:'human'};
reject(h,p,'Revisão humana falsa');
p=clone(profile);p.schema_version=2;
reject(h,p,'Versão incompatível');
assert.equal(P.metrics([1,2,3,4,5],{1:3,2:0}).precision_at_5,null);
assert.equal(P.metrics([1,2,3,4,5],{1:3,2:0,3:2,4:0,5:1}).recall_at_50,null);
assert.equal(P.metrics([1,2,3,4,5],{1:3,2:0,3:2,4:0,5:1}).ndcg_at_5,null);
const grades={1:3,2:0,3:2,4:0,5:1};
const result=P.evaluatePaired([{query_id:'fabricated',baseline:[2,4,5,1,3],
  experiment:[1,3,5,2,4],judgments:grades,exhaustive:true}])[0];
assert.equal(result.baseline.precision_at_5,0.4);
assert.equal(result.experiment.precision_at_5,0.4);
assert.ok(result.experiment.ndcg_at_5>result.baseline.ndcg_at_5);
assert.equal(result.experiment.recall_at_50,1);
console.log('P0/P1 PASS: schema, hash, linhas reais, cobertura e métricas sintéticas.');
