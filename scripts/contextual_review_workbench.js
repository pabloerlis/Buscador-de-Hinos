'use strict';
// P1 local human-review workbench. Lyrics are shown only on the local terminal.
// Structural validation never certifies semantic truth or reviewer independence.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const {makeRuntime}=require('../tests/agents/runtime');
const P=require('./semantic_profile_poc');
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const LINE=/^s(?:0|[1-9]\d*):l(?:0|[1-9]\d*)$/u;
const sourceHymn=h=>{
  const collection=h?.collectionRefs?.find(r=>/^[a-z][a-z0-9_-]*$/u.test(r?.id||''))?.id||
    h?.collections?.find(c=>/^[a-z][a-z0-9_-]*$/u.test(c||''));
  if(!collection||!Number.isSafeInteger(h?.id)||!h.lyrics||!h.title)
    throw Error('Metadados canônicos do hino indisponíveis');
  return {id:h.id,collection,title:h.title,lyrics:h.lyrics};
};
function verifyQueue(queue,sha,byId){
  if(queue?.schema_version!==1||queue?.source_catalog_sha256!==sha||
    !Array.isArray(queue.relevance_tasks)||!Array.isArray(queue.profile_candidates))
    throw Error('Manifesto incompatível com a fonte');
  const tasks=new Map(),samples=new Map();
  for(const [records,idKey,lookup] of [
    [queue.relevance_tasks,'task_id',tasks],[queue.profile_candidates,'sample_id',samples]
  ])for(const record of records){
    if(!record||typeof record[idKey]!=='string'||lookup.has(record[idKey]))
      throw Error('Identificador de tarefa duplicado/ausente');
    const h=byId.get(record.hymn_id);
    if(!h||record.lyrics_sha256!==digest(h.lyrics)||record.title!==h.title.slice(0,150))
      throw Error('Letra ou identidade de tarefa alterada');
    lookup.set(record[idKey],record);
  }
  if(tasks.size===0||samples.size===0)throw Error('Amostra vazia');
  return {tasks,samples};
}
function evidence(lyrics,ids,required){
  const refs=P.lineRefs(lyrics);
  if(!Array.isArray(ids)||ids.length>30||new Set(ids).size!==ids.length||
    ids.some(id=>typeof id!=='string'||!LINE.test(id)||!refs.has(id))||
    (required&&ids.length===0))throw Error('Evidências ausentes ou referências inexistentes');
  return true;
}
function validateLabel(row,task,h){
  if(!row||!task||!h||row.schema_version!==1||row.task_id!==task.task_id||
    row.hymn_id!==task.hymn_id||row.lyrics_sha256!==task.lyrics_sha256||
    row.query!==task.query||!Number.isInteger(row.grade)||row.grade<0||row.grade>3)
    throw Error('Julgamento ou origem inválida');
  if(typeof row.reviewer_alias!=='string'||!/^[a-z0-9_.-]{3,40}$/iu.test(row.reviewer_alias)||
    row.attested_read_full_lyrics!==true||row.review_status!=='human_recorded')
    throw Error('Declaração de revisão ausente');
  if(typeof row.reason!=='string'||row.reason.trim().length<15||
    row.reason.length>240||/[\r\n]/u.test(row.reason))
    throw Error('Justificativa inválida');
  const text=h.lyrics.toLocaleLowerCase('pt-BR').replace(/\s+/gu,' ');
  const reason=row.reason.trim().toLocaleLowerCase('pt-BR').replace(/\s+/gu,' ');
  if(reason.length>=28&&text.includes(reason))throw Error('Justificativa copia letra');
  evidence(h.lyrics,row.evidence_line_ids,row.grade>0);
  return true;
}
function templateProfile(h,sample){
  if(!sample||sample.hymn_id!==h.id||sample.lyrics_sha256!==digest(h.lyrics))
    throw Error('Amostra de outra edição');
  const fields=['central_message','narrator_perspective','opening_situation','conflict',
    'transformation','resolution','primary_themes','secondary_themes','incidental_mentions',
    'negated_events','biblical_parallels'];
  return {
    sample_id:sample.sample_id,reviewer_alias:'',attested_read_full_lyrics:false,
    annotation:{global:{
      central_message:'',narrator_perspective:'',opening_situation:'',conflict:'',
      transformation:'',resolution:'',primary_themes:[],secondary_themes:[],
      incidental_mentions:[],negated_events:[],biblical_parallels:[],
      claim_evidence:Object.fromEntries(fields.map(x=>[x,[]]))
    },stanzas:P.parseLyrics(h.lyrics).map((_,i)=>({
      stanza_index:i,semantic_role:'',summary:'',evidence_line_ids:[]
    }))}
  };
}
function validateProfileDraft(draft,sample,h){
  if(!draft||draft.sample_id!==sample?.sample_id||
    draft.attested_read_full_lyrics!==true||
    typeof draft.reviewer_alias!=='string'||
    !/^[a-z0-9_.-]{3,40}$/iu.test(draft.reviewer_alias))
    throw Error('Declaração de revisão de perfil ausente');
  const profile=P.createProfile(sourceHymn(h),draft.annotation,{
    model_id:'manual-annotation-v1',method:'human',prompt_version:1
  });
  if(profile.lyrics_sha256!==sample.lyrics_sha256)throw Error('Edição do perfil incorreta');
  return {sample_id:sample.sample_id,reviewer_alias:draft.reviewer_alias,
    attested_read_full_lyrics:true,review_status:'human_recorded_not_independently_adjudicated',
    profile};
}
function counts(queue,saved){
  const labels=new Set(saved.labels.map(x=>x.task_id));
  const profiles=new Set(saved.profiles.map(x=>x.sample_id));
  return {labels_done:queue.relevance_tasks.filter(t=>labels.has(t.task_id)).length,
    labels_total:queue.relevance_tasks.length,
    profiles_done:queue.profile_candidates.filter(t=>profiles.has(t.sample_id)).length,
    profiles_total:queue.profile_candidates.length,
    independently_certified:false};
}
function reviewPath(target){
  const absolute=path.resolve(target);
  const relative=path.relative(path.resolve(__dirname,'..'),absolute).replace(/\\/gu,'/');
  if(relative&&!relative.startsWith('../')&&!path.isAbsolute(relative)&&
    !relative.startsWith('.tmp/')&&!relative.startsWith('private-review/'))
    throw Error('Não grave revisões em arquivos distribuídos no Git/APK');
  return absolute;
}
function writeLocal(file,data){
  const target=reviewPath(file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temp=target+'.tmp-'+process.pid;
  fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});
  fs.renameSync(temp,target);
}
function readLocal(file){
  const target=reviewPath(file);
  if(!fs.existsSync(target))return {schema_version:1,labels:[],profiles:[]};
  const data=JSON.parse(fs.readFileSync(target,'utf8'));
  if(data.schema_version!==1||!Array.isArray(data.labels)||!Array.isArray(data.profiles))
    throw Error('Arquivo de revisão inválido');
  return data;
}
function showLines(h){
  console.log('\n'+String(h.number||'')+' · '+h.title);
  P.parseLyrics(h.lyrics).forEach((stanza,i)=>{
    console.log('\nESTROFE '+(i+1));
    stanza.forEach((line,j)=>console.log('s'+i+':l'+j+'  '+line));
  });
}
async function main(){
  const [action,catalogFile,queueFile,localFile,aliasArg]=process.argv.slice(2);
  if(!['inspect','label','profile-template','profile-verify','audit'].includes(action)||
    !catalogFile||!queueFile||!localFile)
    throw Error('Uso: node scripts/contextual_review_workbench.js inspect|label|profile-template|profile-verify|audit catalogo.json fila.json .tmp/reviews.json [revisor]');
  const bytes=fs.readFileSync(catalogFile);
  const api=makeRuntime();
  const imported=await api.request('/api/import',{data:JSON.parse(bytes.toString('utf8'))});
  const byId=new Map();
  for(let id=1;id<=imported.count;id++){
    const h=await api.request('/api/hymns/'+id);byId.set(h.id,h);
  }
  const queue=JSON.parse(fs.readFileSync(queueFile,'utf8'));
  const {tasks,samples}=verifyQueue(queue,digest(bytes),byId);
  const saved=readLocal(localFile);
  for(const row of saved.labels)validateLabel(row,tasks.get(row.task_id),byId.get(row.hymn_id));
  for(const row of saved.profiles){
    const sample=samples.get(row.sample_id),h=byId.get(sample?.hymn_id);
    if(!sample||!h||validateProfileDraft({
      sample_id:row.sample_id,reviewer_alias:row.reviewer_alias,
      attested_read_full_lyrics:row.attested_read_full_lyrics,
      annotation:{global:row.profile.global,stanzas:row.profile.stanzas}
    },sample,h).profile.lyrics_sha256!==row.profile.lyrics_sha256)
      throw Error('Perfil salvo inválido');
  }
  if(action==='audit'){console.log(JSON.stringify(counts(queue,saved),null,2));return;}
  const profiles=action.startsWith('profile-');
  const completed=new Set((profiles?saved.profiles:saved.labels)
    .map(x=>profiles?x.sample_id:x.task_id));
  const row=(profiles?queue.profile_candidates:queue.relevance_tasks)
    .find(x=>!completed.has(profiles?x.sample_id:x.task_id));
  if(!row){console.log('Todos os itens desse tipo já foram registrados.');return;}
  const h=byId.get(row.hymn_id);
  showLines(h);
  if(action==='inspect')return;
  if(action==='profile-template'){
    const file=localFile+'.profile-'+row.sample_id+'.json';
    writeLocal(file,templateProfile(h,row));
    console.log('Perfil local pendente criado: '+reviewPath(file));return;
  }
  if(action==='profile-verify'){
    const file=localFile+'.profile-'+row.sample_id+'.json';
    const checked=validateProfileDraft(JSON.parse(fs.readFileSync(reviewPath(file),'utf8')),row,h);
    saved.profiles.push(checked);writeLocal(localFile,saved);
    console.log('Integridade do perfil validada; sem certificação semântica.');return;
  }
  const io=readline.createInterface({input:stdin,output:stdout});
  try{
    const alias=aliasArg||await io.question('Identificador pseudônimo do revisor: ');
    const grade=Number(await io.question('Grau de relevância 0, 1, 2 ou 3: '));
    const lines=(await io.question('IDs de evidência separados por vírgula: '))
      .split(',').map(x=>x.trim()).filter(Boolean);
    const reason=await io.question('Justificativa em palavras próprias: ');
    const attest=(await io.question('Leu a letra inteira? Digite LI: ')).trim();
    const recorded={schema_version:1,task_id:row.task_id,hymn_id:row.hymn_id,
      lyrics_sha256:row.lyrics_sha256,query:row.query,grade,
      evidence_line_ids:lines,reason,reviewer_alias:alias,
      attested_read_full_lyrics:attest==='LI',review_status:'human_recorded'};
    validateLabel(recorded,row,h);
    saved.labels.push(recorded);writeLocal(localFile,saved);
    console.log('Julgamento armazenado apenas localmente; revisão independente pendente.');
  }finally{io.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={sourceHymn,verifyQueue,evidence,validateLabel,templateProfile,
  validateProfileDraft,counts,reviewPath,writeLocal,readLocal};
