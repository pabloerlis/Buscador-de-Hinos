'use strict';
const $ = id => document.getElementById(id);
const q = (s,root=document) => root.querySelector(s);
const state={ready:false,status:null,originalQuery:'',effectiveQuery:'',exclude:[],semanticHints:[],page:0,total:0,hasMore:false,busy:false,activeModal:null,lastResults:[],currentHymn:null,searchRootQuery:'',hymnTrail:[],modalSequence:0,vectorQuery:null,searchEpoch:0,
  searchSettings:{vectorMode:'balanced',mode:'balanced',strength:75,narratives:true,related:true,scripture:true,bridge:true,bibleGraph:true,bibleLinks:true,bibleDepth:1,minAffinity:0,pageSize:5,showReasons:true,showConcepts:true,bibleGraph:true,bibleLinks:true,bibleDepth:1,customAliases:{},recWeight:65,recCount:5,recContext:true,recAvoidVisited:true,recBreakdown:true}};
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
  $('upgrade-panel').classList.toggle('hidden',!result.ready||((result.collections?.avulsos||0)>0&&(result.collections?.cia||0)>0));
  $('refine-mode').textContent=result.semantic_ready?'Busca semântica offline':'Busca contextual local';
  $('settings-collection').textContent=result.collection||'Não importada';
  $('settings-count').textContent=result.hymn_count;
  RepertoireUI.renderManagement().catch(error=>console.warn('Repertório:',error.message));
  $('settings-collection-counts').textContent=Object.entries(result.collections||{}).filter(([,count])=>count>0).map(([id,count])=>id+': '+count).join(' · ')||'Nenhuma';
  for(const id of ['principal','avulsos','cia','pessoal']){
    const count=(result.collections||{})[id]||0;
    $('count-'+id).textContent='('+count+')';
    $('quick-count-'+id).textContent=count||'';
  }
  $('settings-vectors').textContent=result.semantic_ready?`${result.semantic_topics} temas locais`:'Não carregada';
  $('settings-stories').textContent=result.story_ready?`${result.story_count} narrativas locais`:'Não carregada';
  $('settings-scripture').textContent=result.scripture_ready?`${result.scripture_books} livros · Bíblia Livre`:'Indisponível';
  $('settings-bible-graph').textContent=result.bible_graph_ready?`${result.bible_graph_stats?.verse_topics||0} versículos com temas · ${result.bible_graph_narratives} narrativas`:'Indisponível';
  $('settings-embeddings').textContent=result.vector_count?`${result.vector_count} hinos · E5 Small`:'Não disponível para esta coletânea';
  $('settings-bridge').textContent=result.bridge_ready?`${result.bridge_entries} associações`:'Indisponível';
  if(typeof GGUF!=='undefined')GGUF.info();
  return result;
}
function busySearch(value){
  state.busy=value; $('search-button').disabled=value;$('refine-send').disabled=value;$('load-more').disabled=value;
  $('search-button').textContent=value?'Buscando…':'Buscar';
  if(!value)$('search-button').innerHTML='Buscar <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
}
function resultCard(hymn,{unlearned=false}={}){
  const number=hymn.number?`HINO ${escapeHTML(hymn.number)}`:'HINO SEM NÚMERO';
  const collection=`<span class="library-tag">${escapeHTML(hymn.collection||'Importados')}</span>`;
  const tags=(hymn.topics||[]).slice(0,3).map(t=>`<span class="small-tag">${escapeHTML(t)}</span>`).join('');
  const klass=hymn.relevance==='Muito relevante'?'':hymn.relevance==='Relevante'?'mid':'low';
  const scoreLabel=hymn.match_type==='numero'?'número exato':hymn.match_type==='vetorial'?'semântica E5':'afinidade estimada';
  const score=Number.isFinite(hymn.relevance_percent)?Math.min(100,Math.max(0,Math.round(hymn.relevance_percent))):0;
  return `<article class="result-card ${unlearned?'is-unlearned':''}" data-card-id="${Number(hymn.id)}"><div class="result-head"><span class="hymn-number">${number}</span><span class="relevance ${klass}" title="Estimativa heurística de afinidade, não probabilidade ou certeza"><strong>${score}%</strong> ${scoreLabel}</span></div>
  <h3>${escapeHTML(hymn.title)}</h3>${collection}<div class="score-track" aria-label="Afinidade estimada ${score} por cento"><span style="width:${score}%"></span></div>
  <p class="lyric-quote">“${escapeHTML(hymn.snippet||'Nenhum trecho disponível')}”</p>
  ${hymn.reason?`<p class="why"><strong>Por que foi sugerido:</strong> ${escapeHTML(hymn.reason)}</p>`:''}
  <div class="result-bottom"><div class="tag-row">${tags}</div><button class="repertoire-action ${unlearned?'undo':''}" type="button" data-repertoire-id="${Number(hymn.id)}" data-not-learned="${unlearned?'false':'true'}">${unlearned?'Marcar como aprendido':'Ainda não aprendido'}</button><button class="view-btn" data-hymn-id="${Number(hymn.id)}" type="button">Ver hino <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div></article>`;
}
function showResults(){$('welcome-panel').classList.add('hidden');$('results-panel').classList.remove('hidden');$('results-panel').scrollIntoView({behavior:'smooth',block:'start'});}
async function performSearch(query,{page=1,refine=false,semanticHints=[],autoAI=true,retainRoot=false}={}){
  if(state.busy)return false;
  if(!state.ready){toast('Importe a coletânea para começar.');$('import-panel').scrollIntoView({behavior:'smooth',block:'center'});return false;}
  if(!String(query).trim())return false;
  if(page===1){state.searchEpoch++;state.vectorQuery=null;if(!refine&&!retainRoot)state.searchRootQuery=query;state.originalQuery=query;state.hymnTrail=[];showResults();$('results-list').innerHTML=Array.from({length:3},()=>'<div class="loading-skeleton"></div>').join('');$('load-more').classList.add('hidden');}
  busySearch(true);let succeeded=false;let isBibleSearch=false;
  try {
    let data;
    if(page>1)data=await jsonRequest('/api/search',{query:state.effectiveQuery,page,exclude:state.exclude,semantic_hints:state.semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
    else data=await jsonRequest('/api/search',{query,refine,previous:refine?state.effectiveQuery:'',exclude:refine?state.exclude:[],semantic_hints:semanticHints,settings:state.searchSettings});
    if(page===1){
      isBibleSearch=!!(data.bible_reference&&state.searchSettings.bibleGraph);
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
    else if(page===1)$('results-list').innerHTML=data.not_learned_total?'<div class="empty-results"><h3>Sem hinos disponíveis para indicação</h3><p>Os hinos relacionados estão na seção «Não aprendidos» abaixo.</p></div>':'<div class="empty-results"><h3>Nenhum hino encontrado</h3><p>Experimente termos mais gerais, outro tema ou uma frase da letra. Não apresentamos sugestões sem evidência mínima.</p></div>';
    $('load-more').classList.toggle('hidden',!data.has_more);
    if(page===1)RepertoireUI.renderSearch(data);
    $('load-more').textContent='Carregar mais '+data.page_size+' hinos';
    succeeded=true;
  }catch(error){
    if(page===1)$('results-list').innerHTML='<div class="empty-results"><h3>Falha na pesquisa</h3><p>Verifique a coletânea e tente novamente.</p></div>';
    toast(error.message);
  }finally{busySearch(false);}
  if(succeeded&&page===1&&!isBibleSearch)EmbeddingSearch.maybeUpdate(state.effectiveQuery,state.searchEpoch);
  if(succeeded && page===1 && !isBibleSearch && autoAI && !semanticHints.length && typeof GGUF!=='undefined') GGUF.maybeAuto(query);
  return succeeded;
}
function appendConversation(kind,text){const el=document.createElement('div');el.className=kind==='user'?'user-message':'assistant-message';el.textContent=text;$('conversation').appendChild(el);$('conversation').scrollTop=$('conversation').scrollHeight;}
function relatedCard(hymn,{unlearned=false}={}){
  const percent=Math.min(100,Math.max(0,Number(hymn.compatibility_percent)||0));
  const components=Number.isFinite(hymn.similarity_percent)?`<span>${Math.round(hymn.similarity_percent)}% com a letra</span>${Number.isFinite(hymn.query_percent)?`<span>${Math.round(hymn.query_percent)}% com a busca</span>`:''}`:'';
  return `<div class="related-entry ${unlearned?'is-unlearned':''}"><button class="related-card" type="button" data-related-id="${Number(hymn.id)}" aria-label="Abrir hino ${escapeHTML(hymn.number||'')} ${escapeHTML(hymn.title)}; ${percent}% de afinidade combinada">
    <span class="related-card-top"><span>HINO ${escapeHTML(hymn.number||'—')}</span><strong>${percent}% <small>compatível</small></strong></span>
    <span class="related-card-title">${escapeHTML(hymn.title)}</span><span class="library-tag">${escapeHTML(hymn.collection||'Importados')}</span>
    <span class="score-track related-track"><span style="width:${percent}%"></span></span>
    ${components?`<span class="related-components">${components}</span>`:''}
    <span class="related-evidence">${escapeHTML(hymn.reason||'Associação temática encontrada nas letras.')}</span>
    <span class="related-open">Ver hino e novas sugestões ›</span>
  </button><button class="repertoire-action ${unlearned?'undo':''}" type="button" data-repertoire-id="${Number(hymn.id)}" data-not-learned="${unlearned?'false':'true'}">${unlearned?'Marcar como aprendido':'Ainda não aprendido'}</button></div>`;
}
async function renderRecommendations(hymn){
  const seq=state.modalSequence;
  $('related-back').classList.toggle('hidden',state.hymnTrail.length<2);
  $('related-trail').textContent=state.hymnTrail.length>1?`${state.hymnTrail.length}º hino da sequência`: 'Início da descoberta';
  $('related-list').innerHTML='<p class="subtle-note">Comparando hinos da coletânea…</p>';
  try{
    const response=await jsonRequest('/api/recommend',{hymn_id:hymn.id,original_query:state.searchRootQuery,
      active_query:state.effectiveQuery,visited:state.hymnTrail,settings:state.searchSettings});
    if(seq!==state.modalSequence)return;
    $('related-description').textContent=response.original_query
      ?`Afinidade combinada: ${response.weight_percent}% com o hino aberto e ${100-response.weight_percent}% com a busca inicial “${response.original_query}”.`
      :'Afinidade calculada somente com a letra, os temas e as narrativas do hino aberto.';
    RepertoireUI.renderRelated(response);
    $('related-list').innerHTML=response.results.length?response.results.map(relatedCard).join(''):
      '<p class="subtle-note">Não encontrei outros hinos suficientemente relacionados. Experimente reduzir o filtro de já visitados nas Configurações.</p>';
  }catch(error){if(seq===state.modalSequence)$('related-list').textContent='Não foi possível calcular as recomendações: '+error.message;}
}
async function openHymn(id,{fromRelated=false,back=false}={}){
  const sequence=++state.modalSequence;
  try{
    const hymn=await jsonRequest(`/api/hymns/${Number(id)}`);if(sequence!==state.modalSequence)return;
    if(back){const index=state.hymnTrail.lastIndexOf(hymn.id);if(index>=0)state.hymnTrail=state.hymnTrail.slice(0,index+1);}
    else if(fromRelated){state.hymnTrail.push(hymn.id);if(state.hymnTrail.length>50)state.hymnTrail.shift();}
    else state.hymnTrail=[hymn.id];
    state.currentHymn=hymn;
    $('modal-number').textContent=hymn.number?`HINO ${hymn.number}`:'HINO';$('modal-title').textContent=hymn.title;
    $('modal-lyrics').textContent=hymn.lyrics;$('modal-topics').replaceChildren();
    if(hymn.topics?.length)hymn.topics.forEach(t=>{const s=document.createElement('span');s.className='small-tag';s.textContent=t;$('modal-topics').appendChild(s);});
    else $('modal-topics').textContent='Ainda não foram identificados temas automaticamente.';
    $('modal-references').textContent=hymn.references?.length?hymn.references.join(' · '):'Nenhuma referência explícita identificada.';
    $('modal-edition').textContent=(hymn.collectionRefs||[]).map(ref=>ref.name+(ref.number?' nº '+ref.number:'')).join(' · ') || `${hymn.collection} · Edição ${hymn.edition}`;
    $('modal-ai-output').classList.add('hidden');$('modal-ai-output').textContent='';
    RepertoireUI.renderModal(hymn);
    if(state.activeModal!=='modal')openLayer('modal');
    else q('.modal-body')?.scrollTo({top:0,behavior:'instant'});
    GGUF.info();await renderRecommendations(hymn);
  }catch(e){toast(e.message);}
}
$('related-list').addEventListener('click',event=>{
  if(event.target.closest('[data-repertoire-id]'))return;
  const b=event.target.closest('[data-related-id]');if(b)openHymn(Number(b.dataset.relatedId),{fromRelated:true});
});
$('related-back').addEventListener('click',()=>{
  if(state.hymnTrail.length>1){const prior=state.hymnTrail[state.hymnTrail.length-2];openHymn(prior,{back:true});}
});
function openLayer(name){const el=$(name+'-layer');el.classList.remove('hidden');el.setAttribute('aria-hidden','false');state.activeModal=name;document.body.style.overflow='hidden';q('.icon-button[data-close]',el)?.focus();}
function closeLayer(){if(!state.activeModal)return;const el=$(state.activeModal+'-layer');el.classList.add('hidden');el.setAttribute('aria-hidden','true');state.activeModal=null;document.body.style.overflow='';}
async function importRemote(){
  const buttons=[$('import-remote'),$('settings-import'),$('upgrade-import')];buttons.forEach(b=>{b.disabled=true;b.textContent='Importando…';});
  try{const r=await jsonRequest('/api/import-remote',{});toast(`Biblioteca atualizada: ${r.count} hinos únicos; ${r.added} novos; ${r.duplicates} registros duplicados.`);await refreshStatus();closeLayer();}
  catch(e){toast('Não foi possível baixar a coletânea. Use um JSON local ou confira a conexão. '+e.message);}
  finally{buttons[0].disabled=false;buttons[0].textContent='Importar as 3 coleções';buttons[1].disabled=false;buttons[1].textContent='Atualizar 3 coleções';buttons[2].disabled=false;buttons[2].textContent='Adicionar Avulsos e CIA';}
}
async function importFile(input){const file=input.files?.[0];if(!file)return;if(file.size>12_000_000){toast('O arquivo precisa ter até 12 MB.');return;}
  try{const data=JSON.parse(await file.text());const response=await jsonRequest('/api/import',{data});toast(`Biblioteca: ${response.count} hinos únicos (${response.added} novos).`);await refreshStatus();closeLayer();}
  catch(e){toast('Falha ao importar JSON: '+e.message);}finally{input.value='';}}
$('search-form').addEventListener('submit',ev=>{ev.preventDefault();if(typeof GGUF!=='undefined')GGUF.cancelIfBusy();performSearch($('search-input').value.trim());});
$('refine-form').addEventListener('submit',async ev=>{ev.preventDefault();if(typeof GGUF!=='undefined')GGUF.cancelIfBusy();const message=$('refine-input').value.trim();if(!message||state.busy)return;appendConversation('user',message);$('refine-input').value='';const success=await performSearch(message,{refine:true});appendConversation('assistant',success?`Pesquisa refinada: ${state.total} resultados. Acrescente outra restrição se necessário.`:'Não consegui refinar a pesquisa.');});
$('load-more').addEventListener('click',()=>performSearch(state.effectiveQuery,{page:state.page+1,autoAI:false}));
$('results-list').addEventListener('click',ev=>{const button=ev.target.closest('[data-hymn-id]');if(button)openHymn(button.dataset.hymnId);});
$('new-search').addEventListener('click',()=>{state.effectiveQuery='';state.originalQuery='';state.searchRootQuery='';state.hymnTrail=[];state.exclude=[];state.semanticHints=[];state.lastResults=[];state.vectorQuery=null;state.searchEpoch++;$('results-panel').classList.add('hidden');$('welcome-panel').classList.remove('hidden');$('search-input').value='';$('search-input').focus();window.scrollTo({top:0,behavior:'smooth'});$('conversation').innerHTML='<div class="assistant-message">Precisa de algo mais específico? Descreva a mensagem ou ocasião desejada.</div>';});
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{$('search-input').value=b.dataset.suggestion;performSearch(b.dataset.suggestion);}));
$('open-settings').addEventListener('click',()=>openLayer('settings'));$('ai-indicator').addEventListener('click',()=>openLayer('settings'));
$('import-remote').addEventListener('click',importRemote);$('settings-import').addEventListener('click',importRemote);$('upgrade-import').addEventListener('click',importRemote);
$('import-file').addEventListener('change',ev=>importFile(ev.target));$('settings-file').addEventListener('change',ev=>importFile(ev.target));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeLayer));document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeLayer();});

