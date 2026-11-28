'use strict';
/* P1: deterministic HUMAN review queue drawn from the actual imported catalog.
 * Only identities, hashes and structural proxies leave the ephemeral QA runner.
 * Never persist song lyrics, snippets, model conclusions or pseudo-human labels.
 */
const crypto=require('node:crypto');
const fingerprint=s=>crypto.createHash('sha256').update(String(s),'utf8').digest('hex');
function assertSource(h){
  if(!h||!Number.isSafeInteger(h.id)||h.id<=0||typeof h.lyrics!=='string'||
    !h.lyrics.trim()||typeof h.title!=='string'||!h.title.trim())
    throw Error('Hino inválido na amostra');
}
function features(lyrics){
  const stanzas=lyrics.replace(/\r\n?/gu,'\n').trim().split(/\n[ \t]*\n+/u).filter(Boolean);
  const norm=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const whole=' '+norm(lyrics)+' ';
  const early=norm(stanzas[0]||''),late=norm(stanzas.at(-1)||'');
  const tokens=s=>new Set((s.match(/\p{L}{4,}/gu)||[]).filter(w=>![
    'deus','jesus','cristo','senhor','para','porque','nosso','minha','meus','mais','toda','todo',
    'pelo','pela','esta','esse','isso','assim','como','ainda','entre','sobre','aquele','aquela'
  ].includes(w)));
  const one=tokens(early),last=tokens(late);
  const overlap=[...one].filter(x=>last.has(x)).length;
  return {
    stanza_bucket:stanzas.length<=2?'short':stanzas.length<=4?'medium':'long',
    stanza_count:stanzas.length,
    negation_proxy:/\b(nao|nunca|jamais|nem)\b/u.test(whole),
    first_person_proxy:/\b(eu|meu|minha|mim|comigo)\b/u.test(whole),
    opening_closing_lexical_shift_proxy:stanzas.length>1&&one.size>=4&&last.size>=4&&
      overlap/Math.max(1,Math.min(one.size,last.size))<0.2
  };
}
const partition=(sourceSha,id)=>{
  const v=parseInt(fingerprint('reserved-v1:'+sourceSha+':'+id).slice(0,8),16);
  return v%5===0?'reserved_evaluation':'development';
};
const sortHash=(a,b,salt)=>fingerprint(salt+':'+a.id).localeCompare(fingerprint(salt+':'+b.id));
function safeHymn(h){
  assertSource(h);
  return {
    hymn_id:h.id,number:h.number==null?null:String(h.number),
    title:h.title.slice(0,150),lyrics_sha256:fingerprint(h.lyrics),
    structural_proxies:features(h.lyrics)
  };
}
function buildReviewManifest({catalogSha256,hymns,audits}){
  if(typeof catalogSha256!=='string'||!/^[a-f0-9]{64}$/u.test(catalogSha256)||
    !Array.isArray(hymns)||!hymns.length||!Array.isArray(audits)||!audits.length)
    throw Error('Fonte, hinos ou auditoria ausentes');
  const map=new Map();
  for(const h of hymns){
    assertSource(h);
    if(map.has(h.id))throw Error('ID duplicado no catálogo');
    map.set(h.id,h);
  }
  const tasks=[],seen=new Set();
  const add=(audit,hit,reason)=>{
    const h=map.get(hit?.id);
    if(!h)throw Error('Resultado de busca inexistente na fonte');
    const key=audit.query+'\u0000'+h.id;
    if(seen.has(key))return;
    seen.add(key);
    const safe=safeHymn(h);
    tasks.push({
      task_id:fingerprint('query:'+catalogSha256+':'+key).slice(0,20),
      query:audit.query,
      ...safe,partition:partition(catalogSha256,h.id),reason,
      baseline_position:Number.isInteger(hit.pos)?hit.pos:null,
      relevance_grade:null,evidence_line_ids:[],review_status:'pending_human'
    });
  };
  for(const audit of audits){
    if(typeof audit.query!=='string'||!Array.isArray(audit.top10)||
      !Array.isArray(audit.strongNotTop10))throw Error('Auditoria inválida');
    const weak=audit.top10.filter(h=>h.lexicalStatus!=='apoio lexical em letra integral').slice(0,3);
    const strong=audit.top10.filter(h=>h.lexicalStatus==='apoio lexical em letra integral').slice(0,2);
    for(const h of weak)add(audit,h,'top10_weak_lexical_proxy');
    for(const h of strong)add(audit,h,'top10_positive_lexical_proxy');
    for(const h of audit.strongNotTop10.slice(0,2))
      add(audit,h,'outside_top10_lexical_proxy');
  }
  const selected=[],chosen=new Set();
  const decorated=hymns.map(h=>({id:h.id,f:features(h.lyrics)}));
  const strata=[
    ['negation',x=>x.f.negation_proxy],
    ['first_person',x=>x.f.first_person_proxy],
    ['opening_closing_lexical_shift',x=>x.f.opening_closing_lexical_shift_proxy],
    ['short_stanzas',x=>x.f.stanza_bucket==='short'],
    ['medium_stanzas',x=>x.f.stanza_bucket==='medium'],
    ['long_stanzas',x=>x.f.stanza_bucket==='long']
  ];
  for(const [stratum,test] of strata){
    const bucket=decorated.filter(test).sort((a,b)=>sortHash(a,b,catalogSha256+':'+stratum));
    let count=0;
    for(const entry of bucket){
      if(chosen.has(entry.id))continue;
      chosen.add(entry.id);
      const h=map.get(entry.id);
      selected.push({
        sample_id:fingerprint('profile:'+catalogSha256+':'+h.id).slice(0,20),
        ...safeHymn(h),partition:partition(catalogSha256,h.id),
        selected_stratum:stratum,profile_annotation_state:'pending_human',
        semantic_profile:null
      });
      if(++count>=6)break;
    }
  }
  const byReason=Object.create(null);
  for(const t of tasks)byReason[t.reason]=(byReason[t.reason]||0)+1;
  const counts={development:0,reserved_evaluation:0};
  for(const task of tasks)counts[task.partition]++;
  // The review queue contains NO judgments; this count cannot be used as a relevance metric.
  return {
    schema_version:1,
    source_catalog_sha256:catalogSha256,
    status:'awaiting_independent_human_review',
    review_protocol:'0 irrelevant; 1 contextually related; 2 good match; 3 specific match',
    warnings:[
      'Structural and lexical markers are sampling proxies, not semantic relevance decisions.',
      'Reserved evaluation partition is deterministic and public: it is not a blinded holdout.',
      'No human relevance labels or global semantic profiles are generated by this script.'
    ],
    counts:{
      imported_hymns:hymns.length,queries:audits.length,
      relevance_tasks:tasks.length,profile_candidates:selected.length,
      development_review_tasks:counts.development,reserved_review_tasks:counts.reserved_evaluation,
      reason_counts:byReason
    },
    relevance_tasks:tasks,profile_candidates:selected
  };
}
module.exports={fingerprint,features,partition,buildReviewManifest};
