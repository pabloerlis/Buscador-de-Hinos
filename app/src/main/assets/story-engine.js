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
  // Flexões portuguesas frequentes. Não altera aliases nem a pesquisa literal;
  // só amplia sinais narrativos de uma palavra, para TODAS as histórias.
  const ENDINGS=['aremos','eremos','iremos','ariam','eriam','iriam','ando','endo','indo',
    'ados','adas','idos','idas','aram','eram','iram','arei','erei','irei',
    'asse','esse','isse','ava','avam','ado','ada','ido','ida',
    'ou','eu','iu','ei','am','em','ar','er','ir','os','as','es','o','a','e','i','s'];
  const FLEX_SUFFIX='(?:'+ENDINGS.join('|')+')?';
  function flexMatcher(term){
    const word=normalize(term);
    if(!/^[a-z]{5,}$/.test(word))return matcher(term);
    const suffix=ENDINGS.find(x=>word.endsWith(x)&&word.length-x.length>=4);
    if(!suffix)return matcher(term);
    const stem=word.slice(0,-suffix.length);
    return new RegExp('(?:^|[^a-z0-9])'+escapeRe(stem)+FLEX_SUFFIX+'(?=$|[^a-z0-9])');
  }
  function create(db){
    if(!db||db.schema_version!==1||!Array.isArray(db.stories)||db.stories.length>80)throw Error('Índice de narrativas inválido');
    const stories=db.stories.map(s=>{
      if(!s.id||!s.label||!Array.isArray(s.aliases)||!Array.isArray(s.phrases)||!Array.isArray(s.groups)||s.groups.length<2)throw Error('Narrativa sem estrutura suficiente');
      return {...s,matchAliases:[...new Set([s.label,...s.aliases])].map(a=>({text:a,normalized:normalize(a),re:matcher(a)})),
        matchPhrases:s.phrases.map(x=>({text:x,re:matcher(x)})),
        matchGroups:s.groups.map(group=>group.map(x=>({text:x,re:flexMatcher(x)})))};
    });
    if(new Set(stories.map(s=>s.id)).size!==stories.length)throw Error('Narrativas com IDs duplicados');
    // Trechos limitados a quatro versos, sem atravessar estrofes.
    // O mesmo mecanismo se aplica a todas as narrativas do catálogo.
    function lyricWindows(lyrics){
      const result=[];
      for(const stanza of String(lyrics||'').split(/\n\s*\n/)){
        const lines=stanza.split(/\r?\n/).map(normalize).filter(Boolean);
        for(let i=0;i<lines.length;i++)result.push(lines.slice(i,i+4).join(' '));
      }
      return result;
    }
    function indexHymn(title,lyrics){
      const normTitle=normalize(title),normLyrics=normalize(lyrics),profile=[];
      const windows=lyricWindows(lyrics);
      for(const s of stories){
        const phraseHits=s.matchPhrases.filter(p=>p.re.test(normTitle)||p.re.test(normLyrics)).map(p=>p.text).slice(0,3);
        const groupHits=s.matchGroups.map(g=>g.filter(c=>c.re.test(normTitle)||c.re.test(normLyrics)).map(c=>c.text).slice(0,3));
        const groups=groupHits.filter(x=>x.length);
        if(!phraseHits.length&&groups.length<2)continue;
        // A evidência de um trecho é medida por grupos DISTINTOS, não pela
        // repetição de palavras de um mesmo grupo ou por temas genéricos.
        let localCoverage=0,localCues=[];
        for(const passage of windows){
          const matches=s.matchGroups.map(g=>g.find(c=>c.re.test(passage))).filter(Boolean);
          if(matches.length>localCoverage){
            localCoverage=matches.length;
            localCues=matches.map(x=>x.text);
            if(localCoverage===s.matchGroups.length)break;
          }
        }
        const strongPhrase=phraseHits.some(phrase=>normalize(phrase).split(' ').length>=2);
        // Vários conceitos no mesmo verso não demonstram uma história.
        // Ações verbais reforçam a evidência em todas as narrativas sem
        // proibir a recuperação de textos sem conjugação no passado.
        const actionCoverage=new Set((normLyrics.match(/\b[a-z]{4,}(?:ei|ou|iu|amos|aram|eram|iram)\b/g)||[])).size;
        const tier=((localCoverage>=3&&actionCoverage>=2)||
          (strongPhrase&&localCoverage>=2))?2:
          (groups.length>=3&&localCoverage>=2)||(strongPhrase&&groups.length>=2)?1:0;
        const event=typeof EventAlignment!=='undefined'?EventAlignment.analyze(s,lyrics):null;
        const evidence=[...new Set([...phraseHits,...(event?.cues||[]),...localCues,...groups.flat()])];
        const score=Math.min(18,phraseHits.length*7.5+
          (groups.length>=3?7:groups.length===2?3:0)+
          (localCoverage>=3?5:localCoverage===2?2:0)+Math.min(3,evidence.length)*0.45);
        const eventTier=event?.tier===3?3:tier;
        const eventScore=Math.min(24,score+Math.min(6,(event?.score||0)*.4));
        profile.push({id:s.id,label:s.label,score:+eventScore.toFixed(2),
          evidence:evidence.slice(0,6),reference:s.reference,
          kind:eventTier===3?'papéis e ações da narrativa no mesmo trecho':
            tier===2?'evidências independentes no mesmo trecho':
            tier===1?'evidências narrativas combinadas':
              phraseHits.length?'expressão específica':'conjunto de evidências',
          tier:eventTier,localCoverage,eventEvidence:event?.cues||[],eventCoverage:event?.coverage||0});
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
      let score=0,tier=0;
      const reasons=[],cues=[],matched=[];
      for(const narrative of intent.matches||[]){
        const p=lookup.get(narrative.id);if(!p)continue;
        const strength=Math.max(0,Math.min(3,Number(p.tier)||0));
        const points=Math.min(39,14+p.score*1.55)+(strength===3?13:strength===2?10:strength===1?4:0);
        score+=points;tier=Math.max(tier,strength);
        reasons.push('Narrativa '+narrative.label+': '+p.kind+' na letra (“'+
          p.evidence.slice(0,3).join('”, “')+'”)');
        cues.push(...p.evidence);
        matched.push(narrative.label);
      }
      return {score:Math.min(65,score),tier,reasons:reasons.slice(0,2),
        cues:[...new Set(cues)],matched};
    }
    return {revision:db.revision,stories:stories.length,indexHymn,interpret,evaluate,list:()=>stories.map(s=>({id:s.id,label:s.label,reference:s.reference,description:s.description}))};
  }
  return {create,normalize};
})();
