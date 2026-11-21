'use strict';
// Agent 12 regression suite: synthetic fixtures verify auditing logic only.
// Does NOT constitute 50 human judgments or a real semantic retrieval run.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {audit}=require('./qa_intent50_agent.js');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const MODEL='ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1';
function fixture(){
 const intents=Array.from({length:50},(_,i)=>({id:(i<25?'N':'T')+String(i%25+1).padStart(2,'0'),
  query:'Consulta sintética de relevância para episódio independente número '+i,
  category:i<25?'biblical_event':'thematic',split:i%5===0||i%5===3?'holdout':'development'}));
 const manifest={schema_version:1,kind:'semantic_intent_panel',
  human_review_status:'pending',authoring_status:'draft_unjudged',intent_count:50,intents};
 const manifestBytes=Buffer.from(JSON.stringify(manifest)),manifest_sha256=digest(manifestBytes);
 const common={schema_version:1,manifest_sha256,catalog_sha256:'a'.repeat(64),
   model_sha256:MODEL,human_review_status:'pending',intent_count:50};
 const vectors={schema_version:1,source_kind:'actual_e5_onnx_inference',
  review_status:'pending',manifest_sha256,model_sha256:MODEL,
  vectors:intents.map(x=>({id:x.id,vector:[1,...Array(383).fill(0)]}))};
 const packet={...common,kind:'blind_review_packet',
  rows:intents.map(x=>({id:x.id,query:x.query,category:x.category,split:x.split,
   candidates:Array.from({length:21},(_,j)=>({blind_id:'b'+x.id+'_'+j,
    title:'Cântico de teste '+j,collection:['principal'],number:String(j).padStart(3,'0')}))}))};
 const sealed={...common,kind:'sealed_retrieval_ranks',rows:intents.map(x=>({
  id:x.id,without_e5:Array.from({length:20},(_,j)=>'b'+x.id+'_'+j),
  with_e5:Array.from({length:20},(_,j)=>'b'+x.id+'_'+(j+1))}))};
 return {manifest,manifestBytes,vectors,packet,sealed};
}
assert.equal(audit(fixture()).decision,'approved','Positive QA fixture failed');
const mutants=[
 x=>{x.packet.rows.pop();},
 x=>{x.packet.rows[0].candidates.pop();},
 x=>{x.packet.rows[0].candidates[0].rank=1;},
 x=>{x.vectors.vectors[2].vector=[1,0];},
 x=>{x.sealed.rows[0].with_e5[2]=x.sealed.rows[0].with_e5[1];},
 x=>{x.packet.human_review_status='approved';},
 x=>{x.packet.rows[3].query='Consulta adulterada';},
 x=>{x.packet.rows[3].candidates[2].lyrics='Texto que não pode vazar';},
 x=>{x.manifest.intents[2].query=x.manifest.intents[1].query;},
 x=>{x.vectors.source_kind='fake_e5_vectors';},
];
for(let i=0;i<mutants.length;i++){
 const f=fixture();mutants[i](f);
 assert.equal(audit(f).decision,'rejected','Mutant '+(i+1)+' escaped independent agent');
}
console.log('AGENT 12 SELFTEST: 1 positive + '+mutants.length+' negative fixtures PASS; human review pending');
