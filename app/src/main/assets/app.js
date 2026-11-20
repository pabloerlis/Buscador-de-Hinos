'use strict';
const $ = id => document.getElementById(id);
const q = (s,root=document) => root.querySelector(s);
const state={ready:false,status:null,originalQuery:'',effectiveQuery:'',exclude:[],semanticHints:[],page:0,total:0,hasMore:false,busy:false,activeModal:null,lastResults:[],currentHymn:null,
  searchSettings:{mode:'balanced',strength:75,narratives:true,related:true,minAffinity:0,pageSize:5,showReasons:true,showConcepts:true,customAliases:{}}};
try{const saved=JSON.parse(localStorage.getItem('hinos-search-preferences-v15')||'{}');state.searchSettings=OfflineAPI.searchOptions(saved);}catch(error){console.warn('Preferências não puderam ser lidas',error.message);}
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let toastTimer=null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),6000);}
async function jsonRequest(url,payload){return OfflineAPI.request(url,payload);}
async function refreshStatus(){
  const result=await jsonRequest('/api/status');state.status=result;state.ready=result.ready;
  $('collection-label').textContent=result.ready?result.collection:'Coletânea não importada';
  $('data-count').textContent=result.ready?`${result.hymn_count} hinos disponíveis`:'Aguardando base';
  $('import-panel').classList.toggle('hidden',result.ready);
  $('refine-mode').textContent=result.semantic_ready?'Busca semântica offline':'Busca contextual local';
  $('settings-collection').textContent=result.collection||'Não importada';
  $('settings-count').textContent=result.hymn_count;
  $('settings-vectors').textContent=result.semantic_ready?`${result.semantic_topics} temas locais`:'Não carregada';
  $('settings-stories').textContent=result.story_ready?`${result.story_count} narrativas locais`:'Não carregada';
  if(typeof GGUF!=='undefined')GGUF.info();
  return result;
}
function busySearch(value){
  state.busy=value; $('search-button').disabled=value;$('refine-send').disabled=value;$('load-more').disabled=value;
  $('search-button').textContent=value?'Buscando…':'Buscar';
  if(!value)$('search-button').innerHTML='Buscar <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
}
function resultCard(hymn){
  const number=hymn.number?`HINO ${escapeHTML(hymn.number)}`:'HINO SEM NÚMERO';
  const tags=(hymn.topics||[]).slice(0,3).map(t=>`<span class="small-tag">${escapeHTML(t)}</span>`).join('');
  const klass=hymn.relevance==='Muito relevante'?'':hymn.relevance==='Relevante'?'mid':'low';
  const scoreLabel=hymn.match_type==='numero'?'número exato':'afinidade estimada';
  const score=Number.isFinite(hymn.relevance_percent)?Math.min(100,Math.max(0,Math.round(hymn.relevance_percent))):0;
  return `<article class="result-card" data-card-id="${Number(hymn.id)}"><div class="result-head"><span class="hymn-number">${number}</span><span class="relevance ${klass}" title="Estimativa heurística de afinidade, não probabilidade ou certeza"><strong>${score}%</strong> ${scoreLabel}</span></div>
  <h3>${escapeHTML(hymn.title)}</h3><div class="score-track" aria-label="Afinidade estimada ${score} por cento"><span style="width:${score}%"></span></div>
  <p class="lyric-quote">“${escapeHTML(hymn.snippet||'Nenhum trecho disponível')}”</p>
  ${hymn.reason?`<p class="why"><strong>Por que foi sugerido:</strong> ${escapeHTML(hymn.reason)}</p>`:''}
  <div class="result-bottom"><div class="tag-row">${tags}</div><button class="view-btn" data-hymn-id="${Number(hymn.id)}" type="button">Ver hino <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div></article>`;
}
function showResults(){$('welcome-panel').classList.add('hidden');$('results-panel').classList.remove('hidden');$('results-panel').scrollIntoView({behavior:'smooth',block:'start'});}
async function performSearch(query,{page=1,refine=false,semanticHints=[],autoAI=true}={}){
  if(state.busy)return false;
  if(!state.ready){toast('Importe a coletânea para começar.');$('import-panel').scrollIntoView({behavior:'smooth',block:'center'});return false;}
  if(!String(query).trim())return false;
  if(page===1){state.originalQuery=query;showResults();$('results-list').innerHTML=Array.from({length:3},()=>'<div class="loading-skeleton"></div>').join('');$('load-more').classList.add('hidden');}
  busySearch(true);let succeeded=false;
  try {
    let data;
    if(page>1)data=await jsonRequest('/api/search',{query:state.effectiveQuery,page,exclude:state.exclude,semantic_hints:state.semanticHints,settings:state.searchSettings});
    else data=await jsonRequest('/api/search',{query,refine,previous:refine?state.effectiveQuery:'',exclude:refine?state.exclude:[],semantic_hints:semanticHints,settings:state.searchSettings});
    if(page===1){
      state.effectiveQuery=data.effective_query;state.exclude=data.excluded||[];state.semanticHints=semanticHints;
      state.lastResults=data.results.slice();
      $('results-list').innerHTML='';$('results-title').textContent=refine?'Pesquisa refinada':'Hinos encontrados';
      $('results-subtitle').textContent=`${data.total} resultado${data.total===1?'':'s'} para “${query}”`;
      const fragments=[];
      if(data.used_ai)fragments.push('IA local sugeriu conceitos; a classificação foi conferida na letra original.');
      else if(refine)fragments.push('Critérios contextuais aplicados localmente.');
      if(data.summary)fragments.push(data.summary);
      if(data.excluded?.length)fragments.push('Excluindo: '+data.excluded.join(', ')+'.');
      $('notice').textContent=fragments.join(' ');$('notice').classList.toggle('hidden',!fragments.length);
      const concepts=data.interpretation||[];
      $('search-diagnostics').classList.toggle('hidden',!concepts.length);
      $('search-concepts').replaceChildren();
      for(const text of concepts){const item=document.createElement('span');item.className='concept-chip';item.textContent=text;$('search-concepts').appendChild(item);}
    }else state.lastResults.push(...data.results);
    state.page=data.page;state.total=data.total;state.hasMore=data.has_more;
    if(data.results.length)$('results-list').insertAdjacentHTML('beforeend',data.results.map(resultCard).join(''));
    else if(page===1)$('results-list').innerHTML='<div class="empty-results"><h3>Nenhum hino encontrado</h3><p>Experimente termos mais gerais, outro tema ou uma frase da letra. Não apresentamos sugestões sem evidência mínima.</p></div>';
    $('load-more').classList.toggle('hidden',!data.has_more);
    $('load-more').textContent='Carregar mais '+data.page_size+' hinos';
    succeeded=true;
  }catch(error){
    if(page===1)$('results-list').innerHTML='<div class="empty-results"><h3>Falha na pesquisa</h3><p>Verifique a coletânea e tente novamente.</p></div>';
    toast(error.message);
  }finally{busySearch(false);}
  if(succeeded && page===1 && autoAI && !semanticHints.length && typeof GGUF!=='undefined') GGUF.maybeAuto(query);
  return succeeded;
}
function appendConversation(kind,text){const el=document.createElement('div');el.className=kind==='user'?'user-message':'assistant-message';el.textContent=text;$('conversation').appendChild(el);$('conversation').scrollTop=$('conversation').scrollHeight;}
async function openHymn(id){
  try{
    const hymn=await jsonRequest(`/api/hymns/${Number(id)}`);state.currentHymn=hymn;
    $('modal-number').textContent=hymn.number?`HINO ${hymn.number}`:'HINO';$('modal-title').textContent=hymn.title;
    $('modal-lyrics').textContent=hymn.lyrics;$('modal-topics').replaceChildren();
    if(hymn.topics?.length)hymn.topics.forEach(t=>{const s=document.createElement('span');s.className='small-tag';s.textContent=t;$('modal-topics').appendChild(s);});
    else $('modal-topics').textContent='Ainda não foram identificados temas automaticamente.';
    $('modal-references').textContent=hymn.references?.length?hymn.references.join(' · '):'Nenhuma referência explícita identificada.';
    $('modal-edition').textContent=`${hymn.collection} · Edição ${hymn.edition}`;
    $('modal-ai-output').classList.add('hidden');$('modal-ai-output').textContent='';
    openLayer('modal');GGUF.info();
  }catch(e){toast(e.message);}
}
function openLayer(name){const el=$(name+'-layer');el.classList.remove('hidden');el.setAttribute('aria-hidden','false');state.activeModal=name;document.body.style.overflow='hidden';q('.icon-button[data-close]',el)?.focus();}
function closeLayer(){if(!state.activeModal)return;const el=$(state.activeModal+'-layer');el.classList.add('hidden');el.setAttribute('aria-hidden','true');state.activeModal=null;document.body.style.overflow='';}
async function importRemote(){
  const buttons=[$('import-remote'),$('settings-import')];buttons.forEach(b=>{b.disabled=true;b.textContent='Importando…';});
  try{const r=await jsonRequest('/api/import-remote',{});toast(`Importação concluída: ${r.count} hinos de ${r.collection}.`);await refreshStatus();closeLayer();}
  catch(e){toast('Não foi possível baixar a coletânea. Use um JSON local ou confira a conexão. '+e.message);}
  finally{buttons[0].disabled=false;buttons[0].textContent='Importar do GitHub';buttons[1].disabled=false;buttons[1].textContent='Atualizar do GitHub';}
}
async function importFile(input){const file=input.files?.[0];if(!file)return;if(file.size>12_000_000){toast('O arquivo precisa ter até 12 MB.');return;}
  try{const data=JSON.parse(await file.text());const response=await jsonRequest('/api/import',{data});toast(`Importados ${response.count} hinos: ${response.collection}.`);await refreshStatus();closeLayer();}
  catch(e){toast('Falha ao importar JSON: '+e.message);}finally{input.value='';}}
