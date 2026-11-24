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
  const COLLECTIONS={principal:'Coletânea 2018',avulsos:'Avulsos 2018',cia:'CIA 2018',pessoal:'Importados'};
  const COLLECTION_IDS=Object.keys(COLLECTIONS);
  function collectionId(name){
    const n=normalize(name);
    if(/(?:coletanea|coletania).*2018|principal/.test(n))return 'principal';
    if(/(?:^|\s)(?:cia|cias)(?:\s|$)|criancas|intermediarios|adolescentes/.test(n))return 'cia';
    if(/avulsos?/.test(n))return 'avulsos';
    return 'pessoal';
  }
  function collectionName(id){return COLLECTIONS[id]||COLLECTIONS.pessoal;}
  function collectionIds(song){return Array.isArray(song.collections)&&song.collections.length?song.collections:[collectionId(song.collection||'')];}
  function collectionEnabled(song,opts){return collectionIds(song).some(id=>opts.collections[id]!==false);}
  function normalizeLyrics(value){return normalize(value).replace(/[^a-z0-9]+/g,' ').trim();}
  function populateReferences(song){
    const id=collectionId(song.collection||'');song.collections=collectionIds(song);
    if(!song.collectionRefs?.length)song.collectionRefs=[{id,number:song.number||null,name:song.collection||collectionName(id),edition:song.edition||'não informada'}];
    return song;
  }
  let initialized;
  let semantic=null;
  let narratives=null;
  let personalStories=[];
  let personalNarratives=null;
  let personalAliases={};
  let personalWrites=Promise.resolve();
  let personalDataError=null;
  const personalDataKey='personal-dictionary-v1';
  const backupFormat='buscador-de-hinos/dicionario';
  const maxPersonalStories=50;
  let recommender=null;
  let scriptureIndex=null;
  let bibleGraph=null;
  let bridge=null;
  let queryRankingCache=new Map();
  const DEFAULT_SEARCH={collections:{principal:true,avulsos:true,cia:true,pessoal:true},vectorMode:'off',mode:'balanced',strength:75,narratives:true,related:true,minAffinity:0,pageSize:5,showReasons:true,showConcepts:true,scripture:true,bridge:true,bibleGraph:true,bibleLinks:true,bibleDepth:1,contextRerank:false,customAliases:{},recWeight:65,recCount:5,recContext:true,recAvoidVisited:true,recBreakdown:true};
  const validStoryId=id=>/^[a-z0-9_]{2,45}$/.test(id)&&!Object.prototype.hasOwnProperty.call(Object.prototype,id);
  function searchOptions(raw){
    const p=raw&&typeof raw==='object'?raw:{};
    const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
    const aliases={};
    if(p.customAliases&&typeof p.customAliases==='object'){
      for(const [id,terms] of Object.entries(p.customAliases).slice(0,50)){
        if(!validStoryId(id)||!Array.isArray(terms))continue;
        aliases[id]=[...new Set(terms.filter(t=>typeof t==='string'&&t.length>3&&t.length<=90).slice(0,15))];
      }
    }
    const collections=Object.fromEntries(COLLECTION_IDS.map(id=>[id,p.collections?.[id]!==false]));
    return {collections,vectorMode:['balanced','strong','off'].includes(p.vectorMode)?p.vectorMode:DEFAULT_SEARCH.vectorMode,mode:['balanced','literal','context'].includes(p.mode)?p.mode:DEFAULT_SEARCH.mode,
      strength:clamp(p.strength,0,100,75),narratives:p.narratives!==false,
      related:p.related!==false,minAffinity:clamp(p.minAffinity,0,90,0),
      pageSize:[5,10].includes(Number(p.pageSize))?Number(p.pageSize):5,
      showReasons:p.showReasons!==false,showConcepts:p.showConcepts!==false,scripture:p.scripture!==false,bridge:p.bridge!==false,bibleGraph:p.bibleGraph!==false,bibleLinks:p.bibleLinks!==false,bibleDepth:[0,1,2].includes(Number(p.bibleDepth))?Number(p.bibleDepth):1,contextRerank:p.contextRerank===true,customAliases:aliases,
      recWeight:clamp(p.recWeight,0,100,65),recCount:[5,10].includes(Number(p.recCount))?Number(p.recCount):5,
      recContext:p.recContext!==false,recAvoidVisited:p.recAvoidVisited!==false,recBreakdown:p.recBreakdown!==false};
  }
  // Índices residentes em memória: calculados uma vez na importação/abertura.
  // A IA jamais percorre hinos nem altera a coletânea: apenas produz termos de consulta.
  let numberIndex=new Map(),titleIndex=new Map(),wordIndex=new Map(),topicIndex=new Map(),storyIndex=new Map(),searchTexts=new Map();
  function rebuildIndexes(){
    numberIndex=new Map();titleIndex=new Map();wordIndex=new Map();topicIndex=new Map();storyIndex=new Map();searchTexts=new Map();
    for(const song of hymns){
      populateReferences(song);
      const title=normalizeLyrics(song.title);
      if(!titleIndex.has(title))titleIndex.set(title,new Set());
      titleIndex.get(title).add(song.id);
      for(const ref of song.collectionRefs){
        if(!ref.number||!/^\d+$/.test(String(ref.number)))continue;
        const n=Number(ref.number);if(!numberIndex.has(n))numberIndex.set(n,new Set());
        numberIndex.get(n).add(song.id);
      }
      const lyrics=normalizeLyrics(song.lyrics);
      const titleWords=new Set(title.split(' '));
      const words=new Set([...titleWords,...lyrics.split(' ')]);
      searchTexts.set(song.id,{title,lyrics,titleWords,words});
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
    if(bibleGraph&&typeof bibleGraph.setCorpus==='function')bibleGraph.setCorpus(hymns);
    recommender=typeof RecommendationEngine!=='undefined'?RecommendationEngine.create(hymns):null;
    queryRankingCache.clear();
  }
  function candidateSongs(numberMatch,queryTokens,intent,storyIntent,vectorMatches=[],exactTitles=[]){
    if(numberMatch){const ids=numberIndex.get(Number(numberMatch[2]))||new Set();return hymns.filter(h=>ids.has(h.id));}
    // A coletânea é pequena: em consultas narrativas, avaliar todo o catálogo
    // evita perder hinos que não entraram no índice por vocabulário diferente.
    if(storyIntent?.matches?.length)return hymns;
    const ids=new Set(exactTitles);
    for(const item of vectorMatches)ids.add(item.id);
    for(const word of queryTokens)for(const id of (wordIndex.get(word)||[]))ids.add(id);
    if(intent)for(const topic of [...intent.direct,...intent.related])for(const id of (topicIndex.get(topic.id)||[]))ids.add(id);
    if(storyIntent)for(const match of storyIntent.matches)for(const id of (storyIndex.get(match.id)||[]))ids.add(id);
    // Consulta literal ou parcialmente flexionada: reavaliar todos quando a indexação não encontrar nada.
    if(!ids.size)return hymns;
    // Uma frase exata pode existir mesmo quando palavras curtas forem descartadas como stopwords.
    return hymns.filter(h=>ids.has(h.id));
  }
  function differsByOneEdit(left,right){
    if(Math.abs(left.length-right.length)>1)return false;
    let offset=0;
    while(offset<left.length&&left[offset]===right[offset])offset++;
    if(left.length===right.length){
      if(offset===left.length)return false;
      if(left.slice(offset+1)===right.slice(offset+1))return true;
      return left[offset]===right[offset+1]&&left[offset+1]===right[offset]
        &&left.slice(offset+2)===right.slice(offset+2);
    }
    const longer=left.length>right.length?left:right,shorter=longer===left?right:left;
    return longer.slice(offset+1)===shorter.slice(offset);
  }
  function spellingAlternatives(queryTokens){
    const alternatives=new Map();
    for(const token of queryTokens.filter(t=>/^[a-z]{5,24}$/.test(t)&&!wordIndex.has(t)).slice(0,2)){
      const matches=[];
      for(const term of wordIndex.keys()){
        if(!differsByOneEdit(token,term))continue;
        matches.push(term);
        if(matches.length>6)break;
      }
      if(matches.length&&matches.length<=6)alternatives.set(token,matches.sort());
    }
    return alternatives;
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
    if(typeof BibleGraphEngine!=='undefined'&&scriptureIndex)try{
      const response=await fetch('bible-graph.json');
      if(!response.ok)throw Error('Grafo bíblico offline indisponível');
      bibleGraph=BibleGraphEngine.create(await response.json(),scriptureIndex,semantic);
    }catch(error){console.warn('Índice de temas e referências cruzadas indisponível:',error.message);}
  }

  function readPersonalStory(raw){
    const label=String(raw?.label??'').trim().replace(/\s+/g,' ');
    const reference=String(raw?.reference??'').trim();
    const source=Array.isArray(raw?.clues)?raw.clues:[];
    const unique=new Map(source.map(value=>{
      const clue=String(value??'').trim().replace(/\s+/g,' ');
      return [normalizeLyrics(clue),clue];
    }));
    unique.delete('');
    const clues=[...unique.values()];
    if(label.length<4||label.length>90||!/[a-z]/.test(normalizeLyrics(label))||
      (typeof ScriptureIndex!=='undefined'&&ScriptureIndex.parse(label)))throw Error('Informe um nome de 4 a 90 caracteres. Use o campo próprio para a referência.');
    if(source.length>5||clues.some(clue=>clue.length<3||clue.length>60))throw Error('Informe até cinco pistas de 3 a 60 caracteres.');
    const passage=reference&&scriptureIndex?.lookup(reference);
    const validEnd=passage&&(!passage.reference.includes(':')||
      scriptureIndex.lookup(passage.reference.split(':')[0]+':'+passage.to));
    if(reference&&(!validEnd||passage.residual||reference.length>80))throw Error('Informe uma referência bíblica válida, como Lucas 15:11-32.');
    if(clues.length<2&&(!passage||clues.length))throw Error('Informe uma referência ou pelo menos duas pistas diferentes.');
    return {label,reference:passage?.reference||'',clues};
  }
  function compilePersonalStories(rows){
    return rows.length?StoryEngine.create({schema_version:1,revision:'personal-v1',stories:rows.map(story=>({
      ...story,aliases:[],phrases:[],groups:story.clues.length?story.clues.map(clue=>[clue]):[[],[]]
    }))}):null;
  }
  function readAssociations(source,rows){
    if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Associações do dicionário inválidas.');
    const ids=new Set(rows.map(story=>story.id));
    const aliases={};
    let count=0;
    for(const [id,terms] of Object.entries(source)){
      if(!validStoryId(id)||!Array.isArray(terms)||terms.length>15||
        (id.startsWith('local_story_')&&!ids.has(id)))throw Error('O arquivo contém uma associação inválida ou sem narrativa.');
      const unique=new Map();
      for(const term of terms){
        if(typeof term!=='string'||term.trim().length<4||term.length>90||!normalizeLyrics(term))
          throw Error('O arquivo contém uma expressão inválida.');
        unique.set(normalizeLyrics(term),term.trim());
      }
      if(unique.size)aliases[id]=[...unique.values()];
      count+=unique.size;
      if(count>50)throw Error('Limite de 50 associações no dicionário.');
    }
    return aliases;
  }
  function readBackup(raw){
    if(raw?.format!==backupFormat||raw.version!==1||!Array.isArray(raw.stories)||raw.stories.length>maxPersonalStories)
      throw Error('Formato ou versão de backup do dicionário não reconhecido.');
    const ids=new Set();
    const names=new Set();
    const stories=raw.stories.map(item=>{
      if(typeof item?.id!=='string'||!/^local_story_[1-9]\d{0,8}$/.test(item.id)||ids.has(item.id))throw Error('O arquivo contém IDs de narrativas inválidos ou duplicados.');
      const story=readPersonalStory(item);
      const name=normalizeLyrics(story.label);
      if(names.has(name))throw Error('O arquivo contém narrativas com nomes duplicados.');
      names.add(name);
      ids.add(item.id);
      return {id:item.id,...story};
    });
    return {stories,aliases:readAssociations(raw.associations,stories)};
  }
  function personalSnapshot(stories=personalStories,aliases=personalAliases){
    return {format:backupFormat,version:1,stories:stories.map(story=>({...story,clues:story.clues.slice()})),
      associations:Object.fromEntries(Object.entries(aliases).map(([id,terms])=>[id,terms.slice()]))};
  }
  async function persistPersonal(stories,aliases){
    const engine=compilePersonalStories(stories);
    await writeCache(personalSnapshot(stories,aliases),personalDataKey);
    personalStories=stories;
    personalAliases=aliases;
    personalNarratives=engine;
    queryRankingCache.clear();
  }
  function queuePersonalWrite(action){
    const next=personalWrites.then(()=>{if(personalDataError)throw personalDataError;return action();});
    personalWrites=next.catch(()=>{});
    return next;
  }
  async function loadPersonalData(){
    const data=await readCache(personalDataKey);
    if(data){
      const {stories,aliases}=readBackup(data);
      personalStories=stories;
      personalAliases=aliases;
      personalNarratives=compilePersonalStories(stories);
      return;
    }
    if(typeof localStorage==='undefined')return;
    const oldStories=localStorage.getItem('hinos-narrativas-pessoais-v1');
    const oldSettings=localStorage.getItem('hinos-search-preferences-v15');
    if(!oldStories&&!oldSettings)return;
    const legacy=oldStories?JSON.parse(oldStories):[];
    const aliases=oldSettings?JSON.parse(oldSettings)?.customAliases||{}:{};
    const migrated=readBackup({format:backupFormat,version:1,stories:legacy,associations:aliases});
    if(migrated.stories.length||Object.keys(migrated.aliases).length)await persistPersonal(migrated.stories,migrated.aliases);
  }
  function nextPersonalId(stories){
    let next=1;
    while(stories.some(item=>item.id==='local_story_'+next))next++;
    return 'local_story_'+next;
  }
  async function restorePersonalBackup(raw){
    const incoming=readBackup(raw);
    const stories=personalStories.slice();
    const known=new Map(stories.map(story=>[normalizeLyrics(story.label),story]));
    const builtIn=new Set((narratives?.list()||[]).map(story=>normalizeLyrics(story.label)));
    const ids=new Map();
    for(const story of incoming.stories){
      const name=normalizeLyrics(story.label);
      const existing=known.get(name);
      if(existing){
        if(existing.reference!==story.reference||JSON.stringify(existing.clues.map(normalizeLyrics).sort())!==
          JSON.stringify(story.clues.map(normalizeLyrics).sort()))throw Error('Já existe outra narrativa chamada “'+story.label+'”. Renomeie uma delas antes de restaurar.');
        ids.set(story.id,existing.id);
      }else{
        if(builtIn.has(name))throw Error('A narrativa “'+story.label+'” já existe no catálogo. Renomeie-a antes de restaurar.');
        const id=stories.some(item=>item.id===story.id)?nextPersonalId(stories):story.id;
        stories.push({...story,id});
        ids.set(story.id,id);
      }
    }
    if(stories.length>maxPersonalStories)throw Error('O backup excederia o limite de 50 narrativas pessoais.');
    const aliases=personalSnapshot().associations;
    const existingTerms=new Map(Object.entries(aliases).flatMap(([id,terms])=>terms.map(term=>[normalizeLyrics(term),id])));
    let added=0,conflicts=0;
    for(const [sourceId,terms] of Object.entries(incoming.aliases)){
      const id=ids.get(sourceId)||sourceId;
      for(const term of terms){
        const key=normalizeLyrics(term);
        if(existingTerms.has(key)){
          if(existingTerms.get(key)!==id)conflicts++;
          continue;
        }
        (aliases[id]??=[]).push(term);
        existingTerms.set(key,id);
        added++;
      }
    }
    const addedStories=stories.length-personalStories.length;
    await persistPersonal(stories,readAssociations(aliases,stories));
    return {addedStories,addedAliases:added,conflicts};
  }
  function listPersonalStories(){
    return personalStories.map(story=>({...story,clues:story.clues.slice(),personal:true}));
  }
  async function savePersonalStory(raw){
    if(typeof StoryEngine==='undefined')throw Error('Busca por narrativas indisponível.');
    const current=raw?.id?personalStories.find(story=>story.id===raw.id):null;
    if(raw?.id&&!current)throw Error('Narrativa pessoal não encontrada.');
    if(!current&&personalStories.length>=maxPersonalStories)throw Error('Limite de 50 narrativas pessoais.');
    const story=readPersonalStory(raw);
    const label=normalizeLyrics(story.label);
    if([...(narratives?.list()||[]),...personalStories].some(item=>item.id!==current?.id&&normalizeLyrics(item.label)===label))
      throw Error('Já existe uma narrativa com esse nome.');
    const entry={id:current?.id||nextPersonalId(personalStories),...story};
    const next=current?personalStories.map(item=>item.id===current.id?entry:item):[...personalStories,entry];
    await persistPersonal(next,personalAliases);
    return {...entry,clues:entry.clues.slice(),personal:true};
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
  // O JSON público contém também versões antigas e idiomas de teste.
  // Importamos APENAS principal, avulsos e CIA 2018 quando há coleções reconhecidas.
  function importGroups(data){
    const groups=Array.isArray(data)?data:Array.isArray(data?.collections)?data.collections:Array.isArray(data?.coletaneas)?data.coletaneas:Array.isArray(data?.data)?data.data:[data];
    const named=groups.filter(g=>g&&Array.isArray(g.songs));
    if(!named.length&&Array.isArray(groups)&&groups.some(g=>g&&typeof g.content==='string'))return [{name:'Importados',songs:groups}];
    if(!named.length)throw Error('Nenhuma coleção com campo "songs" foi encontrada neste JSON.');
    const curated=named.filter(g=>collectionId(g.name)!=='pessoal');
    return curated.length?curated:named;
  }
  function sameLyrics(a,b){
    const x=normalizeLyrics(a),y=normalizeLyrics(b);
    return x.length>=75&&x===y;
  }
  function libraryCounts(){
    const result=Object.fromEntries(COLLECTION_IDS.map(id=>[id,0]));
    for(const song of hymns)for(const id of new Set(collectionIds(song)))result[id]=(result[id]||0)+1;
    return result;
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(Error('Armazenamento local indisponível neste aparelho.'));
      const request=indexedDB.open('buscador-hinos-android',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('cache'))request.result.createObjectStore('cache');};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  async function readCache(key='hymns'){
    const db=await openDb();try{
      return await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly');const rq=tx.objectStore('cache').get(key);rq.onsuccess=()=>resolve(rq.result||null);rq.onerror=()=>reject(rq.error);});
    }finally{db.close();}
  }
  async function writeCache(value,key='hymns'){
    const db=await openDb();try{
      await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    }finally{db.close();}
  }
  async function init(){
    if (!initialized)initialized=(async()=>{await loadSemantic();try{await loadPersonalData();personalDataError=null;}catch(error){
      personalDataError=Error('Não foi possível ler o dicionário local. Os dados foram preservados.');
      console.warn('Falha ao abrir dicionário:',error.message);
    }const cache=await readCache();if(cache&&Array.isArray(cache.hymns)){hymns=cache.hymns;metadata=cache.metadata||metadata;const migrated=hymns.some(h=>!Array.isArray(h.collections)||!h.collectionRefs?.length);for(const h of hymns)populateReferences(h);if((semantic&&cache.semantic_revision!==semantic.revision)||(narratives&&cache.story_revision!==narratives.revision)){
      for(let i=0;i<hymns.length;i++){
        const song=hymns[i];if(semantic){song.semantic_profile=semantic.indexHymn(song.title,song.lyrics);song.topics=song.semantic_profile.slice(0,12).map(t=>t.label);}
        if(narratives) song.story_profile=narratives.indexHymn(song.title,song.lyrics);
        if(i&&i%100===0)await yieldThread();
      }
      await writeCache({hymns,metadata,semantic_revision:semantic?.revision||null,story_revision:narratives?.revision||null});
    }else if(migrated)await writeCache({hymns,metadata,semantic_revision:semantic?.revision||null,story_revision:narratives?.revision||null});rebuildIndexes();if(window.NativeVector&&typeof VectorIndex!=='undefined')await VectorIndex.configure(hymns);} })().catch(e=>{initialized=null;throw e;});
    return initialized;
  }
  async function importJson(data){
    const groups=importGroups(data),next=hymns.slice();
    const exact=new Map();
    for(const song of next){
      populateReferences(song);
      const key=normalizeLyrics(song.lyrics);
      if(key.length>=75&&!exact.has(key))exact.set(key,song);
    }
    const additions={principal:0,avulsos:0,cia:0,pessoal:0};
    let duplicates=0,processed=0;
    for(const group of groups){
      const collection=String(group.name||'Importados');
      const id=collectionId(collection),match=collection.match(/20\d{2}/),edition=match?match[0]:'não informada';
      for(const raw of group.songs){
        if(!raw||typeof raw!=='object')continue;
        const parsed=parseTitle(String(raw.title||raw.titulo||'')),lyrics=plainText(String(raw.content||raw.letra||''));
        if(!parsed.title||!lyrics)continue;
        let number=raw.number??raw.numero;
        number=number!==undefined&&number!==null&&/^\d+$/.test(String(number))?String(number).padStart(3,'0'):parsed.number;
        const key=normalizeLyrics(lyrics);let song=key.length>=75?exact.get(key):null;
        // A mesma letra não cria dois resultados: conservamos TODAS as referências de origem.
        if(song){
          duplicates++;
          if(!song.collections.includes(id))song.collections.push(id);
          if(!song.collectionRefs.some(ref=>ref.id===id&&String(ref.number||'')===String(number||'')))
            song.collectionRefs.push({id,name:collection,number,edition});
        }else{
          const searchable=normalize(parsed.title+' '+lyrics),titleNorm=normalize(parsed.title);
          const semantic_profile=semantic?semantic.indexHymn(parsed.title,lyrics):[];
          const topics=semantic?semantic_profile.slice(0,12).map(t=>t.label):themes(parsed.title+' '+lyrics);
          const story_profile=narratives?narratives.indexHymn(parsed.title,lyrics):[];
          song={id:next.length+1,number,title:parsed.title,lyrics,collection,edition,collections:[id],
            collectionRefs:[{id,name:collection,number,edition}],searchable,titleNorm,topics,semantic_profile,story_profile};
          next.push(song);additions[id]++;
          if(key.length>=75)exact.set(key,song);
        }
        processed++;
        if(processed%125===0)await yieldThread();
      }
    }
    if(!processed)throw Error('Nenhum hino válido neste JSON.');
    const importedTypes=[...new Set(next.flatMap(h=>collectionIds(h)))];
    const nextMeta={collection:importedTypes.length===1?collectionName(importedTypes[0]):'Biblioteca unificada',
      edition:importedTypes.length===1?(next[0]?.edition||'não informada'):'múltiplas coleções',hymn_count:next.length};
    await writeCache({hymns:next,metadata:nextMeta,semantic_revision:semantic?.revision||null,story_revision:narratives?.revision||null});
    hymns=next;metadata=nextMeta;rebuildIndexes();
    if(window.NativeVector&&typeof VectorIndex!=='undefined')await VectorIndex.configure(hymns);
    return {ok:true,collection:metadata.collection,edition:metadata.edition,count:hymns.length,added:Object.values(additions).reduce((a,b)=>a+b,0),
      duplicates,collections:libraryCounts(),processed};
  }
  function makeSnippet(song,qTokens,selectedTopics,semanticCues=[],phrases=[]){
    const lines=song.lyrics.split(/\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    if(!lines.length)return '';
    const clues=qTokens.concat(semanticCues.map(normalize),selectedTopics.flatMap(t=>THEME_WORDS[t]||[]).filter(w=>w.length>=4));
    const weight=line=>{
      const norm=normalizeLyrics(line);
      const exact=phrases.reduce((sum,p)=>sum+(hasWord(norm,p)?20:0),0);
      return exact+clues.reduce((sum,w)=>sum+(hasWord(norm,w)?(qTokens.includes(w)?3:1):0),0);
    };
    let best=lines[0],bestWeight=weight(best);
    for(const [i,line] of lines.entries()){
      const lineWeight=weight(line);
      if(lineWeight>bestWeight){best=line;bestWeight=lineWeight;}
      if(!phrases.length||i===lines.length-1)continue;
      const pair=line+' / '+lines[i+1];
      if(!phrases.some(phrase=>hasWord(normalizeLyrics(pair),phrase)&&
        !hasWord(normalizeLyrics(line),phrase)&&!hasWord(normalizeLyrics(lines[i+1]),phrase)))continue;
      const pairWeight=weight(pair);
      if(pairWeight>bestWeight){best=pair;bestWeight=pairWeight;}
    }
    return best.length>210?best.slice(0,210)+'…':best;
  }
  function lyricPassages(lyrics){
    const passages=new Map();
    for(const stanza of lyrics.split(/\n[ \t]*\n+/)){
      const lines=stanza.split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
      for(let start=0;start<lines.length;start++){
        let text=lines[start];
        if(text.length>210)continue;
        for(let i=start+1;i<Math.min(lines.length,start+4);i++){
          if(text.length+3+lines[i].length>210)break;
          text+=' / '+lines[i];
        }
        const key=normalizeLyrics(text);
        if(key&&!passages.has(key))passages.set(key,text);
      }
    }
    return [...passages].map(([key,text])=>({searchable:' '+key+' ',text}));
  }
  function findSharedPassage(song,indexedText,topicIds){
    const topics=(song.semantic_profile||[]).filter(topic=>topicIds.has(topic.id));
    if(topics.length<2)return null;
    const clues=topics.flatMap(topic=>topic.evidence.map(normalizeLyrics).filter(Boolean).map(cue=>({topic,cue})));
    indexedText.passages??=lyricPassages(song.lyrics);
    for(const passage of indexedText.passages){
      const hits=[];
      for(const clue of clues){
        const start=passage.searchable.indexOf(' '+clue.cue+' ');
        if(start<0)continue;
        const end=start+clue.cue.length;
        const other=hits.find(hit=>hit.topic.id!==clue.topic.id&&hit.cue!==clue.cue&&
          (hit.end<=start||end<=hit.start));
        if(other){
          const labels=[other.topic.label,clue.topic.label].map(label=>label.toLocaleLowerCase('pt-BR'));
          return {text:passage.text,reason:'Temas no mesmo trecho: '+labels.join(' e ')};
        }
        hits.push({...clue,start,end});
      }
    }
    return null;
  }
  const MAX_QUERY_LENGTH=500;
  const RESET_QUERY=/^(?:nova busca|recome[cç]ar|do zero|esque[cç]a (?:a )?anterior)(?:\b|$)[\s,:;.-]*(?:por\s+)?/i;
  const QUOTED_TEXT=/"([^"]+)"|“([^”]+)”/g;
  const REQUIRED_PREFIX=/^(?:(?:os|as)\s+)?(?:(?:hinos|louvores|cânticos|canticos)\s+)?(?:(?:sobre|de|do|da|dos|das|com)\s+)?/i;
  function contextQuery(query,previous,{refine=true,literal=false,keepTitle=false}={}){
    const fresh=refine&&RESET_QUERY.test(query.trim());
    if(fresh)query=query.trim().replace(RESET_QUERY,'');
    const excluded=[],deprioritized=[],required=[],positive=[];
    const masked=query.replace(QUOTED_TEXT,match=>'#'.repeat(match.length));
    const markers=keepTitle?[]:[...masked.matchAll(/(^|[\s,;])(sem\s+foco\s+(?:em|na|no|nas|nos)|n[aã]o\s+quero|exclua|evite|sem|apenas|somente|só)\s+/gi)].filter(match=>{
      const operator=normalize(match[2]);
      if(operator==='so'){
        const rest=masked.slice(match.index+match[0].length);
        return refine||/^(?:os|as|hinos|louvores|sobre|de|com)\s+/i.test(rest);
      }
      if(operator!=='sem')return true;
      const before=masked.slice(0,match.index).trim();
      return (refine||(!literal&&before))&&!/\b(?:estou|estamos|fiquei|sinto[- ]me)$/i.test(before);
    });
    let cursor=0;
    for(const [i,match] of markers.entries()){
      const operator=normalize(match[2]);
      const mandatory=operator==='apenas'||operator==='somente'||operator==='so';
      const clauseStart=match.index+match[0].length;
      const start=mandatory?clauseStart+masked.slice(clauseStart).match(REQUIRED_PREFIX)[0].length:clauseStart;
      const limit=markers[i+1]?.index??query.length;
      const boundary=masked.slice(start,limit).search(/[,;.!?\n]|\s+(?:(?:mas|e)\s+)?com\b/i);
      const end=boundary<0?limit:start+boundary;
      const content=query.slice(start,end).trim().replace(/\s+(?:e|mas)$/i,'');
      const phrase=mandatory?content:content.replace(/^(?:os?|as?|de|do|da|dos|das)\s+/i,'')
        .replace(/^["“]|["”]$/g,'').trim();
      if(!phrase||phrase.length>80)continue;
      const target=mandatory?required:operator.startsWith('sem foco ')?deprioritized:excluded;
      if(target.length>=4)continue;
      target.push(phrase);
      positive.push(query.slice(cursor,match.index).trim().replace(/\s+(?:e|mas)$/i,'').replace(/[,;]+$/g,''));
      cursor=end;
    }
    positive.push(query.slice(cursor).trim().replace(/^[,;.!?]+\s*/,''));
    let text=positive.filter(Boolean).join(' ').trim();
    const previousBudget=text?Math.min(350,Math.max(0,MAX_QUERY_LENGTH-text.length-2)):MAX_QUERY_LENGTH;
    const old=String(previous||'').slice(0,previousBudget).trim();
    if(!fresh&&old&&(text.length<140||/\b(apenas|somente|mais|menos|agora|desses|destes|tambem|priorize|foco|enfatiz)/i.test(normalize(text))))text=text?old+'. '+text:old;
    if(!text&&required.length)text=required.join(' ');
    return {query:text.slice(0,MAX_QUERY_LENGTH),excluded,deprioritized,required,fresh};
  }
  function combineRestrictions(inherited,parsed){
    const unique=new Map();
    for(const term of [...(Array.isArray(inherited)?inherited:[]),...parsed]){
      if(typeof term!=='string'||!term.trim()||term.length>80)continue;
      const key=normalize(term);
      if(!unique.has(key))unique.set(key,term.trim());
      if(unique.size===4)break;
    }
    return [...unique.values()];
  }
  function searchCriterion(term,allowTopics){
    const normalized=normalizeLyrics(term);
    const exact=/^(?:"[^"]+"|“[^”]+”)$/.test(term);
    const thematic=allowTopics&&!exact;
    const topicIds=thematic?new Set(semantic?.interpret(term).direct.map(topic=>topic.id)):new Set();
    return {term,normalized,thematic,topicIds};
  }
  // Conversão VISUAL heurística não calibrada: NÃO é probabilidade nem confiança estatística.
  function percentage(score, exactNumber=false){
    if(exactNumber)return 100;
    return Math.max(20, Math.min(98, Math.round(30 + 68*(1-Math.exp(-score/22)))));
  }
  function search(payload){
    let query=String(payload?.query||'').trim();if(!query||query.length>MAX_QUERY_LENGTH)throw Error(`Digite uma consulta de até ${MAX_QUERY_LENGTH} caracteres.`);
    const opts=searchOptions(payload?.settings);
    opts.customAliases={...personalAliases,...opts.customAliases};
    const page=Math.max(1,Math.min(100,Number(payload.page)||1));
    const refine=Boolean(payload?.refine);
    const ctx=payload?.parsed_query===true&&!refine?{query,excluded:[],deprioritized:[],required:[],fresh:false}:
      contextQuery(query,refine?payload.previous:'',{refine,literal:opts.mode==='literal',keepTitle:!refine&&titleIndex.has(normalizeLyrics(query))});
    query=ctx.query;
    const excluded=combineRestrictions(ctx.fresh?[]:payload?.exclude,ctx.excluded);
    const excludedTerms=new Set(excluded.map(normalizeLyrics));
    const deprioritized=combineRestrictions(ctx.fresh?[]:payload?.deprioritize,ctx.deprioritized)
      .filter(term=>!excludedTerms.has(normalizeLyrics(term)));
    const required=combineRestrictions(ctx.fresh?[]:payload?.require,ctx.required);
    const criteria={effective_query:query,excluded,deprioritized,required,reset_context:ctx.fresh};
    if(!query)return {results:[],page,page_size:opts.pageSize,total:0,has_more:false,...criteria,used_ai:false,summary:'Nenhum critério positivo informado.'};
    const norm=normalize(query), numberMatch=norm.match(/^(?:(coletanea|principal|avulsos?|cia|criancas|infantil)\s+)?(?:hino\s*|louvor\s*)?(\d{1,4})$/);
    const bible=typeof BibleContext!=='undefined'?BibleContext.lookup(query):null;
    const scripture=opts.scripture&&scriptureIndex?scriptureIndex.lookup(query):null;
    const isBiblicalRef=typeof BibleContext!=='undefined' && BibleContext.looksLikeReference(query);
    const hints=opts.mode==='literal'?[]:validateHints(payload?.semantic_hints);
    const quoted=[...query.matchAll(QUOTED_TEXT)].map(match=>normalizeLyrics(match[1]||match[2])).filter(Boolean);
    const exactTitles=titleIndex.get(normalizeLyrics(query))||new Set();
    const storyEnabled=opts.mode!=='literal'&&opts.narratives&&!numberMatch;
    const personalIntent=storyEnabled&&!quoted.length?personalNarratives?.interpret(query,opts.customAliases):null;
    const baseIntent=storyEnabled?narratives?.interpret(personalIntent?.matches.length?personalIntent.residual:query,opts.customAliases):null;
    const storyIntent=personalIntent?.matches.length?{
      matches:[...personalIntent.matches,...(baseIntent?.matches||[])].slice(0,4),
      residual:baseIntent?.residual??personalIntent.residual
    }:baseIntent;
    const graphEnabled=opts.scripture&&opts.bibleGraph&&opts.mode!=='literal'&&bibleGraph&&!numberMatch;
    let graphCtx=graphEnabled?bibleGraph.resolve(query,opts):null;
    const personalMatches=new Set(personalIntent?.matches.map(match=>match.id)||[]);
    const personalClues=new Set(personalStories.filter(story=>personalMatches.has(story.id)&&story.clues.length).map(story=>story.id));
    const references=new Set(personalIntent?.matches.map(match=>match.reference).filter(Boolean)||[]);
    if(graphEnabled&&!graphCtx&&references.size===1){
      const linked=bibleGraph.resolve([...references][0],opts);
      if(linked)graphCtx={...linked,residual:storyIntent.residual};
    }
    // Subtrair o alias reconhecido: a palavra genérica "filho" não vira evidência de Filho Pródigo.
    const lexicalQuery=storyIntent?.matches?.length?storyIntent.residual:query;
    const analysisText=opts.mode==='literal'?query:[graphCtx?.residual??scripture?.residual??lexicalQuery,bible?.theme||'',...hints].filter(Boolean).join(' ');
    const bridgeIntent=opts.bridge&&bridge&&opts.mode!=='literal'?bridge.interpret(analysisText):null;
    const intent=semantic&&opts.mode!=='literal'?semantic.interpret(analysisText):null;
    // O grafo já interpreta o texto bíblico e filtra associações ambíguas.
    // Não reintroduzir os mesmos temas por uma segunda interpretação independente.
    const scriptureTopics=!graphCtx&&scripture&&semantic&&opts.mode!=='literal'?
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
    const alternatives=opts.mode==='literal'||numberMatch||quoted.length?new Map():spellingAlternatives(qTokens);
    const lexicalCandidates=[...qTokens,...[...alternatives.values()].flat()];
    const termWeight=new Map(qTokens.map(token=>[token,Math.min(1.45,1+Math.log((hymns.length+1)/((wordIndex.get(token)?.size||0)+1))/5)]));
    const exactPhrase=normalizeLyrics(scripture?(scripture.residual||''):lexicalQuery);
    const allowTopics=opts.mode!=='literal';
    const requiredCriteria=required.map(term=>searchCriterion(term,allowTopics));
    const excludedCriteria=excluded.map(term=>searchCriterion(term,allowTopics));
    const lowerCriteria=deprioritized.map(term=>searchCriterion(term,allowTopics));
    const snippetPhrases=[...new Set([...requiredCriteria.map(item=>item.normalized).filter(Boolean),...(quoted.length?quoted:exactPhrase.length>=4?[exactPhrase]:[])])];
    // A proximidade complementa buscas temáticas livres e preserva a evidência de consultas exatas.
    const usePassages=semanticWeight>0&&!numberMatch&&!quoted.length&&!required.length&&
      !scripture&&!isBiblicalRef&&!storyIntent?.matches.length;
    const passageTopics=new Set(usePassages?intent?.direct.map(topic=>topic.id):[]);
    const vectorEnabled=opts.vectorMode!=='off' && opts.mode!=='literal' && !numberMatch && typeof VectorIndex!=='undefined' && VectorIndex.status().ready && VectorIndex.checkQuery(payload?.vector_query);
    const vectorHits=vectorEnabled?VectorIndex.topForQuery(payload.vector_query,100):[];
    const vectorScores=new Map(vectorHits.map(h=>[h.id,h.similarity]));
    const ranked=[];
    for(const song of (graphCtx||quoted.length?hymns:candidateSongs(numberMatch,lexicalCandidates,intent,storyIntent,vectorHits,exactTitles))){
      if(!collectionEnabled(song,opts))continue;
      const indexedText=searchTexts.get(song.id);
      const {title,lyrics,titleWords,words}=indexedText;
      const matchesText=term=>hasWord(title,term)||hasWord(lyrics,term);
      if(quoted.some(phrase=>!matchesText(phrase)))continue;
      const matchesTopic=criterion=>song.semantic_profile?.find(topic=>criterion.topicIds.has(topic.id));
      const matchesCriterion=criterion=>criterion.normalized&&(matchesText(criterion.normalized)||
        (criterion.thematic&&(matchesTopic(criterion)||song.topics.some(topic=>normalizeLyrics(topic)===criterion.normalized))));
      if(requiredCriteria.some(criterion=>!matchesCriterion(criterion)))continue;
      if(excludedCriteria.some(matchesCriterion))continue;
      const namedCollection=numberMatch?.[1]?collectionId(numberMatch[1]):null;
      if(numberMatch&&!song.collectionRefs.some(ref=>Number(ref.number)===Number(numberMatch[2]) && (!namedCollection||ref.id===namedCollection) && opts.collections[ref.id]!==false))continue;
      let score=0;const evidence=[],spelling=[];let semanticResult=null,storyResult=null,graphResult=null;
      if(numberMatch){
        if(!song.collectionRefs.some(ref=>Number(ref.number)===Number(numberMatch[2])))continue;
        score=100;evidence.push('número exato');
      }else{
        const lexicalWeight=opts.mode==='context'?0.7:1;
        // Não premiar um título por conter apenas parte de uma narrativa reconhecida.
        if(exactTitles.has(song.id)){score+=38;evidence.push('título exato');}
        else if(exactPhrase.length>=4&&hasWord(title,exactPhrase)){score+=18*lexicalWeight;evidence.push('título relacionado à pesquisa');}
        else if(exactPhrase.length>=4&&qTokens.length&&hasWord(lyrics,exactPhrase)){score+=14*lexicalWeight;evidence.push('trecho diretamente relacionado à pesquisa');}
        if(quoted.length){score+=18;evidence.push('trecho entre aspas encontrado');}
        let matched=0;
        for(const token of (scripture?qTokens.filter(t=>!/^\d+$/.test(t)):qTokens)){
          if(words.has(token)){
            score+=(titleWords.has(token)?7.5:2.3)*lexicalWeight*termWeight.get(token);
            matched++;
          }else{
            const variant=(alternatives.get(token)||[]).find(word=>words.has(word));
            if(variant){score+=titleWords.has(variant)?5.6:4.8;spelling.push(variant);}
          }
        }
        if(qTokens.length>1&&matched>1)score+=3*matched/qTokens.length;
        if(spelling.length)evidence.push('grafia próxima: '+[...new Set(spelling)].slice(0,2).join(', '));
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
        const v=vectorScores.get(song.id);
        if(v!==undefined && v>=0.72){
          const points=Math.min(24,Math.max(0,(v-.70)*110))*(opts.vectorMode==='strong'?1.4:1);
          score+=points;
          if(points>=4)evidence.push('significado próximo da consulta (modelo E5)');
        }
        if(graphCtx){
          graphResult=bibleGraph.evaluate(song,graphCtx);
          score+=graphResult.score*semanticWeight;
          if(graphResult.reasons.length)evidence.unshift(...graphResult.reasons.slice(0,2));
        }
        if(storyIntent?.matches.length){
          const personalProfile=personalClues.size?personalNarratives.indexHymn(song.title,song.lyrics,personalClues).filter(item=>item.localCoverage>=2):[];
          storyResult=(narratives||personalNarratives).evaluate([...(song.story_profile||[]),...personalProfile],storyIntent);
          score+=storyResult.score*semanticWeight;
          if(storyResult.reasons.length)evidence.unshift(...storyResult.reasons);
        }
      }
      if(score<(semanticResult?.score>0||storyResult?.score>0||graphResult?.score>=7||vectorScores.get(song.id)>0.76||spelling.length?4.7:7))continue;
      const sharedPassage=passageTopics.size>=2?findSharedPassage(song,indexedText,passageTopics):null;
      if(sharedPassage){
        score+=9*Math.min(semanticWeight,1);
        evidence.unshift(sharedPassage.reason);
      }
      const lowered=numberMatch?[]:lowerCriteria.filter(matchesCriterion).map(criterion=>criterion.term);
      if(lowered.length)score*=1-Math.min(.45,lowered.length*.25);
      const matchedTokens=qTokens.filter(x=>words.has(x));
      const reason=numberMatch?'Número exato do hino.':evidence.length?evidence.slice(0,2).join('. ')+'.':matchedTokens.length?'A letra contém termos relacionados: '+matchedTokens.slice(0,3).join(', ')+'.':'Possível relação temática; confira a letra antes de utilizar.';
      const percent=percentage(score,!!numberMatch);
      if(percent<opts.minAffinity)continue;
      const explanations=[...(graphResult?.reasons||[]),...(storyResult?.reasons||[]),...(semanticResult?.proof||[])].slice(0,3);
      const selectedRef=numberMatch? song.collectionRefs.find(ref=>Number(ref.number)===Number(numberMatch[2])&&(!namedCollection||ref.id===namedCollection)) : song.collectionRefs.find(ref=>opts.collections[ref.id]!==false);
      ranked.push({id:song.id,number:selectedRef?.number||song.number,title:song.title,collection:selectedRef?.name||song.collection,collection_ids:song.collections.slice(),edition:selectedRef?.edition||song.edition,
        topics:[...new Set([...(graphResult?.matched||[]),...(storyResult?.matched||[]),...song.topics])].slice(0,7),
        spelling,sharedPassage,cues:[...requiredCriteria.flatMap(criterion=>matchesTopic(criterion)?.evidence||[]),
          ...(graphResult?.cues||[]),...(storyResult?.cues||[]),...(semanticResult?.cues||[])],
        reason:opts.showReasons?reason+(lowered.length?' Menor prioridade por '+lowered.join(', ')+'.':''):'',explanations:opts.showReasons?explanations:[],
        relevance_score:Math.round(score*100)/100,relevance_percent:percent,
        _narrativeTier:storyResult?.tier||0,
        vector_similarity:vectorScores.has(song.id)?Math.round(vectorScores.get(song.id)*100):null,
        match_type:numberMatch?'numero':exactTitles.has(song.id)?'titulo_exato':graphResult?.score>=8?'referencia_biblica':storyResult?.score>0?'narrativa':vectorScores.get(song.id)>0.74?'vetorial':'contexto',
        relevance:score>=17?'Muito relevante':score>=10?'Relevante':'Relacionado'});
    }
    // Consulta composta: preservar o peso dos outros requisitos; o nível
    // narrativo só desempata prioritariamente a busca pela história isolada.
    const narrativePrimary=Boolean(storyIntent?.matches?.length)&&qTokens.length===0&&!required.length;
    const compareRanking=(a,b)=>Number(b.match_type==='titulo_exato')-Number(a.match_type==='titulo_exato')||
      (narrativePrimary?b._narrativeTier-a._narrativeTier:0)||
      b.relevance_score-a.relevance_score||Number(a.number||10000)-Number(b.number||10000)||a.id-b.id;
    ranked.sort(compareRanking);
    let contextReranked=false;
    const canRerank=opts.contextRerank&&semanticWeight>0&&graphCtx&&!numberMatch&&!quoted.length
      &&typeof ContextRanker!=='undefined';
    if(canRerank){
      const source=ContextRanker.profile(graphCtx.sourceText);
      if(new Set(source.events.map(event=>event.action)).size>=2){
        const finalists=ranked.slice(0,40).map(hit=>{
          if(hit.match_type==='titulo_exato')return hit;
          const signals=ContextRanker.compare(source,ContextRanker.profile(hymns[hit.id-1].lyrics));
          const weight=Math.min(1,semanticWeight)*(graphCtx.residual?0.5:1);
          const adjustment=ContextRanker.score(signals)*3*weight;
          return {...hit,_contextOrder:hit.relevance_score+adjustment};
        });
        finalists.sort((a,b)=>Number(b.match_type==='titulo_exato')-Number(a.match_type==='titulo_exato')||
          (narrativePrimary?b._narrativeTier-a._narrativeTier:0)||
          (b._contextOrder??b.relevance_score)-(a._contextOrder??a.relevance_score)||compareRanking(a,b));
        contextReranked=finalists.some((hit,index)=>hit.id!==ranked[index].id);
        ranked.splice(0,finalists.length,...finalists);
      }
    }
    // O hino não aprendido continua no ranking e mantém sua afinidade.
    // Apenas a paginação principal fica reservada aos hinos disponíveis.
    const available=ranked.filter(h=>!RepertoireStore.isNotLearned(hymns[h.id-1]));
    const notLearned=ranked.filter(h=>RepertoireStore.isNotLearned(hymns[h.id-1]));
    const hiddenPage=Math.max(1,Math.min(100,Number(payload?.not_learned_page)||1));
    const hiddenSize=5;
    const hiddenFrom=(hiddenPage-1)*hiddenSize;
    const from=(page-1)*opts.pageSize;
    const withSnippet=({spelling,sharedPassage,cues,_narrativeTier,_contextOrder,...hit})=>({...hit,
      snippet:sharedPassage?.text||makeSnippet(hymns[hit.id-1],[...qTokens,...spelling],selectedTopics,cues,snippetPhrases)});
    const reading=storyIntent?.matches?.map(x=>x.reference?x.label+' ('+x.reference+')':x.label)||[];
    const interpretation=opts.showConcepts?[
      ...(vectorEnabled?['Embeddings E5: '+VectorIndex.status().count+' hinos indexados']:[]),
      ...reading.map(t=>'Narrativa: '+t),
      ...selectedTopics.slice(0,6).map(t=>'Tema: '+t),
      ...(scripture?['Bíblia Livre offline: '+scripture.reference+(scripture.partial?' (amostra do capítulo)':'')]:[]),
      ...(graphCtx?['Grafo bíblico: '+graphCtx.reference+(graphCtx.narrative?' · '+graphCtx.narrative:'')]:[]),
      ...(graphCtx?.concepts||[]).slice(0,6).map(t=>'Tema do texto bíblico: '+t.label),
      ...(graphCtx?.relatedCount?['Referências cruzadas: '+graphCtx.relatedCount+' ligações consultadas']:[]),
      ...(bridgeIntent?.aliases||[]).map(t=>'Associação lexical: '+t),
      ...(storyIntent?.matches.length&&storyIntent.residual&&tokens(storyIntent.residual).length?['Outros termos: '+tokens(storyIntent.residual).join(', ')]:[])
    ]:[];
    return {page,page_size:opts.pageSize,total:available.length,has_more:from+opts.pageSize<available.length,
      results:available.slice(from,from+opts.pageSize).map(withSnippet),
      not_learned_total:notLearned.length,not_learned_page:hiddenPage,
      not_learned_results:notLearned.slice(hiddenFrom,hiddenFrom+hiddenSize).map(withSnippet),
      not_learned_has_more:hiddenFrom+hiddenSize<notLearned.length,
      topics:selectedTopics,story_matches:reading,
      ai_context:{
        reference:graphCtx?.reference||scripture?.reference||null,
        passage:(graphCtx?.sourceText||scripture?.text||'').slice(0,220),
        topics:[...new Set([...(graphCtx?.concepts||[]).map(topic=>topic.label),...selectedTopics])].slice(0,4)
      },
      interpretation,...criteria,context_reranked:contextReranked,exact_number:Boolean(numberMatch),used_ai:hints.length>0,applied_hints:hints,
      _fullRanked:payload?._forRecommendations===true?ranked:undefined,
      summary:graphCtx?'Busca por contexto bíblico offline: '+graphCtx.reference+'. Resultados baseados nas evidências das letras.':scripture?'Texto da Bíblia Livre consultado offline: '+scripture.reference+'.':bible?'Referência '+bible.reference+': '+bible.theme+'.':isBiblicalRef&&!storyIntent?.matches.length?'Referência bíblica não mapeada localmente; cole o texto do versículo para buscar por seu significado.':'',
      bible_reference:graphCtx?.reference||scripture?.reference||bible?.reference||null,bible_verses:scripture?.verses?.length||0,scripture_source:scripture?.source||null};
  }
  function queryRanking(query,opts){
    if(!query||!query.trim()||/^(?:hino\s*)?\d{1,4}$/i.test(query.trim()))return new Map();
    const key=JSON.stringify([query,opts.mode,opts.strength,opts.narratives,opts.related,opts.customAliases,opts.collections,opts.vectorMode,opts.contextRerank]);
    if(queryRankingCache.has(key))return queryRankingCache.get(key);
    const ranked=search({query,page:1,parsed_query:true,settings:{...opts,minAffinity:0},_forRecommendations:true});
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
    const notLearnedIds=new Set(RepertoireStore.marked(hymns).map(h=>h.id));
    const results=recommender.recommend({id:Number(payload?.hymn_id),originalRanks:rootScores,
      activeRanks:activeScores,originalQuery:root,visited,
      settings:{weight:opts.recWeight,count:opts.recCount,keepContext:opts.recContext,skipVisited:opts.recAvoidVisited,allowed:opts.collections,notLearnedIds}});
    for(const item of results.results){
      const song=hymns[item.id-1];
      const ref=song?.collectionRefs?.find(r=>opts.collections[r.id]!==false);
      if(ref){item.collection=ref.name;item.number=ref.number||song.number;}
    }
    if(opts.vectorMode!=='off'&&typeof VectorIndex!=='undefined'&&VectorIndex.status().ready){
      const vectorHits=VectorIndex.topForHymn(Number(payload?.hymn_id),45);
      const byId=new Map(results.results.map(x=>[x.id,x]));
      const blocked=new Set(opts.recAvoidVisited?visited.map(Number):[]);
      blocked.add(Number(payload?.hymn_id));
      for(const item of vectorHits){
        if(blocked.has(item.id)||item.similarity<0.76)continue;
        const candidate=hymns[item.id-1];if(!candidate||candidate.id!==item.id||!collectionEnabled(candidate,opts)||notLearnedIds.has(item.id))continue;
        const vectorPercent=VectorIndex.percent(item.similarity);
        if(vectorPercent<15)continue;
        const base=byId.get(item.id);
        if(base){
          base.similarity_percent=Math.round(.63*base.similarity_percent+.37*vectorPercent);
          base.compatibility_percent=Math.round(.67*base.compatibility_percent+.33*vectorPercent);
        }else{
          const qScore=rootScores.get(item.id)||0;
          const combined=Math.round(opts.recContext&&root?.trim()?opts.recWeight/100*vectorPercent+(1-opts.recWeight/100)*qScore:vectorPercent);
          if(combined<20)continue;
          const ref=candidate.collectionRefs.find(r=>opts.collections[r.id]!==false);
          byId.set(item.id,{id:candidate.id,number:ref?.number||candidate.number,title:candidate.title,collection:ref?.name||candidate.collection,
            compatibility_percent:combined,similarity_percent:vectorPercent,
            query_percent:opts.recContext&&root?.trim()?qScore:null,
            reason:'Proximidade vetorial estimada pelo E5 Small; confira o conteúdo das letras.',topics:[],score:combined/100});
        }
      }
      results.results=[...byId.values()].sort((a,b)=>b.compatibility_percent-a.compatibility_percent).slice(0,opts.recCount);
      results.total=byId.size;
    }
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
    if(url==='/api/status')return {ready:hymns.length>0,hymn_count:hymns.length,vector_count:typeof VectorIndex!=='undefined'?VectorIndex.status().count:0,vector_status:typeof VectorIndex!=='undefined'?VectorIndex.status():null,semantic_ready:!!semantic,semantic_topics:semantic?.topics||0,semantic_revision:semantic?.revision||null,
      story_ready:!!narratives,story_count:(narratives?.stories||0)+personalStories.length,story_revision:narratives?.revision||null,
      scripture_ready:!!scriptureIndex,scripture_books:scriptureIndex?.bookCount||0,
      bible_graph_ready:!!bibleGraph,bible_graph_stats:bibleGraph?.stats||null,bible_graph_narratives:bibleGraph?.narrativeCount||0,
      bridge_ready:!!bridge,bridge_entries:bridge?.entries||0,collections:libraryCounts(),
      collection:metadata.collection,edition:metadata.edition,ai_configured:false,source_url:SOURCE,chat_mode:narratives?'Narrativas bíblicas + temas offline':'Busca contextual local'};
    if(url==='/api/stories')return {stories:[...(narratives?.list()||[]),...listPersonalStories()],associations:personalSnapshot().associations,dictionaryError:personalDataError?.message||''};
    if(url==='/api/stories/save')return queuePersonalWrite(()=>savePersonalStory(payload));
    if(url==='/api/dictionary/aliases')return queuePersonalWrite(async()=>{
      if(JSON.stringify(payload?.previous)!==JSON.stringify(personalAliases))throw Error('O dicionário mudou. Abra a associação novamente.');
      await persistPersonal(personalStories,readAssociations(payload.associations,personalStories));
      return personalSnapshot().associations;
    });
    if(url==='/api/dictionary/export'){await personalWrites;if(personalDataError)throw personalDataError;return personalSnapshot();}
    if(url==='/api/dictionary/restore')return queuePersonalWrite(()=>restorePersonalBackup(payload));
    if(url==='/api/repertoire')return {count:RepertoireStore.marked(hymns).length,
      not_learned:RepertoireStore.marked(hymns).map(song=>({id:song.id,title:song.title,number:song.number,collection:song.collection}))};
    if(url==='/api/repertoire/mark'){
      const song=hymns.find(h=>h.id===Number(payload?.hymn_id));
      if(!song)throw Error('Hino não encontrado para classificação.');
      const result=RepertoireStore.mark(song,payload?.not_learned===true);
      return {ok:true,id:song.id,...result,count:RepertoireStore.marked(hymns).length};
    }
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
