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
      return {...s,matchAliases:s.aliases.map(a=>({text:a,normalized:normalize(a),re:matcher(a)})),
        matchPhrases:s.phrases.map(x=>({text:x,re:matcher(x)})),
        matchGroups:s.groups.map(group=>group.map(x=>({text:x,re:matcher(x)})))};
    });
    if(new Set(stories.map(s=>s.id)).size!==stories.length)throw Error('Narrativas com IDs duplicados');
    function indexHymn(title,lyrics){
      const normTitle=normalize(title),normLyrics=normalize(lyrics),profile=[];
      for(const s of stories){
        const phraseHits=s.matchPhrases.filter(p=>p.re.test(normTitle)||p.re.test(normLyrics)).map(p=>p.text).slice(0,3);
        const groupHits=s.matchGroups.map(g=>g.filter(c=>c.re.test(normTitle)||c.re.test(normLyrics)).map(c=>c.text).slice(0,3));
        const groups=groupHits.filter(x=>x.length);
        if(!phraseHits.length && groups.length<2)continue;
        // Filho Pródigo exige retorno real ao Pai; "pai" e "perdão" isolados
        // não descrevem a parábola. As três etapas podem estar em estrofes diferentes.
        if(s.id==='filho_prodigo'&&!phraseHits.length&&
          (!groupHits[0]?.length || !groupHits[1]?.length || !groupHits[2]?.length))continue;
        // Com apenas dois sinais independentes, exigir ao menos um sinal contextual específico.
        const evidence=[...new Set([...phraseHits,...groupHits.flat()])];
        const groupQuality=groups.length>=3?3:groups.length===2?1.5:0;
        const score=Math.min(18, phraseHits.length*7.5 + groupQuality*3 + Math.min(3,evidence.length)*0.45);
        profile.push({id:s.id,label:s.label,score:+score.toFixed(2),evidence:evidence.slice(0,6),reference:s.reference,kind:phraseHits.length?'expressão específica':'conjunto de evidências'});
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
      let score=0;const reasons=[],cues=[],matched=[];
      for(const narrative of intent.matches||[]){
        const p=lookup.get(narrative.id);if(!p)continue;
        const points=Math.min(39,14+p.score*1.55);
        score+=points;
        reasons.push('Narrativa '+narrative.label+': '+p.kind+' na letra (“'+p.evidence.slice(0,3).join('”, “')+'”)');
        cues.push(...p.evidence);
        matched.push(narrative.label);
      }
      return {score:Math.min(55,score),reasons:reasons.slice(0,2),cues:[...new Set(cues)],matched};
    }
    return {revision:db.revision,stories:stories.length,indexHymn,interpret,evaluate,list:()=>stories.map(s=>({id:s.id,label:s.label,reference:s.reference,description:s.description}))};
  }
  return {create,normalize};
})();
