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
    if (!initialized)initialized=(async()=>{const cache=await readCache();if(cache&&Array.isArray(cache.hymns)){hymns=cache.hymns;metadata=cache.metadata;} })().catch(e=>{initialized=null;throw e;});
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
      next.push({id:next.length+1,number,title:parsed.title,lyrics,collection,edition,searchable,titleNorm,topics:themes(parsed.title+' '+lyrics)});
      if(i&&i%100===0)await yieldThread();
    }
    if(!next.length)throw Error('Nenhum hino válido neste JSON.');
    const newMeta={collection,edition,hymn_count:next.length};
    await writeCache({hymns:next,metadata:newMeta});
    hymns=next;metadata=newMeta;
    return {ok:true,collection,edition,count:hymns.length};
  }
  function makeSnippet(song,qTokens,selectedTopics){
    const lines=song.lyrics.split(/\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    if(!lines.length)return '';
    const clues=qTokens.concat(selectedTopics.flatMap(t=>THEME_WORDS[t]||[]).filter(w=>w.length>=4));
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
  function search(payload){
    let query=String(payload?.query||'').trim();if(!query||query.length>500)throw Error('Digite uma consulta de até 500 caracteres.');
    const page=Math.max(1,Math.min(100,Number(payload.page)||1));
    const inherited=(Array.isArray(payload?.exclude)?payload.exclude:[]).filter(x=>typeof x==='string'&&x.length<=80).slice(0,4);
    const fresh=/\b(nova busca|recomecar|do zero|esqueca anterior)\b/i.test(normalize(query));
    const ctx=payload?.refine?contextQuery(query,payload.previous):{query,excluded:inherited};
    query=ctx.query;
    const excluded=payload?.refine? [...new Set([...(fresh?[]:inherited),...ctx.excluded])].slice(0,4):ctx.excluded;
    if(!query)return {results:[],page,total:0,has_more:false,effective_query:query,excluded,used_ai:false,summary:'Nenhum critério positivo informado.'};
    const norm=normalize(query), numberMatch=norm.match(/^(?:hino\s*|louvor\s*)?(\d{1,4})$/);
    const selectedTopics=themes(query),qTokens=tokens(query);
    const excludedNorm=excluded.map(normalize);
    const ranked=[];
    for(const song of hymns){
      let score=0;const evidence=[];
      if(numberMatch){
        if(!song.number||Number(song.number)!==Number(numberMatch[1]))continue;
        score=100;evidence.push('número exato');
      }else{
        if(norm.length>3 && song.titleNorm.includes(norm)){score+=18;evidence.push('título relacionado à pesquisa');}
        else if(norm.length>5&&song.searchable.includes(norm)){score+=14;evidence.push('trecho diretamente relacionado à pesquisa');}
        const titleWords=song.titleNorm.split(' ');
        for(const token of qTokens){
          if(titleWords.includes(token))score+=5.2;
          if(hasWord(song.searchable,token))score+=2.3;
          else if(token.length>=5&&song.searchable.includes(token.slice(0,5)))score+=0.6;
        }
        const matching=selectedTopics.filter(t=>song.topics.includes(t));
        score+=matching.length*6.5;
        if(matching.length)evidence.push('tema: '+matching.slice(0,2).join(', ').toLowerCase());
        for(const t of selectedTopics){
          const synonyms=(THEME_WORDS[t]||[]).filter(w=>!qTokens.includes(w)&&w.length>=4);
          const count=synonyms.reduce((n,w)=>n+(hasWord(song.searchable,w)?1:0),0);
          score+=Math.min(3.5,count*.65);
        }
      }
      if(excludedNorm.some(t=>t&&(hasWord(song.searchable,t)||song.topics.some(topic=>normalize(topic)===t))))continue;
      if(score<7)continue;
      const matchedTokens=qTokens.filter(x=>song.searchable.includes(x));
      const reason=evidence.length?'Correspondência identificada na letra ou no título ('+evidence.slice(0,2).join('; ')+').':matchedTokens.length?'A letra contém termos relacionados: '+matchedTokens.slice(0,3).join(', ')+'.':'Possível relação temática; confira a letra antes de utilizar.';
      ranked.push({id:song.id,number:song.number,title:song.title,collection:song.collection,edition:song.edition,topics:song.topics.slice(0,7),snippet:makeSnippet(song,qTokens,selectedTopics),reason,relevance_score:Math.round(score*100)/100,relevance:score>=17?'Muito relevante':score>=10?'Relevante':'Relacionado'});
    }
    ranked.sort((a,b)=>b.relevance_score-a.relevance_score||(a.number||'9999').localeCompare(b.number||'9999')||a.id-b.id);
    const from=(page-1)*5;
    return {page,total:ranked.length,has_more:from+5<ranked.length,results:ranked.slice(from,from+5),topics:selectedTopics,effective_query:query,excluded,used_ai:false,summary:''};
  }
  function hymnDetail(id){
    const song=hymns.find(s=>s.id===id);if(!song)throw Error('Hino não encontrado.');
    const refs=Array.from(new Set(song.lyrics.match(REFERENCE)||[])).slice(0,15);
    return {...song,topics:song.topics.slice(0,12),references:refs};
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
    if(url==='/api/status')return {ready:hymns.length>0,hymn_count:hymns.length,vector_count:0,collection:metadata.collection,edition:metadata.edition,ai_configured:false,source_url:SOURCE,chat_mode:'Busca contextual local'};
    if(url==='/api/import')return importJson(payload.data);
    if(url==='/api/import-remote')return downloadRemote();
    if(url==='/api/search')return search(payload);
    const match=url.match(/^\/api\/hymns\/(\d+)$/);
    if(match)return hymnDetail(Number(match[1]));
    throw Error('Operação não reconhecida.');
  }
  return {request,normalize,themes,parseTitle,chooseCollection,contextQuery};
})();