$('search-form').addEventListener('submit',ev=>{ev.preventDefault();if(typeof GGUF!=='undefined')GGUF.cancelIfBusy();performSearch($('search-input').value.trim());});
$('refine-form').addEventListener('submit',async ev=>{ev.preventDefault();if(typeof GGUF!=='undefined')GGUF.cancelIfBusy();const message=$('refine-input').value.trim();if(!message||state.busy)return;appendConversation('user',message);$('refine-input').value='';const success=await performSearch(message,{refine:true});appendConversation('assistant',success?`Pesquisa refinada: ${state.total} resultados. Acrescente outra restrição se necessário.`:'Não consegui refinar a pesquisa.');});
$('load-more').addEventListener('click',()=>performSearch(state.effectiveQuery,{page:state.page+1,autoAI:false}));
$('results-list').addEventListener('click',ev=>{const button=ev.target.closest('[data-hymn-id]');if(button)openHymn(button.dataset.hymnId);});
$('new-search').addEventListener('click',()=>{state.effectiveQuery='';state.originalQuery='';state.exclude=[];state.semanticHints=[];state.lastResults=[];$('results-panel').classList.add('hidden');$('welcome-panel').classList.remove('hidden');$('search-input').value='';$('search-input').focus();window.scrollTo({top:0,behavior:'smooth'});$('conversation').innerHTML='<div class="assistant-message">Precisa de algo mais específico? Descreva a mensagem ou ocasião desejada.</div>';});
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{$('search-input').value=b.dataset.suggestion;performSearch(b.dataset.suggestion);}));
$('open-settings').addEventListener('click',()=>openLayer('settings'));$('ai-indicator').addEventListener('click',()=>openLayer('settings'));
$('import-remote').addEventListener('click',importRemote);$('settings-import').addEventListener('click',importRemote);
$('import-file').addEventListener('change',ev=>importFile(ev.target));$('settings-file').addEventListener('change',ev=>importFile(ev.target));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeLayer));document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeLayer();});