// O GGUF nunca gera números de hinos: todas as recomendações são conferidas no JSON local.

// Configurações 1.5 — persistência local e dicionário pessoal; não chamam o GGUF.
const SearchPreferences=(()=>{
  const ids={vectorMode:'vector-mode',mode:'search-mode',strength:'semantic-power',minAffinity:'min-affinity',pageSize:'page-size',
    narratives:'story-toggle',related:'related-toggle',scripture:'scripture-toggle',bridge:'bridge-toggle',bibleGraph:'bible-graph-toggle',bibleLinks:'bible-links-toggle',bibleDepth:'bible-depth',showReasons:'explain-toggle',showConcepts:'concepts-toggle',
    recWeight:'rec-weight',recCount:'rec-count',recContext:'rec-context',recAvoidVisited:'rec-visited',recBreakdown:'rec-breakdown'};
  const defaults={collections:{principal:true,avulsos:true,cia:true,pessoal:true},vectorMode:'balanced',mode:'balanced',strength:75,narratives:true,related:true,minAffinity:0,pageSize:5,showReasons:true,showConcepts:true,bibleGraph:true,bibleLinks:true,bibleDepth:1,customAliases:{},recWeight:65,recCount:5,recContext:true,recAvoidVisited:true,recBreakdown:true};
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
    $('rec-weight-value').textContent=cfg.recWeight+'%';$('semantic-power-value').textContent=cfg.strength+'%';$('min-affinity-value').textContent=cfg.minAffinity+'%';
    for(const id of ['principal','avulsos','cia','pessoal']){
      $('collection-'+id).checked=cfg.collections[id]!==false;
      const quick=document.querySelector('[data-collection="'+id+'"]');if(quick)quick.checked=cfg.collections[id]!==false;
    }
    renderAliases();
  }
  function readInputs(){
    const options={...state.searchSettings};
    for(const [key,id] of Object.entries(ids)){
      const input=$(id);options[key]=input.type==='checkbox'?input.checked:input.type==='range'||key==='pageSize'||key==='bibleDepth'?Number(input.value):input.value;
    }
    options.collections=Object.fromEntries(['principal','avulsos','cia','pessoal'].map(id=>[id,$('collection-'+id).checked]));
    return OfflineAPI.searchOptions(options);
  }
  function save(){
    state.searchSettings=readInputs();
    localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();
  }
  function refreshSearch(){
    if(state.ready&&state.effectiveQuery)performSearch(state.effectiveQuery,{autoAI:false,retainRoot:true});
  }
  $('rec-weight').oninput=()=>{$('rec-weight-value').textContent=$('rec-weight').value+'%';};
  $('semantic-power').oninput=()=>{$('semantic-power-value').textContent=$('semantic-power').value+'%';};
  $('min-affinity').oninput=()=>{$('min-affinity-value').textContent=$('min-affinity').value+'%';};
  $('settings-search-save').onclick=()=>{save();closeLayer();refreshSearch();toast('Preferências de busca aplicadas.');};
  document.querySelectorAll('[data-collection]').forEach(input=>input.addEventListener('change',()=>{
    const id=input.dataset.collection; $('collection-'+id).checked=input.checked;save();refreshSearch();
  }));
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


// v2.1: repertório conhecido; dados separados das letras e da busca.
const RepertoireUI=(()=>{
  let hiddenPage=1;
  let operation=false;
  function renderSearch(result){
    const drawer=$('not-learned-search');
    const count=Math.max(0,Number(result.not_learned_total)||0);
    drawer.classList.toggle('hidden',count===0);
    $('not-learned-search-count').textContent=String(count);
    hiddenPage=Number(result.not_learned_page)||1;
    $('not-learned-list').innerHTML=(result.not_learned_results||[]).map(h=>resultCard(h,{unlearned:true})).join('');
    $('not-learned-more').classList.toggle('hidden',!result.not_learned_has_more);
  }
  function renderRelated(result){
    const count=Math.max(0,Number(result.not_learned_total)||0);
    $('related-unlearned').classList.toggle('hidden',count===0);
    $('related-unlearned-count').textContent=String(count);
    $('related-unlearned-list').innerHTML=(result.not_learned_results||[]).map(h=>relatedCard(h,{unlearned:true})).join('');
  }
  function renderModal(hymn){
    const unlearned=RepertoireStore.isNotLearned(hymn);
    $('modal-repertoire-status').textContent=unlearned?'Não aprendido pela igreja · fora das indicações principais':'Disponível para indicação';
    const button=$('modal-repertoire-toggle');
    button.textContent=unlearned?'Marcar como aprendido':'Marcar como não aprendido';
    button.dataset.repertoireId=String(hymn.id);
    button.dataset.notLearned=unlearned?'false':'true';
    button.classList.toggle('undo',unlearned);
  }
  async function renderManagement(){
    const data=await jsonRequest('/api/repertoire');
    $('knowledge-count').textContent=`${data.count} hino${data.count===1?'':'s'} não aprendido${data.count===1?'':'s'}`;
    const list=$('knowledge-list');
    list.innerHTML=data.not_learned.length?data.not_learned.map(song=>
      `<div class="knowledge-row"><span><strong>${escapeHTML(song.number||'—')} · ${escapeHTML(song.title)}</strong><small>${escapeHTML(song.collection)}</small></span><button class="repertoire-action undo" type="button" data-repertoire-id="${Number(song.id)}" data-not-learned="false">Aprendido</button></div>`).join(''):
      '<p class="knowledge-empty">Nenhum hino marcado. Todos permanecem disponíveis até serem classificados.</p>';
  }
  async function update(id,flag){
    if(operation)return;
    operation=true;
    try{
      const result=await jsonRequest('/api/repertoire/mark',{hymn_id:Number(id),not_learned:flag});
      toast(flag?'Hino marcado como não aprendido. Continua disponível na seção separada.':'Hino devolvido às indicações principais.');
      state.searchEpoch++; // invalida qualquer atualização vetorial anterior à marcação
      if(state.ready&&state.effectiveQuery){
        const epoch=state.searchEpoch;
        const response=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,exclude:state.exclude,
          semantic_hints:state.semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
        if(epoch===state.searchEpoch){
          state.page=1;state.total=response.total;state.hasMore=response.has_more;state.lastResults=response.results.slice();
          $('results-list').innerHTML=response.results.length?response.results.map(resultCard).join(''):
            response.not_learned_total?'<div class="empty-results"><h3>Todos os hinos relacionados estão em Não aprendidos</h3></div>':'<div class="empty-results"><h3>Nenhum hino encontrado</h3></div>';
          $('load-more').classList.toggle('hidden',!response.has_more);
          $('results-subtitle').textContent=`${response.total} hinos disponíveis para indicação · ${response.not_learned_total} não aprendidos relacionados`;
          renderSearch(response);
        }
      }
      if(state.currentHymn){
        if(Number(state.currentHymn.id)===Number(id))renderModal(state.currentHymn);
        if(state.activeModal==='modal')await renderRecommendations(state.currentHymn);
      }
      await renderManagement();
      return result;
    }catch(error){toast('Não foi possível salvar a classificação: '+error.message);}
    finally{operation=false;}
  }
  // Delegação também atende cartões inseridos depois de novas pesquisas.
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-repertoire-id]');if(!b)return;
    event.preventDefault();event.stopPropagation();
    update(b.dataset.repertoireId,b.dataset.notLearned==='true');
  },true);
  $('not-learned-more').addEventListener('click',async()=>{
    if(operation||!state.effectiveQuery)return;
    operation=true;const next=hiddenPage+1;
    try{
      const response=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,not_learned_page:next,
        exclude:state.exclude,semantic_hints:state.semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
      hiddenPage=next;
      $('not-learned-list').insertAdjacentHTML('beforeend',response.not_learned_results.map(h=>resultCard(h,{unlearned:true})).join(''));
      $('not-learned-more').classList.toggle('hidden',!response.not_learned_has_more);
    }catch(error){toast(error.message);}finally{operation=false;}
  });
  $('not-learned-list').addEventListener('click',event=>{
    const b=event.target.closest('[data-hymn-id]');if(b)openHymn(b.dataset.hymnId);
  });
  $('related-unlearned-list').addEventListener('click',event=>{
    const b=event.target.closest('[data-related-id]');if(b)openHymn(Number(b.dataset.relatedId),{fromRelated:true});
  });
  return {renderSearch,renderRelated,renderModal,renderManagement,update};
})();


