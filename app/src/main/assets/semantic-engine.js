'use strict';
/* Motor semântico lexical-associativo: sem modelos, sem rede, sem conteúdo inventado.
 * Recebe a taxonomia local semantic-db.json e extrai evidências de títulos/letras.
 */
const SemanticEngine = (() => {
  const norm = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\s\u00a0]+/g,' ').trim();
  const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function contains(haystack, phrase) {
    if (!phrase) return false;
    return new RegExp('(?:^|[^a-z0-9])' + escaped(phrase) + '(?=$|[^a-z0-9])').test(haystack);
  }
  function create(database) {
    if (!database || database.schema_version !== 1 || !Array.isArray(database.items)) throw Error('Taxonomia semântica inválida');
    if (database.items.length > 250) throw Error('Taxonomia excede o limite de temas');
    const topics = database.items.map(e => {
      if (!e.id || !e.label || !Array.isArray(e.evidence) || !Array.isArray(e.intent)) throw Error('Registro semântico incompleto');
      return {id:e.id,label:e.label,evidence:e.evidence.map(x=>({raw:x,norm:norm(x)})),intent:e.intent.map(x=>({raw:x,norm:norm(x)})),related:e.related||{},name:norm(e.label)};
    });
    const byId = new Map(topics.map(x=>[x.id,x]));
    if (byId.size !== topics.length) throw Error('IDs de temas duplicados');
    function indexHymn(title,lyrics) {
      const titleNorm=norm(title), lyricNorm=norm(lyrics);
      const profile=[];
      for (const topic of topics) {
        let score=0;const found=[];
        for(const cue of topic.evidence){
          if (!cue.norm) continue;
          const inTitle=contains(titleNorm,cue.norm),inLyric=contains(lyricNorm,cue.norm);
          if (!inTitle && !inLyric) continue;
          const specific=cue.norm.includes(' ')||cue.norm.length>=8;
          score+=(inTitle?1.7:0.95)+(specific?0.25:0);
          if(found.length<4)found.push(cue.raw);
        }
        if(score>=0.95) profile.push({id:topic.id,label:topic.label,score:+Math.min(6,score).toFixed(2),evidence:found});
      }
      profile.sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label,'pt-BR'));
      return profile.slice(0,24);
    }
    function interpret(query) {
      const q=norm(query), direct=[];
      for (const topic of topics) {
        const labelHit=contains(q,topic.name);
        const intentHit=topic.intent.some(x=>x.norm&&contains(q,x.norm));
        const cueHit=topic.evidence.some(x=>x.norm&&contains(q,x.norm));
        if (labelHit || intentHit || cueHit) direct.push({id:topic.id,label:topic.label,why:labelHit?'tema citado':intentHit?'contexto descrito':'conceito citado'});
      }
      const related = new Map();
      for(const source of direct){
        const topic=byId.get(source.id);
        for(const [target,weight] of Object.entries(topic.related)){
          if(!byId.has(target) || direct.some(x=>x.id===target))continue;
          if(!Number.isFinite(weight)||weight<=0||weight>1)continue;
          const value=related.get(target);
          if(!value||weight>value.weight)related.set(target,{id:target,label:byId.get(target).label,source:source.label,weight});
        }
      }
      return {direct:direct.slice(0,8), related:[...related.values()].sort((a,b)=>b.weight-a.weight).slice(0,16)};
    }
    function evaluate(profile, intent) {
      const lookup=new Map((profile||[]).map(x=>[x.id,x]));
      let score=0;const proof=[];const cues=[];
      for(const topic of intent.direct){
        const hit=lookup.get(topic.id); if(!hit)continue;
        const strength=Math.min(1.25,0.65+hit.score*.11);
        score+=9.5*strength;
        cues.push(...hit.evidence);
        proof.push({score:9.5*strength,reason:'Tema '+topic.label.toLowerCase()+' identificado por “'+hit.evidence.slice(0,2).join('”, “')+'”'});
      }
      for(const edge of intent.related){
        const hit=lookup.get(edge.id); if(!hit)continue;
        const strength=Math.min(1.2,0.62+hit.score*.11);
        const points=8.8*edge.weight*strength;
        score+=points;
        cues.push(...hit.evidence);
        proof.push({score:points,reason:'Relação contextual ('+edge.source.toLowerCase()+' → '+edge.label.toLowerCase()+') sustentada por “'+hit.evidence.slice(0,2).join('”, “')+'”'});
      }
      proof.sort((a,b)=>b.score-a.score);
      return {score:Math.min(score,32),proof:proof.slice(0,3).map(p=>p.reason),cues:[...new Set(cues)].slice(0,12)};
    }
    function excluded(profile,phrases) {
      for(const item of phrases){
        const q=norm(item);if(!q)continue;
        // Exclusion only affects literal matches or direct concept matches;
        // do not exclude all adjacent/related theological concepts.
        const direct=interpret(item).direct.map(t=>t.id);
        if(profile.some(p=>direct.includes(p.id)))return true;
      }
      return false;
    }
    return {revision:database.revision,indexHymn,interpret,evaluate,excluded,topics:topics.length};
  }
  return {create,normalize:norm,contains};
})();