// O GGUF nunca gera números de hinos: todas as recomendações são conferidas no JSON local.

// Configurações 1.5 — persistência local e dicionário pessoal; não chamam o GGUF.
const SearchPreferences=(()=>{
  const ids={mode:'search-mode',strength:'semantic-power',minAffinity:'min-affinity',pageSize:'page-size',
    narratives:'story-toggle',related:'related-toggle',showReasons:'explain-toggle',showConcepts:'concepts-toggle'};
  const defaults={mode:'balanced',strength:75,narratives:true,related:true,minAffinity:0,pageSize:5,showReasons:true,showConcepts:true,customAliases:{}};
  let stories=[];
  function renderAliases(){
    const container=$('alias-list');container.replaceChildren();let count=0;
    for(const story of stories){
      for(const term of state.searchSettings.customAliases?.[story.id]||[]){
        count++;
        const row=document.createElement('div');row.className='alias-row';
        const label=document.createElement('span');label.textContent='“'+term+'” → '+story.label;
        const remove=document.createElement('button');remove.textContent='Remover';remove.className='alias-remove';remove.type='button';
        remove.onclick=()=>{const aliases=state.searchSettings.customAliases;
          aliases[story.id]=(aliases[story.id]||[]).filter(t=>t!==term);save();renderAliases();};
        row.append(label,remove);container.appendChild(row);
      }
    }
    if(!count)container.textContent='Nenhuma associação pessoal cadastrada.';
  }
  function fill(){
    const cfg=state.searchSettings;
    for(const [key,id] of Object.entries(ids)){
      const input=$(id);if(input.type==='checkbox')input.checked=cfg[key]!==false;
      else input.value=String(cfg[key]);
    }
    $('semantic-power-value').textContent=cfg.strength+'%';$('min-affinity-value').textContent=cfg.minAffinity+'%';
    renderAliases();
  }
  function readInputs(){
    const options={...state.searchSettings};
    for(const [key,id] of Object.entries(ids)){
      const input=$(id);options[key]=input.type==='checkbox'?input.checked:input.type==='range'||key==='pageSize'?Number(input.value):input.value;
    }
    return OfflineAPI.searchOptions(options);
  }
  function save(){
    state.searchSettings=readInputs();
    localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();
  }
  function refreshSearch(){
    if(state.ready&&state.effectiveQuery)performSearch(state.effectiveQuery,{autoAI:false});
  }
  $('semantic-power').oninput=()=>{$('semantic-power-value').textContent=$('semantic-power').value+'%';};
  $('min-affinity').oninput=()=>{$('min-affinity-value').textContent=$('min-affinity').value+'%';};
  $('settings-search-save').onclick=()=>{save();closeLayer();refreshSearch();toast('Preferências de busca aplicadas.');};
  $('settings-search-reset').onclick=()=>{
    state.searchSettings=OfflineAPI.searchOptions(defaults);localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();toast('Configurações restauradas.');
  };
  $('alias-add').onclick=()=>{
    const term=$('alias-term').value.trim();const id=$('alias-story').value;
    if(term.length<4||term.length>90||!id){toast('Informe uma expressão de 4 a 90 caracteres e uma narrativa.');return;}
    if(!stories.some(s=>s.id===id)){toast('Narrativa indisponível.');return;}
    const aliases=state.searchSettings.customAliases||{};
    if(Object.values(aliases).flat().length>=50){toast('Limite de 50 associações pessoais.');return;}
    aliases[id]=[...new Set([...(aliases[id]||[]),term])];state.searchSettings.customAliases=aliases;
    save();$('alias-term').value='';renderAliases();toast('Associação adicionada.');
  };
  async function initialize(){
    try{const data=await jsonRequest('/api/stories');stories=data.stories||[];
      const select=$('alias-story');select.replaceChildren();
      for(const item of stories){const opt=document.createElement('option');opt.value=item.id;opt.textContent=item.label;select.appendChild(opt);}
    }catch(error){console.warn('Dicionário de narrativas indisponível:',error.message);}
    fill();
  }
  initialize();
  return {fill};
})();

