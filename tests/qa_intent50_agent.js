'use strict';
/* Independent Agent 12. Audits real OfflineAPI review packet and sealed ranking;
 * never invents human relevance. Fail closed on leakage or missing E5 evidence.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const MODEL='ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1';
function audit({manifest,manifestBytes,vectors,packet,sealed}){
 const errors=[],check=(ok,msg)=>{if(!ok)errors.push(msg);};
 const intents=manifest.intents||[],rows=packet.rows||[],hidden=sealed.rows||[];
 const isStrings=xs=>xs.every(x=>typeof x==='string'&&x.length>0);
 check(manifest.schema_version===1&&manifest.kind==='semantic_intent_panel'&&
   manifest.human_review_status==='pending'&&manifest.authoring_status==='draft_unjudged',
   'Unreviewed manifest contract');
 check(intents.length===50&&manifest.intent_count===50,'Fewer than 50 distinct intents');
 const keys=new Set(),queries=new Set(),distribution={},split={};
 for(const item of intents){
  check(/^([NT])\d\d$/.test(item.id||''),'Invalid intent id');
  keys.add(item.id);
  queries.add(String(item.query||'').normalize('NFKD').toLowerCase().trim());
  distribution[item.category]=(distribution[item.category]||0)+1;
  split[item.split]=(split[item.split]||0)+1;
  check(typeof item.query==='string'&&item.query.length>=30&&item.query.length<=220,
    'Empty or malformed semantic query');
  check(['development','holdout'].includes(item.split),'Split missing');
 }
 check(keys.size===50&&queries.size===50,'Queries/intent identifiers duplicate');
 check(distribution.biblical_event===25&&distribution.thematic===25,'Missing topical diversity');
 check(split.holdout>=15&&split.development>=20,'No protected holdout');
 const manifestHash=hash(manifestBytes);
 for(const entry of [packet,sealed]){
  check(entry.schema_version===1&&entry.manifest_sha256===manifestHash&&
    entry.human_review_status==='pending'&&entry.intent_count===50,
    'Manifest/label mismatch');
  check(entry.model_sha256===MODEL,'Model fingerprint mismatch');
  check(typeof entry.catalog_sha256==='string'&&/^[a-f0-9]{64}$/.test(entry.catalog_sha256),
    'Missing catalog digest');
 }
 check(packet.kind==='blind_review_packet'&&sealed.kind==='sealed_retrieval_ranks',
   'Review packet is not segregated from ranking');
 check(packet.catalog_sha256===sealed.catalog_sha256,'Sealed catalog changed');
 check(vectors.schema_version===1&&vectors.source_kind==='actual_e5_onnx_inference'&&
  vectors.review_status==='pending'&&vectors.manifest_sha256===manifestHash&&
  vectors.model_sha256===MODEL,'Authentic E5 source not verified');
 check((vectors.vectors||[]).length===50,'Not all queries received ONNX E5');
 check(rows.length===50&&hidden.length===50,'Top20 packets incomplete');
 const forbidden=new Set(['rank','ranks','score','scores','position','variant',
  'with_e5','without_e5','vector','vectors','lyrics','lyric','stanza',
  'excerpt','text','human_label','label','relevance','judgment']);
 let overlapTotal=0;
 for(let i=0;i<50;i++){
  const item=intents[i]||{},publicRow=rows[i]||{},secret=hidden[i]||{};
  const vector=(vectors.vectors||[])[i]||{};
  check(item.id===publicRow.id&&item.id===secret.id&&item.id===vector.id,
    'Probe identity mismatch '+i);
  check(item.query===publicRow.query&&item.split===publicRow.split&&
    item.category===publicRow.category,'Query/review split mismatch '+i);
  check(Array.isArray(vector.vector)&&vector.vector.length===384&&
    vector.vector.every(Number.isFinite)&&
    Math.abs(Math.hypot(...vector.vector)-1)<.03,'Invalid or missing 384D E5 vector '+i);
  for(const n of ['without_e5','with_e5']){
   check(Array.isArray(secret[n])&&secret[n].length===20&&isStrings(secret[n])&&
     new Set(secret[n]).size===20,'Incorrect genuine top20 '+n+'/'+i);
  }
  const a=secret.without_e5||[],b=secret.with_e5||[],set=new Set([...a,...b]);
  const candidates=publicRow.candidates||[];
  check(candidates.length===set.size&&set.size>=20&&set.size<=40,
    'Candidate union incomplete '+i);
  check(new Set(candidates.map(x=>x.blind_id)).size===candidates.length,
    'Duplicate blinded candidate '+i);
  check(candidates.every(x=>set.has(x.blind_id)),'Unknown candidate '+i);
  check(candidates.every(x=>typeof x.title==='string'&&x.title.length>0&&x.title.length<=180&&
   !/[\r\n]/.test(x.title)&&Array.isArray(x.collection)&&
   typeof x.number==='string'),'Missing candidate identity or potential lyric leak '+i);
  for(const record of [publicRow,...candidates]){
   for(const key of Object.keys(record))
    check(!forbidden.has(key),'Rank/score/label/lyric leaked to blind packet: '+key);
  }
  overlapTotal+=a.filter(x=>b.includes(x)).length;
 }
 check(!/"(?:lyrics|lyric|stanza|excerpt|relevance|rank|score|judgment)"\s*:/.test(JSON.stringify(packet)),
  'Hidden data leaked');
 check(!('labels' in packet)&&!('judgments' in packet),'Forged human judgments');
 return {schema_version:1,agent:'12-independent-intent50-review-packet',
  decision:errors.length?'rejected':'approved',human_review_status:'pending',
  reviewed_intents:0,intents:rows.length,
  catalog_sha256:packet.catalog_sha256,manifest_sha256:manifestHash,
  observed_top20_overlap:overlapTotal,
  observation:'Top20 overlap is not relevance or Recall. No human judgments were performed.',
  errors};
}
if(require.main===module){
 const manifestPath=path.join(root,'qa/semantic-intents-50.json'),
  manifestBytes=fs.readFileSync(manifestPath),reportDir=path.join(root,'qa-report');
 const load=n=>JSON.parse(fs.readFileSync(path.join(reportDir,n),'utf8'));
 const verdict=audit({manifest:JSON.parse(manifestBytes),manifestBytes,
  vectors:load('intent50-vectors.json'),packet:load('intent50-blind-packet.json'),
  sealed:load('intent50-sealed-ranking.json')});
 fs.writeFileSync(path.join(reportDir,'intent50-independent-agent.json'),
  JSON.stringify(verdict,null,2)+'\n');
 console.log('AGENT 12:',verdict.decision,'50 independent intents for later human judging; human review pending');
 if(verdict.errors.length){verdict.errors.forEach(e=>console.error(e));process.exitCode=1;}
}
module.exports={audit};
