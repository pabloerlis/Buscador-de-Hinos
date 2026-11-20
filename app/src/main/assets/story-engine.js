'use strict';
/* Índice de narrativas sem IA. Uma ocorrência isolada de "filho" ou "pai"
 * nunca basta para classificar um hino como Filho Pródigo.
 * Frases fortes ou múltiplos sinais de grupos independentes são exigidos.
 */
const StoryEngine = (() => {
  const normalize = text => String(text??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\s\u00a0]+/g,' ').trim();
  const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function matcher(term){
    const safe=escapeRe(normalize(term)).replace(/\s+/g,'\\s+');
    return new RegExp('(?:^|[^a-z0-9])'+safe+'(?=$|[^a-z0-9])');
  }
  function create(db){
    if(!db||db.schema_version!==1||!Array.isArray(db.stories)||db.stories.length>80)throw Error('Índice de narrativas inválido');
    const stories=db.stories.map(s=>{
      if(!s.id||!s.label||!Array.isArray(s.aliases)||!Array.isArray(s.phrases)||!Array.isArray(s.groups)||s.groups.length<2)throw Error('Narrativa sem estrutura suficiente');
      if(s.events&&(!Array.isArray(s.events)||s.events.length>12||s.events.some(event=>!event.id||!event.label||!Array.isArray(event.cues)||!event.cues.length||event.cues.length>25)))throw Error('Eventos narrativos inválidos');
      return {...s,matchAliases:s.aliases.map(a=>({text:a,normalized:normalize(a),re:matcher(a)})),
        matchPhrases:s.phrases.map(x=>({text:x,re:matcher(x)})),
        matchGroups:s.groups.map(group=>group.map(x=>({text:x,re:matcher(x)}))),
        matchAnchors:(s.anchors||[]).map(x=>({text:x,re:matcher(x)})),
        matchEvents:(s.events||[]).map(event=>({id:event.id,label:event.label,
          cues:event.cues.map(x=>({text:x,re:matcher(x)}))})),
        matchPerspective:s.perspective?{label:s.perspective.label,
          cues:s.perspective.cues.map(x=>({text:x,re:matcher(x)}))}:null};
    });
    if(new Set(stories.map(s=>s.id)).size!==stories.length)throw Error('Narrativas com IDs duplicados');
    function indexHymn(title,lyrics){
      const normTitle=normalize(title),normLyrics=normalize(lyrics),profile=[];
      const found=cue=>cue.re.test(normTitle)||cue.re.test(normLyrics);
      for(const s of stories){
        const phraseHits=s.matchPhrases.filter(found).map(p=>p.text).slice(0,3);
        const groupHits=s.matchGroups.map(g=>g.filter(found).map(c=>c.text).slice(0,3));
        const groups=groupHits.filter(x=>x.length);
        const anchored=s.matchAnchors.some(found);
        const eventHits=s.matchEvents.map(event=>{
          const cues=event.cues.filter(found);
          if(!cues.length)return null;
          const positions=cues.map(c=>normLyrics.search(c.re)).filter(x=>x>=0);
          return {id:event.id,label:event.label,evidence:cues[0].text,
            position:positions.length?Math.min(...positions):Number.MAX_SAFE_INTEGER};
        }).filter(Boolean);
        const strongEvents=anchored&&eventHits.length>=3;
        if(!phraseHits.length&&groups.length<2&&!strongEvents)continue;
        const evidence=[...new Set([...phraseHits,...groupHits.flat(),...eventHits.map(x=>x.evidence)])];
        const groupQuality=groups.length>=3?3:groups.length===2?1.5:0;
        // Eventos só ganham peso narrativo se a história tiver uma âncora específica.
        const eventBonus=strongEvents?Math.min(9,2+eventHits.length*1.5):0;
        const score=Math.min(18,phraseHits.length*7.5+groupQuality*3+
          Math.min(3,evidence.length)*0.45+eventBonus);
        let ordered=0,last=-1;
        for(const event of eventHits){
          if(event.position>last&&event.position<Number.MAX_SAFE_INTEGER){
            ordered++;last=event.position;
          }
        }
        const perspectiveHits=s.matchPerspective?.cues.filter(found).length||0;
        const perspective=perspectiveHits>=2?s.matchPerspective.label:null;
        profile.push({id:s.id,label:s.label,score:+score.toFixed(2),
          evidence:evidence.slice(0,8),reference:s.reference,
          kind:strongEvents?'sequência de acontecimentos':phraseHits.length?'expressão específica':'conjunto de evidências',
          events:strongEvents?eventHits.map(({id,label,evidence})=>({id,label,evidence})):[],
          orderedEvents:strongEvents?ordered:0,perspective:strongEvents?perspective:null});
      }
      return profile.sort((a,b)=>b.score-a.score).slice(0,18);
    }
    function interpret(raw,custom={}){
      const q=normalize(raw),matches=[];
      for(const s of stories){
        const aliases=[...s.matchAliases];
        const customWords=Array.isArray(custom[s.id])?custom[s.id].slice(0,20):[];
        for(const alias of customWords){if(typeof alias==='string'&&alias.length>3&&alias.length<=90)aliases.push({text:alias,normalized:normalize(alias),re:matcher(alias)});}
        const matched=aliases.filter(a=>a.re.test(q)).sort((a,b)=>b.normalized.length-a.normalized.length);
        if(matched.length)matches.push({id:s.id,label:s.label,reference:s.reference,alias:matched[0].text,description:s.description,topics:s.topics||[]});
      }
      // Retirar da busca literal apenas o trecho reconhecido como narrativa.
      // Ex.: "Filho Pródigo com gratidão" continua buscando "gratidão" também.
      let cleaned=q;
      for(const m of matches.slice().sort((a,b)=>b.alias.length-a.alias.length))cleaned=cleaned.replace(matcher(m.alias),' ');
      return {matches:matches.slice(0,4),residual:cleaned.replace(/\s+/g,' ').trim()};
    }
    function evaluate(profile,intent){
      const lookup=new Map((profile||[]).map(x=>[x.id,x]));
      let score=0,tier=0,eventCount=0;
      const reasons=[],cues=[],matched=[];
      for(const narrative of intent.matches||[]){
        const p=lookup.get(narrative.id);if(!p)continue;
        const events=Array.isArray(p.events)?p.events:[];
        const narrativeTier=events.length>=4?2:events.length>=3?1:0;
        const sequencePoints=narrativeTier?Math.min(20,(events.length-2)*4+
          (p.orderedEvents>=3?4:0)):0;
        const points=Math.min(39,14+p.score*1.55)+sequencePoints;
        score+=points;
        tier=Math.max(tier,narrativeTier);
        eventCount=Math.max(eventCount,events.length);
        if(narrativeTier){
          const labels=events.slice(0,5).map(x=>x.label).join(' → ');
          reasons.push('Narrativa '+narrative.label+': acontecimentos na letra — '+labels+
            (p.perspective?' (perspectiva: '+p.perspective+')':''));
          cues.push(...events.map(x=>x.evidence));
        }else{
          reasons.push('Narrativa '+narrative.label+': '+p.kind+' na letra (“'+p.evidence.slice(0,3).join('”, “')+'”)');
          cues.push(...p.evidence);
        }
        matched.push(narrative.label);
      }
      return {score:Math.min(75,score),tier,eventCount,reasons:reasons.slice(0,2),
        cues:[...new Set(cues)],matched};
    }
    return {revision:db.revision,stories:stories.length,indexHymn,interpret,evaluate,list:()=>stories.map(s=>({id:s.id,label:s.label,reference:s.reference,description:s.description}))};
  }
  return {create,normalize};
})();