const GGUF=(()=>{
  const native=()=>window.NativeGGUF||null;
  const selectedState={ready:false,busy:false,task:null,lastResult:'',startTime:0,lastQuery:'',autoGeneration:false,lastError:'',timerId:null};
  const aiCache=new Map();
  const MAX_AI_MS=16000;
  const phases={none:'Sem modelo',selected:'Arquivo selecionado',copying:'Copiando GGUF',loading:'Carregando modelo',ready:'Modelo pronto',generating:'IA analisando',error:'Falha ao carregar',unavailable:'Motor indisponível'};
  function nativeStatus(){try{return JSON.parse(native()?.status?.()||'{}');}catch(e){return {};}}
  function setActivity(active,text){$('ai-activity').classList.toggle('hidden',!active);$('ai-progress').textContent=text||'';}
  function showTask(title,detail){$('ai-task').textContent=title;$('ai-detail').textContent=detail;}
  function updateIndicator(status){
    const phase=status.phase||(status.loaded?'ready':status.selected?'selected':'none');
    const active=phase==='copying'||phase==='loading'||phase==='generating';
    $('ai-indicator').className='ai-indicator '+(phase==='ready'?'ai-on':active?'ai-busy':'ai-off');
    $('ai-indicator').textContent='IA: '+(phases[phase]||phase);
    $('ai-state-badge').textContent=phases[phase]||phase;
    if(phase==='copying'){setActivity(true,`Copiando GGUF para o armazenamento privado ${Number.isFinite(status.progress)?status.progress+'%':''}…`);showTask('Cópia autorizada pelo Android','O arquivo será copiado uma única vez e reutilizado em carregamentos futuros, desde que não seja substituído.');}
    if(phase==='loading') {setActivity(true,`Carregando pesos do modelo ${Number.isFinite(status.progress)?status.progress+'%':''}…`);showTask('Carregamento GGUF','O arquivo está sendo mapeado e os pesos estão sendo preparados.');}
    if(phase==='generating'){setActivity(true,'IA sugerindo termos (máximo 16 segundos)…');showTask('IA sugere até 4 temas','Os resultados locais já estão disponíveis. Você pode interromper a IA sem perder a busca.');}
    if(phase==='ready'&&!selectedState.task){setActivity(false);showTask('Busca local pronta; IA opcional','O modelo só sugere palavras-chave. O aplicativo pesquisa, ordena e compara hinos sem IA.');}
    if(phase==='selected'&&!selectedState.task){setActivity(false);showTask('Modelo selecionado, não carregado','Abra configurações e toque em “Carregar modelo”. Selecionar não significa executar.');}
    if(phase==='error'){setActivity(false);showTask('Modelo não foi carregado','Confira os detalhes do erro nas configurações. A busca offline continua disponível.');}
    if(phase==='none'||phase==='unavailable'){setActivity(false);showTask('Busca local disponível','Você pode carregar um GGUF para interpretação contextual complementar.');}
  }
  function info(){
    const status=nativeStatus();selectedState.ready=Boolean(status.loaded);selectedState.busy=Boolean(status.busy||selectedState.task);
    const available=Boolean(status.available); const phase=status.phase||(status.loaded?'ready':status.selected?'selected':'none');
    $('gguf-select').disabled=!available||selectedState.busy;$('gguf-load').disabled=!available||!status.selected||selectedState.busy;
    $('gguf-improve').disabled=!selectedState.ready||selectedState.busy||!state.lastResults.length;$('gguf-compare').disabled=!state.lastResults.length;
    $('gguf-cancel').disabled=!selectedState.task; if($('ai-cancel'))$('ai-cancel').classList.toggle('hidden',!selectedState.task);
    $('modal-ai-ask').disabled=!state.currentHymn;
    $('modal-ai-ask').textContent='Resumo temático offline';
    $('settings-ai').textContent=phases[phase]||phase;
    const modelName=status.name||'Nenhum arquivo selecionado';
    $('gguf-status').textContent=available?(status.selected?'Arquivo: '+modelName:'Nenhum arquivo selecionado.'):'Motor GGUF indisponível neste aparelho.';
    $('gguf-phase').textContent='Estado: '+(phases[phase]||phase)+((phase==='loading'||phase==='copying')&&Number.isFinite(status.progress)?' · '+status.progress+'%':'');
    const fmt=x=>Number.isFinite(x)&&x>0?Math.round(x)+' MB':'—';
    $('gguf-model-meta').textContent=`Tamanho GGUF: ${fmt(status.modelMB)} · Armazenamento livre: ${fmt(status.storageMB)} · Cache local: ${fmt(status.cachedMB)} · RAM disponível: ${fmt(status.availableMB)} · RAM total: ${fmt(status.totalMB)} · Memória nativa usada: ${fmt(status.nativeMB)}. Valores aproximados, sujeitos às restrições do Android.`;
    if(status.lastError){$('gguf-last').textContent='Erro mais recente: '+status.lastError;}
    else if(status.lastDurationMs>0){$('gguf-last').textContent=`Última execução: ${Math.round(status.lastDurationMs/1000)} s`;}
    $('gguf-banner').classList.toggle('hidden',!state.ready||(!selectedState.ready&&!selectedState.busy));
    $('ai-workspace').classList.toggle('hidden',!selectedState.ready&&!selectedState.busy);
    $('gguf-banner-text').textContent=selectedState.ready?'Busca local pronta. IA disponível somente para sugerir termos.':'Busca local pronta. Para sugestões de IA, carregue um GGUF em Configurações.';
    updateIndicator(status);
    return status;
  }
  function resetTask(message,failed=false){
    if(selectedState.timerId){clearTimeout(selectedState.timerId);selectedState.timerId=null;}
    selectedState.task=null;setActivity(false);
    $('ai-timer').textContent='';$('ai-last').textContent=message;
    if(failed){toast(message);showTask('IA encontrou um erro','A pesquisa local permanece disponível. Veja o erro nas configurações.');}
    else showTask('Análise concluída',message);
    info();
  }
  function cancelIfBusy(){
    if(!selectedState.task)return;
    if(native()?.cancel)native().cancel();
    // Mantém a tarefa registrada até o motor confirmar que parou.
    showTask('Interrompendo IA','A busca local continua disponível, sem aguardar o GGUF.');
  }
  function startTask(type,prompt,query){
    if(selectedState.task||!selectedState.ready||!native()?.generate)return false;
    selectedState.task={type,query};selectedState.startTime=Date.now();
    setActivity(true,'Gerando até quatro termos de busca…');
    showTask('IA opcional: expansão da consulta','Resultado local já exibido. A IA não lê nem classifica as letras.');
    $('ai-last').textContent='';info();
    selectedState.timerId=setTimeout(()=>{
      if(selectedState.task){cancelIfBusy();$('ai-last').textContent='Limite de 16 s: interrompendo GGUF. Busca offline preservada.';}
    },MAX_AI_MS);
    native().generate(prompt.slice(0,1150));return true;
  }
  function hintsFromText(text){
    // Aceita apenas labels já reconhecidas pela taxonomia semântica; ignora pensamentos e dados inventados.
    const withoutThink=String(text).replace(/<think>[\s\S]*?<\/think>/gi,' ').replace(/<\|[^>]*\|>/g,' ');
    const raw=withoutThink.split(/[,;\n|]+/).map(x=>x.replace(/^[\s\d.\-:*]+/g,'').replace(/[\s.]+$/g,'')).filter(Boolean);
    return OfflineAPI.validateHints(raw);
  }
  function maybeAuto(query){
    if(!selectedState.ready||selectedState.task||!$('gguf-auto').checked||!state.ready)return;
    if(/^(?:hino\s*)?\d{1,4}$/i.test(query.trim()))return;
    // Não gerar textos quando a taxonomia já encontrou termos exatos.
    if(aiCache.has(OfflineAPI.normalize(query))){
      const cached=aiCache.get(OfflineAPI.normalize(query));
      if(cached.length)performSearch(query,{semanticHints:cached,autoAI:false});
      return;
    }
    interpret(query);
  }
  function interpret(query){
    if(!query||!query.trim())return;
    const key=OfflineAPI.normalize(query);
    if(aiCache.has(key)){
      const hints=aiCache.get(key);
      if(hints.length){appendConversation('assistant','Termos da IA em cache: '+hints.join(', '));performSearch(query,{semanticHints:hints,autoAI:false});}
      else toast('Nenhum tema útil foi identificado anteriormente para essa consulta.');
      return;
    }
    const labels=OfflineAPI.semanticLabels();
    const prompt='/no_think\nSem explicações, sem raciocínio. Escolha até 4 temas do vocabulário abaixo adequados à pesquisa. Responda SOMENTE nomes de temas separados por vírgula.\nTemas: '+labels.join(', ')+'.\nPesquisa: '+query.slice(0,160)+'\nResposta:';
    startTask('interpret',prompt,query);
  }
  function compare(){
    const selected=state.lastResults.slice(0,5);
    if(!selected.length){toast('Primeiro faça uma pesquisa.');return;}
    const text='Comparação offline por afinidade estimada (não são probabilidades):\n'+selected.map((h,i)=>`${i+1}. Hino ${h.number||'?'} — ${h.title}: ${h.relevance_percent}% — ${h.reason}`).join('\n');
    appendConversation('assistant',text);
    $('ai-last').textContent='Cinco hinos comparados pelo índice local, sem GGUF.';
    showTask('Comparação offline concluída','Foi usado o mesmo ranking explicado nas letras.');
  }
  function detail(){
    const h=state.currentHymn;if(!h)return;
    const themes=(h.topics||[]).slice(0,6).join(', ')||'Nenhum tema reconhecido';
    $('modal-ai-output').textContent='Temas identificados pelo índice offline: '+themes+'. Verifique a letra antes de selecionar o hino.';
    $('modal-ai-output').classList.remove('hidden');
  }
  window.__ggufNativeEvent=(event,ok,value)=>{
    if(event==='phase'){info();return;}
    if(event==='selection'){if(ok)toast('Modelo selecionado: '+value);else if(value!=='Seleção cancelada.')toast(value);info();return;}
    if(event==='load'){if(ok)toast('GGUF carregado e pronto para execução.');else toast('Falha ao carregar GGUF: '+value);info();return;}
    if(event!=='generate')return;
    const task=selectedState.task;selectedState.task=null;
    if(!ok){resetTask('IA falhou: '+value,true);return;}
    const answer=String(value).trim();
    if(!task){resetTask('Resposta recebida, sem tarefa ativa.');return;}
    if(task.type==='interpret'){
      if(task.query!==state.originalQuery&&task.query!==state.effectiveQuery){resetTask('Consulta alterada; termos da IA descartados.');return;}
      const hints=hintsFromText(answer);aiCache.set(OfflineAPI.normalize(task.query),hints);
      if(aiCache.size>25)aiCache.delete(aiCache.keys().next().value);
      if(!hints.length){resetTask('IA não sugeriu termos válidos. A busca offline continua disponível.');return;}
      appendConversation('assistant','A IA sugeriu estes termos: '+hints.join(', ')+'. Reclassificando pela base offline.');
      performSearch(state.effectiveQuery,{semanticHints:hints,autoAI:false}).then(ok=>resetTask(ok?'Resultados refinados com '+hints.length+' tema(s) sugerido(s) pela IA.':'Não foi possível aplicar os termos; busca local preservada.',!ok));
    }
  };
  $('gguf-select').addEventListener('click',()=>{if(native()?.selectModel)native().selectModel();});
  $('gguf-load').addEventListener('click',()=>{if(native()?.loadModel)native().loadModel();});
  $('gguf-improve').addEventListener('click',()=>interpret(state.effectiveQuery||state.originalQuery));
  $('gguf-cancel').addEventListener('click',cancelIfBusy);if($('ai-cancel'))$('ai-cancel').addEventListener('click',cancelIfBusy);
  $('gguf-compare').addEventListener('click',compare);$('modal-ai-ask').addEventListener('click',detail);
  // Em atualizações antigas a IA estava ligada automaticamente. Na 1.4 fica desligada inicialmente.
  const savedAuto=localStorage.getItem('hinos-gguf-auto-v15');$('gguf-auto').checked=savedAuto==='1';
  $('gguf-auto').addEventListener('change',()=>localStorage.setItem('hinos-gguf-auto-v15',$('gguf-auto').checked?'1':'0'));
  setInterval(()=>{const status=info();if((status.phase==='copying'||status.phase==='loading'||status.phase==='generating')&&selectedState.startTime){$('ai-timer').textContent=Math.round((Date.now()-selectedState.startTime)/1000)+' s';}},1250);
  info();return {info,maybeAuto,cancelIfBusy};
})();
refreshStatus().catch(e=>toast('Não foi possível acessar a base local: '+e.message));