// E5 Small: apenas a consulta passa pela rede neural, no próprio Android.
// Busca local aparece ANTES do embedding; erros não bloqueiam nenhuma pesquisa.
const EmbeddingSearch=(()=>{
  const pending=new Map();let sequence=0;
  function status(message){
    const target=$('vector-results-state');if(target)target.textContent=message;
    const settings=$('vector-state');if(settings)settings.textContent=message;
  }
  window.VectorNative={
    progress(event){if(pending.has(String(event.id)))status(event.message||'Calculando embeddings…');},
    complete(event){const item=pending.get(String(event.id));if(!item)return;
      pending.delete(String(event.id));clearTimeout(item.timeout);
      if(event.ok&&Array.isArray(event.vector)&&event.vector.length===384)item.resolve(event);
      else item.reject(Error(event.error||'Modelo de embeddings indisponível'));
    }
  };
  function request(text){return new Promise((resolve,reject)=>{
    const id=String(++sequence);const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Tempo excedido ao calcular embeddings'));},120000);
    pending.set(id,{resolve,reject,timeout});
    try{window.NativeVector.embed(id,text);}catch(e){pending.delete(id);clearTimeout(timeout);reject(e);}
  });}
  async function maybeUpdate(query,epoch){
    if(state.searchSettings.vectorMode==='off'||!state.ready||!state.status?.vector_count)return;
    if(typeof ScriptureIndex!=='undefined'&&ScriptureIndex.parse(query))return;
    if(!window.NativeVector||!/^(?!\s*(?:hino\s*)?\d{1,4}\s*$)/i.test(query))return;
    status('E5 Small: interpretando a consulta no aparelho…');
    try{
      const answer=await request(query);
      if(epoch!==state.searchEpoch||!state.ready||state.searchSettings.vectorMode==='off')return;
      state.vectorQuery=answer.vector;
      const result=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,exclude:state.exclude,
        semantic_hints:state.semanticHints,vector_query:answer.vector,settings:state.searchSettings});
      if(epoch!==state.searchEpoch)return;
      state.total=result.total;state.page=1;state.hasMore=result.has_more;state.lastResults=result.results.slice();
      $('results-list').innerHTML=result.results.length?result.results.map(resultCard).join(''):
        result.not_learned_total?'<div class="empty-results"><h3>Somente hinos ainda não aprendidos</h3><p>Veja a seção separada abaixo.</p></div>':'<div class="empty-results"><h3>Nenhum resultado</h3><p>Experimente ampliar o contexto.</p></div>';
      RepertoireUI.renderSearch(result);
      $('load-more').classList.toggle('hidden',!result.has_more);
      $('load-more').textContent='Carregar mais '+result.page_size+' hinos';
      $('results-subtitle').textContent=`${result.total} resultados · busca híbrida com E5 Small`;
      status('E5 Small: ranking vetorial atualizado em '+(answer.ms/1000).toFixed(1)+'s. Sem internet.');
    }catch(error){if(epoch===state.searchEpoch)status('Busca local preservada · modelo E5: '+error.message);}
  }
  return {maybeUpdate};
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
      performSearch(state.effectiveQuery,{semanticHints:hints,autoAI:false,retainRoot:true}).then(ok=>resetTask(ok?'Resultados refinados com '+hints.length+' tema(s) sugerido(s) pela IA.':'Não foi possível aplicar os termos; busca local preservada.',!ok));
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
