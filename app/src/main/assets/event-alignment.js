'use strict';
/* Janela de quatro versos: sinais de papéis e ações na mesma cena. */
const EventAlignment=(()=>{
  const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const esc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=term=>new RegExp('(?:^|[^a-z0-9])'+esc(norm(term)).replace(/\s+/g,'\\s+')+'(?=$|[^a-z0-9])');
  const GENERIC=new Set('deus jesus cristo senhor salvador amor paz fe graca gloria aleluia'.split(' '));
  function windows(lyrics){
    const out=[];
    for(const stanza of String(lyrics||'').split(/\n\s*\n/)){
      const lines=stanza.split(/\r?\n/).map(norm).filter(Boolean);
      for(let i=0;i<lines.length;i++)out.push({text:lines.slice(i,i+4).join(' '),start:i});
    }
    return out;
  }
  function analyze(story,lyrics){
    if(!story||!Array.isArray(story.groups)||story.groups.length<2)
      return {score:0,tier:0,cues:[],coverage:0,independent:0};
    const groups=story.groups.map(group=>(Array.isArray(group)?group:[]).slice(0,40)
      .filter(x=>typeof x==='string'&&x.length>=3).map(x=>({term:x,re:match(x)})));
    let best={score:0,tier:0,cues:[],coverage:0,independent:0};
    for(const win of windows(lyrics)){
      const matches=groups.map(g=>g.filter(x=>x.re.test(win.text))
        .sort((a,b)=>b.term.length-a.term.length)[0]).filter(Boolean);
      const coverage=matches.length;
      if(coverage<2)continue;
      const independent=matches.filter(x=>!GENERIC.has(norm(x.term))&&norm(x.term).length>=5).length;
      const tier=coverage>=3&&independent>=2?3:coverage>=2&&independent>=2?2:1;
      const score=Math.min(15,(coverage-1)*3.8+independent*1.1+(tier===3?3.5:tier===2?1.5:0));
      if(score>best.score)best={score:+score.toFixed(2),tier,cues:matches.map(x=>x.term).slice(0,5),coverage,independent};
    }
    return best;
  }
  return {analyze,windows};
})();
