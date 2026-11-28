'use strict';
// P0/P1 offline experiment, not loaded by the Android app.
// Profiles contain externally authored claims, not certified semantic facts.
const {createHash}=require('node:crypto');
const VERSION=1;
const STRINGS=['central_message','narrator_perspective','opening_situation','conflict','transformation','resolution'];
const LISTS=['primary_themes','secondary_themes','incidental_mentions','negated_events'];
const CLAIMS=[...STRINGS,...LISTS,'biblical_parallels'];
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const isText=(x,max=500)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&!/[\r\n\x00-\x08]/u.test(x);
const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);

function parseLyrics(lyrics){
  if(typeof lyrics!=='string'||!lyrics.trim()||lyrics.length>200000)throw Error('Fonte vazia ou excessiva');
  const result=lyrics.replace(/\r\n?/gu,'\n').trim().split(/\n[ \t]*\n+/u)
    .map(s=>s.split('\n').map(line=>line.trim()).filter(Boolean)).filter(s=>s.length);
  if(!result.length||result.length>128||result.some(s=>s.length>256))throw Error('Estrutura inválida');
  return result;
}
const sourceHash=h=>hash(JSON.stringify([h.collection,h.id,h.title]));
function lineRefs(lyrics){
  const refs=new Map();
  parseLyrics(lyrics).forEach((lines,s)=>lines.forEach((line,l)=>
    refs.set('s'+s+':l'+l,{stanza:s,line})));
  return refs;
}
function validateProfile(h,profile){
  const errors=[],err=e=>errors.push(e);
  if(!h||!Number.isSafeInteger(h.id)||h.id<0||!isText(h.collection,40)||
    !/^[a-z][a-z0-9_-]*$/u.test(h.collection)||!isText(h.title,300)||
    typeof h.lyrics!=='string')return {ok:false,errors:['Fonte inválida']};
  let stanzas,refs;
  try{stanzas=parseLyrics(h.lyrics);refs=lineRefs(h.lyrics);}
  catch(e){return {ok:false,errors:['Estrutura da fonte inválida']};}
  if(!profile||typeof profile!=='object'||Array.isArray(profile))
    return {ok:false,errors:['Perfil ausente']};
  if(profile.schema_version!==VERSION)err('Versão de schema incompatível');
  if(profile.hymn_id!==h.id||profile.source_collection!==h.collection)err('Identidade incorreta');
  if(!validHash(profile.source_sha256)||profile.source_sha256!==sourceHash(h))err('Metadados alterados');
  if(!validHash(profile.lyrics_sha256)||profile.lyrics_sha256!==hash(h.lyrics))err('Letra alterada');
  const gen=profile.profile_generator;
  if(!gen||!isText(gen.model_id,128)||!['fixture','human','model'].includes(gen.method)||
    !Number.isInteger(gen.prompt_version)||gen.prompt_version<1)err('Origem inválida');
  if(profile.validation?.status!=='pending'||profile.validation?.method!=='none')
    err('Validação semântica não demonstrada');
  const g=profile.global;
  if(!g||typeof g!=='object')return {ok:false,errors:[...errors,'Perfil global ausente']};
  for(const key of STRINGS)
    if(typeof g[key]!=='string'||g[key].length>500||(key==='central_message'&&!isText(g[key])))
      err('Campo inválido: '+key);
  for(const key of LISTS)
    if(!Array.isArray(g[key])||g[key].length>30||!g[key].every(x=>isText(x,100)))
      err('Lista inválida: '+key);
  if(!Array.isArray(g.biblical_parallels)||g.biblical_parallels.length>20||
    !g.biblical_parallels.every(p=>p&&isText(p.reference,80)&&['explicit','inferred'].includes(p.kind)))
    err('Paralelos inválidos');
  const checkEvidence=(items,label,stanza=null)=>{
    if(!Array.isArray(items)||items.length>100||new Set(items).size!==items.length){
      err('Evidência inválida: '+label);return;
    }
    for(const id of items)if(typeof id!=='string'||
      !/^s(?:0|[1-9]\d*):l(?:0|[1-9]\d*)$/u.test(id)||!refs.has(id)||
      (stanza!==null&&refs.get(id)?.stanza!==stanza))err('Linha inexistente: '+label);
  };
  if(!g.claim_evidence||typeof g.claim_evidence!=='object')
    err('Evidência global ausente');
  else for(const key of CLAIMS){
    checkEvidence(g.claim_evidence[key],key);
    const value=g[key];
    const filled=Array.isArray(value)?value.length>0:typeof value==='string'&&value.trim().length>0;
    if(filled&&(!Array.isArray(g.claim_evidence[key])||!g.claim_evidence[key].length))
      err('Alegação sem evidência: '+key);
  }
  if(!Array.isArray(profile.stanzas)||profile.stanzas.length!==stanzas.length)
    err('Cobertura de estrofes incompleta');
  else for(let i=0;i<stanzas.length;i++){
    const s=profile.stanzas[i];
    if(!s||s.stanza_index!==i||!isText(s.semantic_role,100)||!isText(s.summary))
      err('Estrofe inválida: '+i);
    checkEvidence(s?.evidence_line_ids,'estrofe '+i,i);
    if(!s?.evidence_line_ids?.length)err('Estrofe sem evidência: '+i);
  }
  const source=h.lyrics.replace(/\s+/gu,' ').toLocaleLowerCase('pt-BR');
  const claims=[...STRINGS.map(k=>g[k]),...LISTS.flatMap(k=>Array.isArray(g[k])?g[k]:[]),
    ...(Array.isArray(profile.stanzas)?profile.stanzas.flatMap(s=>[s?.summary,s?.semantic_role]):[])];
  for(const claim of claims)
    if(typeof claim==='string'&&claim.trim().length>=28&&
      source.includes(claim.trim().replace(/\s+/gu,' ').toLocaleLowerCase('pt-BR')))
      err('Cópia literal longa da fonte no perfil');
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}
function createProfile(h,analysis,{model_id='not-verified',method='fixture',prompt_version=1}={}){
  const result={
    schema_version:VERSION,hymn_id:h.id,source_collection:h.collection,
    source_sha256:sourceHash(h),lyrics_sha256:hash(h.lyrics),
    profile_generator:{model_id,method,prompt_version},
    validation:{status:'pending',method:'none'},global:analysis.global,stanzas:analysis.stanzas
  };
  const check=validateProfile(h,result);
  if(!check.ok)throw Error('Perfil inválido: '+check.errors.join('; '));
  return JSON.parse(JSON.stringify(result));
}
function embeddingText(profile){
  if(profile?.schema_version!==VERSION||!profile.global||
    !Array.isArray(profile.stanzas))throw Error('Perfil incompatível');
  const g=profile.global;
  return [g.central_message,g.narrator_perspective,g.opening_situation,g.conflict,
    g.transformation,g.resolution,...g.primary_themes,...g.secondary_themes,
    ...profile.stanzas.map(s=>s.summary)].filter(Boolean).join(' · ');
}
// Null metrics prevent treating unknown judgments as negatives.
function metrics(ranking,judgments,{exhaustive=false}={}){
  if(!Array.isArray(ranking)||new Set(ranking).size!==ranking.length||
    !judgments||typeof judgments!=='object')throw Error('Ranking ou gabarito inválido');
  for(const grade of Object.values(judgments))
    if(!Number.isInteger(grade)||grade<0||grade>3)throw Error('Nota inválida');
  const top=ranking.slice(0,5);
  const complete=top.length===5&&top.every(id=>Object.hasOwn(judgments,String(id)));
  const p5=complete?top.filter(id=>judgments[id]>=2).length/5:null;
  const fp5=complete?top.filter(id=>judgments[id]===0).length:null;
  let n5=null;
  if(complete&&exhaustive){
    const dcg=top.reduce((n,id,i)=>n+(2**judgments[id]-1)/Math.log2(i+2),0);
    const ideal=Object.values(judgments).sort((a,b)=>b-a).slice(0,5)
      .reduce((n,v,i)=>n+(2**v-1)/Math.log2(i+2),0);
    n5=ideal?dcg/ideal:1;
  }
  const relevant=Object.entries(judgments).filter(([,v])=>v>=2).map(([id])=>id);
  const recall=exhaustive&&relevant.length?
    relevant.filter(id=>ranking.slice(0,50).some(x=>String(x)===id)).length/relevant.length:null;
  return {precision_at_5:p5,ndcg_at_5:n5,recall_at_50:recall,
    false_positives_top_5:fp5,labels_complete:complete,exhaustive};
}
function evaluatePaired(cases){
  if(!Array.isArray(cases)||!cases.length)throw Error('Sem casos');
  return cases.map(c=>({
    query_id:c.query_id,
    baseline:metrics(c.baseline,c.judgments,{exhaustive:c.exhaustive===true}),
    experiment:metrics(c.experiment,c.judgments,{exhaustive:c.exhaustive===true})
  }));
}
module.exports={VERSION,parseLyrics,lineRefs,sourceHash,createProfile,
  validateProfile,embeddingText,metrics,evaluatePaired};
