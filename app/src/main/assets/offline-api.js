'use strict';
/* Interface local compatível com os endpoints usados pela versão web.
 * Nenhum servidor Python, chave de API ou rede é necessário após a importação.
 */
const OfflineAPI = (() => {
  const SOURCE = 'https://raw.githubusercontent.com/italozaina/projection-html5-icm/master/data/data.json';
  const THEME_WORDS = {
    'Alegria':['alegria','alegre','jubilo','regozijo','felicidade','celebracao','festa','contente','exultacao'],
    'Gratidão':['gratidao','agradecer','agradecimento','grato','graca recebida','dar gracas','bendizer','louvor','obrigado','acao de gracas'],
    'Confiança':['confianca','confiar','confio','descansar','amparo','seguranca','sustento','dependencia','refugio','socorro'],
    'Consolo':['consolo','consolar','aflicao','tristeza','dor','sofrimento','tribulacao','angustia','dificuldades','momentos dificeis','luto','lagrimas'],
    'Esperança':['esperanca','esperar','promessa','futuro','perseverar','renovo','renovacao','certeza'],
    'Salvação':['salvacao','salvar','salvo','redencao','resgate','perdao','pecador','justificacao','vida eterna'],
    'Arrependimento':['arrependimento','arrepender','confissao','pecado','perdao','quebrantamento','humildade'],
    'Fé':['fe','crer','creio','crenca','fidelidade','perseveranca','duvida'],
    'Oração':['oracao','orar','suplicar','clamar','intercessao','joelhos','clamor','pedir'],
    'Adoração':['adoracao','adorar','exaltar','glorificar','santidade','louvar','aleluia','gloria'],
    'Volta de Jesus':['volta de jesus','segunda vinda','arrebatamento','maranata','jesus voltara','vigilancia','vigiar','noivo','igreja preparada','preparacao','breve vira'],
    'Espírito Santo':['espirito santo','consolador','pentecostes','uncao','poder do alto','batismo com espirito','espirito de deus'],
    'Comunhão':['comunhao','unidade','irmandade','corpo de cristo','amor fraternal','familia da fe'],
    'Evangelização':['evangelizacao','evangelho','missao','missoes','anunciar','testemunhar','pregar','ide'],
    'Ceia':['ceia','santa ceia','pao','calice','corpo e sangue','memorial'],
    'Batismo':['batismo','batizar','aguas','nova vida','renascer'],
    'Proteção':['protecao','proteger','guarda','abrigo','escudo','livramento','fortaleza'],
    'Paz':['paz','tranquilidade','descanso','quietude','serenidade','ansiedade','medo','temor'],
    'Ressurreição':['ressurreicao','ressurgiu','ressuscitou','vivo esta','vitoria sobre a morte'],
    'Santificação':['santificacao','santidade','consagracao','pureza','separacao','vida santa'],
    'Amor':['amor','caridade','misericordia','compaixao','bondade']
  };
  const STOP = new Set('a o os as de da do das dos e em para por que com um uma uns umas na no nas nos ao aos ou se eu tu ele ela nos vos eles elas meu minha seu sua seus suas sobre hino hinos louvor louvores letra letras tema temas cancoes cancao musica musicas precisa quero procure buscar busque encontre encontrar mostre me quais qual ser esta estao seja sao mais entre deus senhor jesus cristo igreja culto momento momentos falar falam fale tratar tratam coisas'.split(' '));
  const REFERENCE = /\b(?:Gn|Ex|Sl|Salmo|Is|Mt|Mc|Lc|Jo|At|Rm|Ef|Fp|Ap|Hebreus|Romanos|Jo[aã]o|Mateus|Lucas|Apocalipse|Isa[ií]as|Salmos)\.?\s*\d{1,3}\s*:\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?/gi;
  const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g,' ').trim().toLowerCase();
  const reEscape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (haystack,needle) => new RegExp('(?:^|[^a-z0-9])'+reEscape(needle)+'(?=$|[^a-z0-9])').test(haystack);
  const themes = text => {const s=normalize(text);return Object.entries(THEME_WORDS).filter(([,words]) => words.some(word=>hasWord(s, word))).map(([name])=>name);};
  const tokens = q => [...new Set((normalize(q).match(/[a-z0-9]+/g)||[]).filter(t=>t.length>=2&&!STOP.has(t)))].slice(0,18);
  const yieldThread = () => new Promise(resolve=>setTimeout(resolve,0));
  let hymns=[];
  let metadata={collection:'',edition:'',hymn_count:0};
  let initialized;
  let semantic=null;
  let narratives=null;
  let recommender=null;
  let scriptureIndex=null;
  let bridge=null;
  let queryRankingCache=new Map();
  const DEFAULT_SEARCH={mode:'balanced',strength:75,narratives:true,related:true,minAffinity:0,pageSize:5,showReasons:true,showConcepts:true,scripture:true,bridge:true,customAliases:{},recWeight:65,recCount:5,recContext:true,recAvoidVisited:true,recBreakdown:true};
  function searchOptions(raw){
    const p=raw&&typeof raw==='object'?raw:{};
    const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
    const aliases={};
    if(p.customAliases&&typeof p.customAliases==='object'){
      for(const [id,terms] of Object.entries(p.customAliases).slice(0,50)){
        if(!/^[a-z0-9_]{2,45}$/.test(id)||!Array.isArray(terms))continue;
        aliases[id]=[...new Set(terms.filter(t=>typeof t==='string'&&t.length>3&&t.length<=90).slice(0,15))];
      }
    }
    return {mode:['balanced','literal','context'].includes(p.mode)?p.mode:DEFAULT_SEARCH.mode,
      strength:clamp(p.strength,0,100,75),narratives:p.narratives!==false,
      related:p.related!==false,minAffinity:clamp(p.minAffinity,0,90,0),
      pageSize:[5,10].includes(Number(p.pageSize))?Number(p.pageSize):5,
      showReasons:p.showReasons!==false,showConcepts:p.showConcepts!==false,scripture:p.scripture!==false,bridge:p.bridge!==false,customAliases:aliases,
      recWeight:clamp(p.recWeight,0,100,65),recCount:[5,10].includes(Number(p.recCount))?Number(p.recCount):5,
      recContext:p.recContext!==false,recAvoidVisited:p.recAvoidVisited!==false,recBreakdown:p.recBreakdown!==false};
  }
  // Índices residentes em memória: calculados uma vez na importação/abertura.
  // A IA jamais percorre hinos nem altera a coletânea: apenas produz termos de consulta.
  let numberIndex=new Map(),wordIndex=new Map(),topicIndex=new Map(),storyIndex=new Map(),wordSets=new Map();
  function rebuildIndexes(){
    numberIndex=new Map();wordIndex=new Map();topicIndex=new Map();storyIndex=new Map();wordSets=new Map();
    for(const song of hymns){
      if(song.number)numberIndex.set(Number(song.number),song);
      const words=new Set((song.searchable.match(/[a-z0-9]+/g)||[]));
      wordSets.set(song.id,words);
      for(const word of words){
        if(word.length<2)continue;
        if(!wordIndex.has(word))wordIndex.set(word,new Set());
        wordIndex.get(word).add(song.id);
      }
      for(const item of (song.semantic_profile||[])){
        if(!topicIndex.has(item.id))topicIndex.set(item.id,new Set());
        topicIndex.get(item.id).add(song.id);
      }
      for(const item of (song.story_profile||[])){
        if(!storyIndex.has(item.id))storyIndex.set(item.id,new Set());
        storyIndex.get(item.id).add(song.id);
      }
    }
    recommender=typeof RecommendationEngine!=='undefined'?RecommendationEngine.create(hymns):null;
    queryRankingCache.clear();
  }
  function candidateSongs(numberMatch,queryTokens,intent,storyIntent){
    if(numberMatch){const match=numberIndex.get(Number(numberMatch[1]));return match?[match]:[];}
    const ids=new Set();
    for(const word of queryTokens)for(const id of (wordIndex.get(word)||[]))ids.add(id);
    if(intent)for(const topic of [...intent.direct,...intent.related])for(const id of (topicIndex.get(topic.id)||[]))ids.add(id);
    if(storyIntent)for(const match of storyIntent.matches)for(const id of (storyIndex.get(match.id)||[]))ids.add(id);
    // Consulta literal ou parcialmente flexionada: reavaliar todos quando a indexação não encontrar nada.
    if(!ids.size)return hymns;
    // Uma frase exata pode existir mesmo quando palavras curtas forem descartadas como stopwords.
    return hymns.filter(h=>ids.has(h.id));
  }
  const semanticLabels=()=>semantic?semantic.labels():Object.keys(THEME_WORDS);
  function validateHints(hints){
    const allowed=new Map(semanticLabels().map(label=>[normalize(label),label]));
    return [...new Set((Array.isArray(hints)?hints:[]).map(h=>allowed.get(normalize(h))).filter(Boolean))].slice(0,4);
  }
  async function loadSemantic(){
    if(typeof SemanticEngine!=='undefined')try{
      const response=await fetch('semantic-db.json');
      if(!response.ok)throw Error('Base semântica indisponível');
      semantic=SemanticEngine.create(await response.json());
    }catch(error){console.warn('Base semântica de temas indisponível:',error.message);}
    if(typeof StoryEngine!=='undefined')try{
      const response=await fetch('semantic-stories.json');
      if(!response.ok)throw Error('Base narrativa indisponível');
      narratives=StoryEngine.create(await response.json());
    }catch(error){console.warn('Base narrativa indisponível:',error.message);}
    if(typeof BridgeEngine!=='undefined'&&semantic)try{
      const response=await fetch('semantic-bridge.json');
      if(!response.ok)throw Error('Dicionário ampliado indisponível');
      bridge=BridgeEngine.create(await response.json(),semantic.catalog());
    }catch(error){console.warn('Dicionário ampliado indisponível:',error.message);}
    if(typeof ScriptureIndex!=='undefined')try{
      const response=await fetch('scripture-pt.json');
      if(!response.ok)throw Error('Texto bíblico offline indisponível');
      scriptureIndex=ScriptureIndex.create(await response.json());
    }catch(error){console.warn('Texto bíblico offline indisponível:',error.message);}
  }

  function plainText(content) {
    let html = String(content??'').replace(/\\n/g,'\n');
    html=html.replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|section|h[1-6])\s*>/gi,'\n');
    const template=document.createElement('template'); template.innerHTML=html;
    return (template.content.textContent||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[ \t]+$/gm,'').replace(/\n{4,}/g,'\n\n\n').trim();
  }
  function parseTitle(raw) {
    let title=plainText(raw).replace(/\n/g,' ').trim();
    let match=title.match(/^\s*(?:(?:hino|louvor)\s+)?(\d{1,4})\s*(?:[-–—.:)]\s*|\s+)(.+)$/i);
    if (match) return {number:match[1].padStart(3,'0'),title:match[2].trim()};
    match=title.match(/^\s*(?:hino\s*)?(\d{1,4})\s*$/i);
    return {number:match?match[1].padStart(3,'0'):null,title};
  }
  function chooseCollection(data){
    const groups=Array.isArray(data)?data:Array.isArray(data?.collections)?data.collections:Array.isArray(data?.coletaneas)?data.coletaneas:Array.isArray(data?.data)?data.data:[data];
    const collections=groups.filter(g=>g&&Array.isArray(g.songs));
    if (!collections.length && Array.isArray(groups)&&groups.some(g=>g&&typeof g.content==='string'))return {name:'Coletânea importada',songs:groups};
    if (!collections.length)throw Error('Nenhuma coleção com campo "songs" foi encontrada neste JSON.');
    collections.sort((a,b)=>{ const weight=g=>normalize(g.name).includes('coletanea 2018')?0:normalize(g.name).includes('coletanea')?1:2;return weight(a)-weight(b); });
    return collections[0];
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(Error('Armazenamento local indisponível neste aparelho.'));
      const request=indexedDB.open('buscador-hinos-android',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('cache'))request.result.createObjectStore('cache');};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  async function readCache(){
    const db=await openDb();try{
      return await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly');const rq=tx.objectStore('cache').get('hymns');rq.onsuccess=()=>resolve(rq.result||null);rq.onerror=()=>reject(rq.error);});
    }finally{db.close();}
  }
  async function writeCache(value){
    const db=await openDb();try{
      await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(value,'hymns');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    }finally{db.close();}
  }
  async function init(){
    if (!initialized)initialized=(async()=>{await loadSemantic();const cache=await readCache();if(cache&&Array.isArray(cache.hymns)){hymns=cache.hymns;metadata=cache.metadata;if((semantic&&cache.semantic_revision!==semantic.revision)||(narratives&&cache.story_revision!==narratives.revision)){
      for(let i=0;i<hymns.length;i++){
        const song=hymns[i];if(semantic){song.semantic_profile=semantic.indexHymn(song.title,song.lyrics);song.topics=song.semantic_profile.slice(0,12).map(t=>t.label);}
        if(narratives) song.story_profile=narratives.indexHymn(song.title,song.lyrics);
        if(i&&i%100===0)await yieldThread();
      }
      await writeCache({hymns,metadata,semantic_revision:semantic?.revision||null,story_revision:narratives?.revision||null});
    }rebuildIndexes();} })().catch(e=>{initialized=null;throw e;});
    return initialized;
  }
  async function importJson(data){
    const group=chooseCollection(data);
    const collection=String(group.name||'Coletânea importada');
    const match=collection.match(/20\d{2}/);
    const edition=match?match[0]:'não informada';
    const next=[];
    for(let i=0;i<group.songs.length;i++){
      const song=group.songs[i];if(!song||typeof song!=='object')continue;
      const originalTitle=String(song.title||song.titulo||'');
      const content=String(song.content||song.letra||'');
      const parsed=parseTitle(originalTitle),lyrics=plainText(content);
      if(!parsed.title||!lyrics)continue;
      let number=(song.number??song.numero); number=number!==undefined&&number!==null&&/^\d+$/.test(String(number))?String(number).padStart(3,'0'):parsed.number;
      const searchable=normalize(parsed.title+' '+lyrics), titleNorm=normalize(parsed.title);
      const semantic_profile=semantic?semantic.indexHymn(parsed.title,lyrics):[];
      const topics=semantic?semantic_profile.slice(0,12).map(t=>t.label):themes(parsed.title+' '+lyrics);
      const story_profile=narratives?narratives.indexHymn(parsed.title,lyrics):[];
      next.push({id:next.length+1,number,title:parsed.title,lyrics,collection,edition,searchable,titleNorm,topics,semantic_profile,story_profile});
      if(i&&i%100===0)await yieldThread();
    }
    if(!next.length)throw Error('Nenhum hino válido neste JSON.');
    const newMeta={collection,edition,hymn_count:next.length};
    await writeCache({hymns:next,metadata:newMeta,semantic_revision:semantic?.revision||null,story_revision:narratives?.revision||null});
    hymns=next;metadata=newMeta;rebuildIndexes();
    return {ok:true,collection,edition,count:hymns.length};
  }
  function makeSnippet(song,qTokens,selectedTopics,semanticCues=[]){
    const lines=song.lyrics.split(/\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    if(!lines.length)return '';
    const clues=qTokens.concat(semanticCues.map(normalize),selectedTopics.flatMap(t=>THEME_WORDS[t]||[]).filter(w=>w.length>=4));
    const weight=line=>{const norm=normalize(line);return clues.reduce((sum,w)=>sum+(norm.includes(w)?(qTokens.includes(w)?3:1):0),0);};
    const best=lines.reduce((prev,next)=>weight(next)>weight(prev)?next:prev,lines[0]);
    return best.length>210?best.slice(0,210)+'…':best;
  }
  function contextQuery(query,previous){
    const fresh=/\b(nova busca|recomecar|do zero|esqueca anterior)\b/i.test(normalize(query));
    const excluded=[];
    const pattern=/\b(?:sem|exclua|evite|nao quero)\s+(?:os?\s+|as?\s+|de\s+)?([\wÀ-ÿ-]+(?:\s+[\wÀ-ÿ-]+){0,2})/gi;
    let text=query.replace(pattern,(_,phrase)=>{excluded.push(phrase.trim().replace(/[.,!?]+$/,''));return ' ';}).trim();
    const old=String(previous||'').slice(0,350).trim();
    if(!fresh&&old&&(text.length<140||/\b(apenas|somente|mais|menos|agora|desses|destes|tambem|priorize|foco|enfatiz)/i.test(normalize(text))))text=old+'. '+text;
    return {query:text.trim().slice(0,600),excluded:excluded.slice(0,4)};
  }
  // Conversão VISUAL heurística não calibrada: NÃO é probabilidade nem confiança estatística.
  function percentage(score, exactNumber=false){
    if(exactNumber)return 100;
    return Math.max(20, Math.min(98, Math.round(30 + 68*(1-Math.exp(-score/22)))));
  }
  function search(payload){
    let query=String(payload?.query||'').trim();if(!query||query.length>500)throw Error('Digite uma consulta de até 500 caracteres.');
    const opts=searchOptions(payload?.settings);
    const page=Math.max(1,Math.min(100,Number(payload.page)||1));
    const inherited=(Array.isArray(payload?.exclude)?payload.exclude:[]).filter(x=>typeof x==='string'&&x.length<=80).slice(0,4);
    const fresh=/\b(nova busca|recomecar|do zero|esqueca anterior)\b/i.test(normalize(query));
    const ctx=payload?.refine?contextQuery(query,payload.previous):{query,excluded:inherited};
    query=ctx.query;
    const excluded=payload?.refine? [...new Set([...(fresh?[]:inherited),...ctx.excluded])].slice(0,4):ctx.excluded;
    if(!query)return {results:[],page,total:0,has_more:false,effective_query:query,excluded,used_ai:false,summary:'Nenhum critério positivo informado.'};
    const norm=normalize(query), numberMatch=norm.match(/^(?:hino\s*|louvor\s*)?(\d{1,4})$/);
    const bible=typeof BibleContext!=='undefined'?BibleContext.lookup(query):null;
    const scripture=opts.scripture&&scriptureIndex?scriptureIndex.lookup(query):null;
    const isBiblicalRef=typeof BibleContext!=='undefined' && BibleContext.looksLikeReference(query);
    const hints=validateHints(payload?.semantic_hints);
    const analysisQuery=numberMatch?query:[query,bible?.theme||'',...hints].filter(Boolean).join(' ');
    const storyIntent=opts.mode!=='literal'&&opts.narratives&&narratives&&!numberMatch?narratives.interpret(query,opts.customAliases):null;
    // Subtrair o alias reconhecido: a palavra genérica "filho" não vira evidência de Filho Pródigo.
    const lexicalQuery=storyIntent?.matches?.length?storyIntent.residual:[query].join(' ');
    const analysisText=[scripture?.residual??lexicalQuery,bible?.theme||'',...hints].filter(Boolean).join(' ');
    const bridgeIntent=opts.bridge&&bridge&&opts.mode!=='literal'?bridge.interpret(analysisText):null;
    const intent=semantic&&opts.mode!=='literal'?semantic.interpret(analysisText):null;
    const scriptureTopics=scripture&&semantic&&opts.mode!=='literal'?
      semantic.indexHymn('',scripture.text).filter(t=>t.score>=1.20).slice(0,4):[];
    if(intent){
      const seen=new Set(intent.direct.map(t=>t.id));
      for(const topic of [...(bridgeIntent?.topics||[]),...scriptureTopics]){
        if(!seen.has(topic.id)){
          intent.direct.push({id:topic.id,label:topic.label,why:topic.why||'evidência do texto bíblico'});
          seen.add(topic.id);
        }
      }
      intent.direct=intent.direct.slice(0,9);
    }
    const selectedTopics=intent?intent.direct.map(t=>t.label):opts.mode==='literal'?[]:themes(analysisText),qTokens=tokens(analysisText);
    const semanticWeight=opts.mode==='literal'?0:(opts.strength/75)*(opts.mode==='context'?1.3:1);
    const excludedNorm=excluded.map(normalize);
    const ranked=[];
    for(const song of candidateSongs(numberMatch,qTokens,intent,storyIntent)){
      let score=0;const evidence=[];let semanticResult=null,storyResult=null;
      if(numberMatch){
        if(!song.number||Number(song.number)!==Number(numberMatch[1]))continue;
        score=100;evidence.push('número exato');
      }else{
        const lexicalWeight=opts.mode==='context'?0.7:1;
        // Não premiar um título por conter apenas parte de uma narrativa reconhecida.
        const exactPhrase=scripture?(scripture.residual||''):storyIntent?.matches?.length?lexicalQuery:norm;
        if(exactPhrase.length>3 && song.titleNorm.includes(exactPhrase)){score+=18*lexicalWeight;evidence.push('título relacionado à pesquisa');}
        else if(exactPhrase.length>5&&song.searchable.includes(exactPhrase)){score+=14*lexicalWeight;evidence.push('trecho diretamente relacionado à pesquisa');}
        const titleWords=song.titleNorm.split(' ');
        for(const token of (scripture?qTokens.filter(t=>!/^\d+$/.test(t)):qTokens)){
          if(titleWords.includes(token))score+=5.2*lexicalWeight;
          if(hasWord(song.searchable,token))score+=2.3*lexicalWeight;
          else if(token.length>=5&&song.searchable.includes(token.slice(0,5)))score+=0.6*lexicalWeight;
        }
        if (semantic && intent){
          semanticResult=semantic.evaluate(song.semantic_profile||[],opts.related?intent:{direct:intent.direct,related:[]});
          score+=semanticResult.score*semanticWeight;
          if(semanticResult.proof.length)evidence.push(...semanticResult.proof.slice(0,2));
        }else{
          const matching=selectedTopics.filter(t=>song.topics.includes(t));
          score+=matching.length*6.5*semanticWeight;
          if(matching.length)evidence.push('tema: '+matching.slice(0,2).join(', ').toLowerCase());
          for(const t of selectedTopics){
            const synonyms=(THEME_WORDS[t]||[]).filter(w=>!qTokens.includes(w)&&w.length>=4);
            const count=synonyms.reduce((n,w)=>n+(hasWord(song.searchable,w)?1:0),0);
            score+=Math.min(3.5,count*.65)*semanticWeight;
          }
        }
        if(storyIntent?.matches.length){
          storyResult=narratives.evaluate(song.story_profile||[],storyIntent);
          score+=storyResult.score*semanticWeight;
          if(storyResult.reasons.length)evidence.unshift(...storyResult.reasons);
        }
      }
      if(excludedNorm.some(t=>t&&(hasWord(song.searchable,t)||song.topics.some(topic=>normalize(topic)===t))))continue;
      if(semantic&&semantic.excluded(song.semantic_profile||[],excluded))continue;
      if(score<(semanticResult?.score>0||storyResult?.score>0?4.7:7))continue;
      const matchedTokens=qTokens.filter(x=>song.searchable.includes(x));
      const reason=numberMatch?'Número exato do hino.':evidence.length?evidence.slice(0,2).join('. ')+'.':matchedTokens.length?'A letra contém termos relacionados: '+matchedTokens.slice(0,3).join(', ')+'.':'Possível relação temática; confira a letra antes de utilizar.';
      const percent=percentage(score,!!numberMatch);
      if(percent<opts.minAffinity)continue;
      const explanations=[...(storyResult?.reasons||[]),...(semanticResult?.proof||[])].slice(0,3);
      ranked.push({id:song.id,number:song.number,title:song.title,collection:song.collection,edition:song.edition,
        topics:[...new Set([...(storyResult?.matched||[]),...song.topics])].slice(0,7),
        snippet:makeSnippet(song,qTokens,selectedTopics,[...(storyResult?.cues||[]),...(semanticResult?.cues||[])]),
        reason:opts.showReasons?reason:'',explanations:opts.showReasons?explanations:[],
        relevance_score:Math.round(score*100)/100,relevance_percent:percent,
        match_type:numberMatch?'numero':storyResult?.score>0?'narrativa':'contexto',
        relevance:score>=17?'Muito relevante':score>=10?'Relevante':'Relacionado'});
    }
    ranked.sort((a,b)=>b.relevance_score-a.relevance_score||(a.number||'9999').localeCompare(b.number||'9999')||a.id-b.id);
    const from=(page-1)*opts.pageSize;
    const reading=storyIntent?.matches?.map(x=>x.label+' ('+x.reference+')')||[];
    const interpretation=opts.showConcepts?[
      ...reading.map(t=>'Narrativa: '+t),
      ...selectedTopics.slice(0,6).map(t=>'Tema: '+t),
      ...(scripture?['Bíblia Livre offline: '+scripture.reference+(scripture.partial?' (amostra do capítulo)':'')]:[]),
      ...(bridgeIntent?.aliases||[]).map(t=>'Associação lexical: '+t),
      ...(storyIntent?.matches.length&&storyIntent.residual&&tokens(storyIntent.residual).length?['Outros termos: '+tokens(storyIntent.residual).join(', ')]:[])
    ]:[];
    return {page,page_size:opts.pageSize,total:ranked.length,has_more:from+opts.pageSize<ranked.length,
      results:ranked.slice(from,from+opts.pageSize),topics:selectedTopics,story_matches:reading,
      interpretation,effective_query:query,excluded,used_ai:hints.length>0,applied_hints:hints,
      _fullRanked:payload?._forRecommendations===true?ranked:undefined,
      summary:scripture?'Texto da Bíblia Livre consultado offline: '+scripture.reference+'.':bible?'Referência '+bible.reference+': '+bible.theme+'.':isBiblicalRef&&!storyIntent?.matches.length?'Referência bíblica não mapeada localmente; cole o texto do versículo para buscar por seu significado.':'',
      bible_reference:scripture?.reference||bible?.reference||null,bible_verses:scripture?.verses?.length||0,scripture_source:scripture?.source||null};
  }
  function queryRanking(query,opts){
    if(!query||!query.trim()||/^(?:hino\s*)?\d{1,4}$/i.test(query.trim()))return new Map();
    const key=JSON.stringify([query,opts.mode,opts.strength,opts.narratives,opts.related,opts.customAliases]);
    if(queryRankingCache.has(key))return queryRankingCache.get(key);
    const ranked=search({query,page:1,settings:{...opts,minAffinity:0},_forRecommendations:true});
    const scores=new Map(ranked._fullRanked.map(x=>[x.id,x.relevance_percent]));
    if(queryRankingCache.size>=12)queryRankingCache.delete(queryRankingCache.keys().next().value);
    queryRankingCache.set(key,scores);return scores;
  }
  function recommendRelated(payload){
    if(!recommender)throw Error('Índice de recomendações indisponível. Importe a coletânea.');
    const opts=searchOptions(payload?.settings),original=String(payload?.original_query||'').trim().slice(0,500);
    const active=String(payload?.active_query||'').trim().slice(0,500),root=opts.recContext?original:'';
    const rootScores=root?queryRanking(root,opts):new Map();
    const activeScores=root&&active&&active!==root?queryRanking(active,opts):rootScores;
    const visited=Array.isArray(payload?.visited)?payload.visited.filter(x=>Number.isInteger(Number(x))).slice(-60):[];
    const results=recommender.recommend({id:Number(payload?.hymn_id),originalRanks:rootScores,
      activeRanks:activeScores,originalQuery:root,visited,
      settings:{weight:opts.recWeight,count:opts.recCount,keepContext:opts.recContext,skipVisited:opts.recAvoidVisited}});
    if(!opts.recBreakdown)for(const h of results.results){delete h.query_percent;delete h.similarity_percent;}
    return results;
  }
  function hymnDetail(id){
    const song=hymns.find(s=>s.id===id);if(!song)throw Error('Hino não encontrado.');
    const refs=Array.from(new Set(song.lyrics.match(REFERENCE)||[])).slice(0,15);
    return {...song,topics:[...new Set([...(song.story_profile||[]).map(x=>x.label),...song.topics])].slice(0,12),references:refs};
  }
  async function downloadRemote(){
    if(window.NativeHinos && typeof window.NativeHinos.downloadCollection==='function'){
      return new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{window.__hinosDownloadCompleted=null;reject(Error('Tempo excedido ao baixar a coletânea.'));},60000);
        window.__hinosDownloadCompleted=async(ok,message)=>{
          clearTimeout(timeout);window.__hinosDownloadCompleted=null;
          if(!ok)return reject(Error(message||'Falha ao baixar a coletânea.'));
          try{const response=await fetch('/import/data.json?ts='+Date.now());if(!response.ok)throw Error('Arquivo baixado indisponível');resolve(await importJson(await response.json()));}catch(error){reject(error);}
        };
        window.NativeHinos.downloadCollection();
      });
    }
    const response=await fetch(SOURCE,{cache:'no-store'});if(!response.ok)throw Error('Não foi possível baixar o JSON.');
    return importJson(await response.json());
  }
  async function request(url,payload){
    await init();
    if(url==='/api/status')return {ready:hymns.length>0,hymn_count:hymns.length,vector_count:0,semantic_ready:!!semantic,semantic_topics:semantic?.topics||0,semantic_revision:semantic?.revision||null,
      story_ready:!!narratives,story_count:narratives?.stories||0,story_revision:narratives?.revision||null,
      scripture_ready:!!scriptureIndex,scripture_books:scriptureIndex?.bookCount||0,
      bridge_ready:!!bridge,bridge_entries:bridge?.entries||0,
      collection:metadata.collection,edition:metadata.edition,ai_configured:false,source_url:SOURCE,chat_mode:narratives?'Narrativas bíblicas + temas offline':'Busca contextual local'};
    if(url==='/api/stories')return {stories:narratives?.list()||[]};
    if(url==='/api/import')return importJson(payload.data);
    if(url==='/api/import-remote')return downloadRemote();
    if(url==='/api/search')return search(payload);
    if(url==='/api/recommend')return recommendRelated(payload);
    const match=url.match(/^\/api\/hymns\/(\d+)$/);
    if(match)return hymnDetail(Number(match[1]));
    throw Error('Operação não reconhecida.');
  }
   return {request,normalize,themes,parseTitle,chooseCollection,contextQuery,percentage,semanticLabels,validateHints,searchOptions};
})();
