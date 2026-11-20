'use strict';
/*
 * Evidência narrativa determinística offline (etapa 4).
 * Extrai ações, atores/contextos locais e sequência dos versos bíblicos e
 * das letras importadas. Não é análise sintática neural nem prova doutrinária.
 * Uma palavra temática isolada não é promovida a descrição da história.
 *
 * Dicionário de AÇÕES genérico da língua portuguesa, compartilhado por
 * TODAS as 48 narrativas. Nenhuma exceção por ID de hino/história/referência.
 */
const EventFrameEngine=(()=>{
  const normalize=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const words=x=>(normalize(x).match(/[a-z]{3,}/g)||[]);
  const STOP=new Set(('a o as os e de da do dos das no na nas nos com para por que quem como quando onde '
    +'num numa um uma uns umas em ate apos antes durante sobre entre desde muito mais menos tao '
    +'era eram foi fui fomos foram ser sera seria sendo tem teve tenho tinham tinha todos todas '
    +'se seu sua seus suas minha meu meus minhas teu tua tuas teus me lhe lhes ele ela eles elas '
    +'eu tu nos vos isso isto aquele aquela assim entao agora depois ainda ja nao nem sem '
    +'jesus cristo senhor deus espirito santo gloria amor amem aleluia reino palavra vida '
    +'disse dizer diz falou falava falavam diziam falou me ti voce nosso vossa deste dessa cada '
    +'coisa coisas homens homem hoje dia dias noite noites todo toda ha havia ha').split(/\s+/));
  // Grupos de verbos/eventos; raízes irregulares incluídas uma vez, não por
  // narrativa. A lista deliberadamente evita sentimentos/temas sem ações.
  const FAMILIES={
    partir:['parti','partiu','partiram','deix','aband','afast','fug','ausent'],
    voltar:['volt','retorn','regress'],
    buscar:['busc','procur','ach','encontr'],
    chamar:['cham','clam','brad','grit'],
    tocar:['toc','apalp'],
    curar:['curad','curou','curar','cura','sarou','sarad','sarar','sar','restaur','cicatriz'],
    morrer:['morr','morre','mort','falec','perec'],
    ressuscitar:['ressusc','ressurg','reviv','ressurrei'],
    levantar:['levant','ergue','ergu','alca','surgiu'],
    perdoar:['perdo','absolv','reconcil'],
    arrepender:['arrepend','confess','lament','humilh'],
    receber:['receb','acolh','abrac','abraç'],
    celebrar:['celebr','festej','alegr','banquet'],
    acalmar:['acalm','aquiet','silenc','apazigu','cessaram','cessou'],
    tempestear:['tempestad','turbilh','agit','revolt','rugiram','rugiu'],
    atravessar:['atravess','transp','cruzar','cruzou'],
    subir:['subi','subiu','subiram','escal','ascend'],
    descer:['desc','baix'],
    cair:['caiu','cair','cairam','tomb','queda'],
    seguir:['segui','segu','acompanh'],
    fugir:['escap','fugiu','evad'],
    caminhar:['caminh','andava','andou','andaram','andarei'],
    navegar:['naveg','remav','remou','embarc'],
    abrir:['abri','abriu','abert','escancar'],
    fechar:['fech','tranc'],
    alimentar:['aliment','comer','comeu','comiam','serviu','repartiu','repart'],
    multiplicar:['multiplic','aument'],
    pedir:['ped','rogou','rog','suplic','implor'],
    dar:['oferec','entreg','doou','deu','dera','deram'],
    negar:['negou','negav','reneg'],
    trair:['traidor','traiu','trair','traic'],
    prender:['prend','aprision','amarr'],
    libertar:['libert','solt','livr','desat'],
    esconder:['escond','ocult','encobr'],
    ver:['olhou','olhav','viu','viram','enxerg','avist'],
    ouvir:['ouvi','escut','atend','ouca'],
    ensinar:['ensin','instrui','instru','orient'],
    mandar:['orden','mandou','mandar','ordenou','enviou','envi'],
    obedecer:['obedec','cumpri','seguiram'],
    trabalhar:['trabalh','colh','seme','plant','constr'],
    combater:['lutou','lutav','combate','batalh','venc','derrot'],
    lavar:['lavou','lavar','banh','purific'],
    orar:['orou','oram','orar','orac','rez','ajoelh'],
    adorar:['ador','louv','bendiss','bendiz'],
    batizar:['batiz','imers'],
    ungir:['ungi','ungiu','ungiram','uncao'],
    esperar:['esper','aguard'],
    dormir:['dorm','adorm','sono'],
    acordar:['acord','despert'],
    reconhecer:['reconhec','identific','perceb'],
    duvidar:['duvid','hesit','desconf'],
    acreditar:['creu','crer','creiam','criam','acredit','confi'],
    escrever:['escrev','escrit','anot'],
    nascer:['nasceu','nasc','renasc'],
    perder:['perdido','perdeu','perder','extravi','perdid'],
    encontrar:['encontr','achou','acharam','localiz'],
    conduzir:['guiou','guiav','conduz','dirig','levou'],
    chorar:['chor','prante','lament'],
    agradecer:['agradec','gratidao','grato','rendeu gracas'],
    julgar:['julg','conden','acus'],
    salvar:['salv','resgat','redim','socorr']
  };
  const ACTIONS=Object.entries(FAMILIES).map(([name,fragments])=>({
    name,fragments:fragments.map(normalize)
  }));
  const ACT_NAMES=new Set(ACTIONS.map(x=>x.name));
  const ACTION_LOOKUP=new Map();
  for(const action of ACTIONS)for(const prefix of action.fragments){
    const key=prefix.slice(0,2);
    if(!ACTION_LOOKUP.has(key))ACTION_LOOKUP.set(key,[]);
    ACTION_LOOKUP.get(key).push({name:action.name,prefix});
  }
  const actionMatches=word=>(ACTION_LOOKUP.get(word.slice(0,2))||[]).filter(a=>word.startsWith(a.prefix));
  const ROLE_WORDS=new Set(('pai filho filha filhos filhas mulher mulheres homem homens menino menina jovem '
    +'irmao irma mae maes crianca criancas cego cegos doente enfermo viuva pastor pastores '
    +'ovelha ovelhas servo servos discipulo discipulos amigo amigos mestre rei reis sacerdote '
    +'pescador pescadores profeta soldados irmaos mae irmao amigo multidao leproso leprosos '
    +'familia povo criados pescadores viajante peregrino soldados marinheiro').split(/\s+/));
  const NEGATE=new Set(['nao','nem','nunca','jamais','sem']);
  const MAX_LINES=5;
  const lineData=x=>{
    const tokens=words(x);
    const actions=new Set();
    for(let i=0;i<tokens.length;i++){
      const w=tokens[i];
      const negated=tokens.slice(Math.max(0,i-3),i).some(x=>NEGATE.has(x));
      if(negated)continue;
      for(const action of actionMatches(w))actions.add(action.name);
    }
    const nouns=new Set();
    for(const token of tokens){
      if(STOP.has(token))continue;
      if(actionMatches(token).length)continue;
      const root=token.replace(/(?:amentos|imentos|idades|adores|adoras|mente|zinho|zinha|coes|cao|amento|imento|ados|adas|idos|idas|ando|endo|indo|oes|ais|eis|eis|os|as|es|s|o|a)$/,'');
      if(root.length>=3)nouns.add(root);
    }
    return {tokens,actions,nouns};
  };
  function extract(lines,limit=256){
    const events=[],trace=[],allNouns=new Set();
    for(let i=0;i<lines.length&&events.length<limit;i++){
      const line=String(lines[i]||'').trim();
      if(!line)continue;
      const result=lineData(line);
      for(const noun of result.nouns)allNouns.add(noun);
      if(!result.actions.size)continue;
      for(const action of result.actions){
        events.push({action,line:i,text:line,nouns:result.nouns});
        if(trace[trace.length-1]!==action)trace.push(action);
      }
    }
    return {events,trace,nouns:allNouns};
  }
  function lyricIndex(lyrics){
    const lines=[];
    let stanza=0;
    for(const raw of String(lyrics||'').replace(/\r/g,'').split('\n')){
      if(!raw.trim()){stanza++;continue;}
      lines.push({text:raw.trim(),stanza});
    }
    const frames=[];
    const list=lines.map(x=>x.text);
    const global=extract(list,180);
    // Janela de até cinco linhas, nunca atravessando estrofes.
    for(let i=0;i<lines.length;i++){
      let end=i+1;
      while(end<lines.length&&end<i+MAX_LINES&&lines[end].stanza===lines[i].stanza)end++;
      const data=extract(lines.slice(i,end).map(x=>x.text),24);
      if(data.events.length)frames.push({start:i,end,actions:new Set(data.trace),
        nouns:data.nouns,text:list.slice(i,end).join(' '),stanza:lines[i].stanza});
    }
    return {trace:global.trace,frames,lines:list};
  }
  function lcs(source,hymn){
    let prev=new Array(hymn.length+1).fill(0);
    for(const action of source){
      const next=new Array(hymn.length+1).fill(0);
      for(let j=0;j<hymn.length;j++)next[j+1]=action===hymn[j]?prev[j]+1:Math.max(prev[j+1],next[j]);
      prev=next;
    }
    return prev[hymn.length];
  }
  function create(db,scripture){
    if(!db||!Array.isArray(db.narratives)||!scripture)throw Error('Narrativas/índice bíblico indisponíveis para eventos.');
    const sourceFrames=[];
    for(const n of db.narratives){
      const p=scripture.lookup(n.reference,64);
      if(!p)continue;
      const verses=p.verses.map(x=>x.text);
      const event=extract(verses);
      const scene=extract([n.label,...n.aliases, ...verses]).nouns;
      sourceFrames.push({id:n.id,label:n.label,reference:n.reference,
        ...event,scene,aliases:new Set(extract([n.label,...n.aliases]).nouns)});
    }
    const episodeDf=new Map();
    const actorDf=new Map();
    for(const source of sourceFrames){
      for(const action of new Set(source.trace))episodeDf.set(action,(episodeDf.get(action)||0)+1);
      for(const noun of source.scene)actorDf.set(noun,(actorDf.get(noun)||0)+1);
    }
    const byLabel=new Map(sourceFrames.map(x=>[normalize(x.label),x]));
    const byId=new Map(sourceFrames.map(x=>[x.id,x]));
    const indexed=new Map();
    function setCorpus(songs){
      indexed.clear();
      for(const h of songs||[])if(Number.isInteger(h.id))
        indexed.set(h.id,lyricIndex(h.lyrics||''));
    }
    function evidence(song,context){
      const source=byLabel.get(normalize(context?.narrative));
      const target=indexed.get(song.id)||lyricIndex(song.lyrics||'');
      if(!source||!source.trace.length||!target.trace.length)
        return {score:0,tier:0,kind:'sem evento',actions:[],actors:[],reason:'',snippet:''};
      const overlap=[...new Set(target.trace)].filter(x=>source.trace.includes(x));
      const distinct=overlap.filter(action=>(episodeDf.get(action)||0)<=Math.max(12,Math.ceil(sourceFrames.length*.42)));
      const sequence=lcs(source.trace.slice(0,40),target.trace.slice(0,35));
      const cues=[...source.scene].filter(noun=>(actorDf.get(noun)||0)<=Math.max(15,Math.floor(sourceFrames.length*.4)));
      const important=new Set(cues);
      const matching=[];
      for(const f of target.frames){
        const localActions=distinct.filter(action=>f.actions.has(action));
        if(!localActions.length)continue;
        const aligned=[...f.nouns].filter(noun=>important.has(noun)).slice(0,5);
        if(!aligned.length&&!localActions.length)continue;
        matching.push({frame:f,actions:localActions,actors:aligned,
          strength:localActions.length*2+aligned.length});
      }
      matching.sort((a,b)=>b.strength-a.strength||a.frame.start-b.frame.start);
      const ordered=sequence>=2;
      const rare=action=>(episodeDf.get(action)||0)<=Math.max(8,Math.floor(sourceFrames.length*.26));
      // Não transformar a coincidência de A em um verso e B em outro
      // (talvez em estrofes distantes) em narrativa direta. As duas ações
      // precisam coexistir numa única janela local E ter cenário verificável.
      // Esta é uma regra universal para todos os episódios, não por título.
      const coherent=matching.find(m=>m.actions.length>=2&&m.actors.length>=1&&
        (m.actions.some(rare)||(m.actions.length>=3&&m.actors.some(a=>source.aliases.has(a)))));
      const best=coherent||matching[0];
      const actors=best?.actors||[];
      const actionCount=distinct.length;
      const narrative=Boolean(coherent)&&ordered;
      const analogy=!narrative&&actionCount>=3&&ordered&&distinct.some(rare);
      let tier=0,score=0,kind='tema relacionado';
      if(narrative){
        const alias=coherent.actors.some(a=>source.aliases.has(a));
        tier=coherent.actions.length>=3&&alias?2:1;
        const actionPoints=Math.min(10,coherent.actions.length*3);
        const scenePoints=alias?4:Math.min(3,coherent.actors.length*1.5);
        const orderPoints=Math.min(3,Math.max(0,sequence-1));
        score=Math.min(17,actionPoints+scenePoints+orderPoints);
        kind='ações e cenário na mesma estrofe';
      }else if(analogy){
        tier=0;
        score=Math.min(5,Math.max(0,actionCount-1)*1.4+Math.min(2,sequence-1));
        kind='sequência análoga de ações, sem personagem confirmado';
      }
      const reason=score>=5?'Acontecimentos da passagem: '+distinct.slice(0,3).join(', ')+
        (actors.length?' · contexto: '+actors.slice(0,3).join(', '):' · perspectiva semelhante'):'';
      return {score,tier,kind,actions:distinct.slice(0,5),actors:actors.slice(0,5),
        reason,snippet:score>=8&&best?best.frame.text.slice(0,480):'',
        sequence,reference:source.reference};
    }
    return {setCorpus,evaluate:evidence,stats:()=>({episodes:sourceFrames.length,assigned:indexed.size,
      actionFamilies:ACT_NAMES.size}),getSource:id=>byId.get(id)||null};
  }
  return {create,extract,lyricIndex,lcs};
})();
