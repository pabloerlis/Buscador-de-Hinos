'use strict';
const $ = id => document.getElementById(id);
const q = (s,root=document) => root.querySelector(s);
const collectionIds = ['principal', 'avulsos', 'cia', 'pessoal'];
const state={ready:false,status:null,originalQuery:'',effectiveQuery:'',exclude:[],deprioritize:[],requiredTerms:[],semanticHints:[],page:0,total:0,hasMore:false,busy:false,activeModal:null,lastResults:[],aiContext:null,exactNumber:false,repertoirePending:false,currentHymn:null,searchRootQuery:'',hymnTrail:[],modalSequence:0,vectorQuery:null,searchEpoch:0,chatPending:null,chatHistory:[],chatAdded:new Map(),chatRemoved:new Set(),chatChoices:null,chatProposal:null,chatQuestions:new Set(),chatBrief:{},
  searchSettings:OfflineAPI.searchOptions()};
try{const saved=JSON.parse(localStorage.getItem('hinos-search-preferences-v15')||'{}');state.searchSettings=OfflineAPI.searchOptions(saved);}catch(error){console.warn('Preferências não puderam ser lidas',error.message);}
if(!window.NativeVector)state.searchSettings.vectorMode='off';
else if(!localStorage.getItem('hinos-search-preferences-v15'))
  state.searchSettings.vectorMode='balanced'; // Ativa E5 por padrão apenas nas novas instalações.
document.documentElement.classList.toggle('with-gguf',Boolean(window.NativeGGUF));
document.documentElement.classList.toggle('with-vector',Boolean(window.NativeVector));
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let toastTimer=null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),6000);}
async function jsonRequest(url,payload){return OfflineAPI.request(url,payload);}
async function refreshStatus(){
  const result=await jsonRequest('/api/status');state.status=result;state.ready=result.ready;
  $('collection-label').textContent=result.ready?result.collection:'Coletânea não importada';
  $('data-count').textContent=result.ready?`${result.hymn_count} hinos disponíveis`:'Aguardando base';
  $('import-panel').classList.toggle('hidden',result.ready);
  $('library-prompt').classList.toggle('hidden',result.ready);
  $('upgrade-panel').classList.toggle('hidden',!result.ready||((result.collections?.avulsos||0)>0&&(result.collections?.cia||0)>0));
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
  const eventStatus=result.event_stats;
  if(eventStatus) $('settings-bible-graph').textContent+=` · ${eventStatus.actionFamilies} grupos de ações`;
  $('settings-embeddings').textContent=result.vector_count?`${result.vector_count} hinos · ${result.vector_status?.passages||0} trechos · E5 Small`:'Não disponível para esta coletânea';
  $('settings-bridge').textContent=result.bridge_ready?`${result.bridge_entries} associações`:'Indisponível';
  if(typeof GGUF!=='undefined')GGUF.info();
  return result;
}
function busySearch(value){
  state.busy=value; $('search-button').disabled=value;$('load-more').disabled=value;
  updateChatControls();
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
  <h3>${escapeHTML(hymn.title)}</h3>${collection}${hymn.curated?'<span class="library-tag">Acrescentado no chat</span>':''}<div class="score-track" aria-label="Afinidade estimada ${score} por cento"><span style="width:${score}%"></span></div>
  <p class="lyric-quote">“${escapeHTML(hymn.snippet||'Nenhum trecho disponível')}”</p>
  ${hymn.aiReview?`<p class="why"><strong>Revisão da IA: ${escapeHTML(hymn.aiReview.label)}</strong>${hymn.aiReview.excerpt?` · “${escapeHTML(hymn.aiReview.excerpt)}”`:''}</p>`:''}
  ${hymn.reason?`<p class="why"><strong>Por que foi sugerido:</strong> ${escapeHTML(hymn.reason)}</p>`:''}
  <div class="result-bottom"><div class="tag-row">${tags}</div><button class="repertoire-action ${unlearned?'undo':''}" type="button" data-repertoire-id="${Number(hymn.id)}" data-not-learned="${unlearned?'false':'true'}">${unlearned?'Marcar como aprendido':'Ainda não aprendido'}</button><button class="view-btn" data-hymn-id="${Number(hymn.id)}" type="button">Ver hino <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div></article>`;
}
function showResults(scroll=true) {
  $('welcome-panel').classList.add('hidden');
  $('results-panel').classList.remove('hidden');
  if(scroll)$('results-panel').scrollIntoView({block:'start'});
}

async function performSearch(query,{page=1,refine=false,semanticHints=[],autoAI=true,preserveContext=false,modelQuery,fromChat=false}={}){
  if(state.busy)return false;
  if(!state.ready){toast('Importe uma coletânea para começar.');selectWorkspace('library');return false;}
  if(!String(query).trim())return false;
  if(page===1){
    state.searchEpoch++;
    GGUF.cancelSearchTask();
    $('gguf-comparison').classList.add('hidden');
    if(!preserveContext){
      state.vectorQuery=null;
      if(!refine){state.searchRootQuery=query;if(!fromChat)clearChatEdits();}
      state.originalQuery=query;
      state.hymnTrail=[];
    }
    if(!preserveContext){showResults(!fromChat);$('results-list').innerHTML=Array.from({length:3},()=>'<div class="loading-skeleton"></div>').join('');$('load-more').classList.add('hidden');}
  }
  busySearch(true);let succeeded=false;let isBibleSearch=false;
  try {
    let data;
    if(page>1)data=await jsonRequest('/api/search',{query:state.effectiveQuery,page,parsed_query:true,...searchRestrictions(),semantic_hints:state.semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
    else if(preserveContext)data=await jsonRequest('/api/search',{query,parsed_query:true,...searchRestrictions(),curated_ids:[...state.chatAdded.keys()],semantic_hints:semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
    else data=await jsonRequest('/api/search',{query,refine,previous:refine?state.effectiveQuery:'',...(refine?searchRestrictions():{}),curated_ids:[...state.chatAdded.keys()],model_query:refine?modelQuery:undefined,semantic_hints:semanticHints,settings:state.searchSettings});
    if(page===1){
      isBibleSearch=!!(data.bible_reference&&state.searchSettings.bibleGraph);
      state.effectiveQuery=data.effective_query;state.exclude=data.excluded||[];state.deprioritize=data.deprioritized||[];state.requiredTerms=data.required||[];state.semanticHints=semanticHints;
      if(data.reset_context)clearChatEdits();
      if(data.curated_ids)state.chatEligible=new Set(data.curated_ids);
      if(data.reset_context||(!refine&&!preserveContext))state.searchRootQuery=state.effectiveQuery;
      state.lastResults=data.results.slice();
      state.aiContext=data.ai_context;
      state.modelRefinement=data.model_refinement||'';
      state.exactNumber=Boolean(data.exact_number);
      $('results-list').innerHTML='';$('results-title').textContent=refine?'Pesquisa refinada':'Hinos encontrados';
      $('results-subtitle').textContent=`${data.total} resultado${data.total===1?'':'s'} para “${query}”`;
      const fragments=[];
      if(data.model_refinement)fragments.push('Consulta reformulada pela IA local.');
      else if(data.used_ai)fragments.push('IA local sugeriu conceitos; a classificação foi conferida na letra original.');
      else if(refine)fragments.push('Critérios contextuais aplicados localmente.');
      if(data.summary)fragments.push(data.summary);
      if(data.excluded?.length)fragments.push('Excluindo: '+data.excluded.join(', ')+'.');
      if(data.deprioritized?.length)fragments.push('Menor prioridade para '+data.deprioritized.join(', ')+'.');
      if(data.required?.length)fragments.push('Critérios obrigatórios: '+data.required.join(', ')+'.');
      $('notice').textContent=fragments.join(' ');$('notice').classList.toggle('hidden',!fragments.length);
      const concepts=data.interpretation||[];
      $('search-diagnostics').classList.toggle('hidden',!concepts.length);
      $('search-concepts').replaceChildren();
      for(const text of concepts){const item=document.createElement('span');item.className='concept-chip';item.textContent=text;$('search-concepts').appendChild(item);}
    }else state.lastResults.push(...data.results);
    state.page=data.page;state.total=data.total;state.hasMore=data.has_more;
    if(!renderCuratedResults()){
      if(data.results.length)$('results-list').insertAdjacentHTML('beforeend',data.results.map(resultCard).join(''));
      else if(page===1)$('results-list').innerHTML=data.not_learned_total?'<div class="empty-results"><h3>Sem hinos disponíveis para indicação</h3><p>Os hinos relacionados estão na seção «Não aprendidos» abaixo.</p></div>':'<div class="empty-results"><h3>Nenhum hino encontrado</h3><p>Experimente termos mais gerais, outro tema ou uma frase da letra. Não apresentamos sugestões sem evidência mínima.</p></div>';
    }
    $('load-more').classList.toggle('hidden',!data.has_more);
    if(page===1)RepertoireUI.renderSearch(data);
    $('load-more').textContent='Carregar mais '+data.page_size+' hinos';
    succeeded=true;
  }catch(error){
    if(page===1&&!preserveContext){
      state.lastResults=[];state.page=0;state.total=0;state.hasMore=false;
      RepertoireUI.renderSearch({});
      $('results-list').innerHTML='<div class="empty-results"><h3>Falha na pesquisa</h3><p>Verifique a coletânea e tente novamente.</p></div>';
    }
    toast(error.message);
  }finally{busySearch(false);}
  if(succeeded&&page===1&&!state.exactNumber){
    const epoch=state.searchEpoch;
    const embeddings=!isBibleSearch&&!state.vectorQuery&&state.searchSettings.vectorMode!=='off'
      ?EmbeddingSearch.maybeUpdate(state.effectiveQuery,epoch):undefined;
    if(autoAI&&!semanticHints.length){
      Promise.resolve(embeddings).then(()=>{
        if(epoch===state.searchEpoch)GGUF.maybeAuto(state.effectiveQuery);
      });
    }
  }
  GGUF.info?.();
  return succeeded;
}
function searchRestrictions(){
  return {exclude:state.exclude,deprioritize:state.deprioritize,require:state.requiredTerms};
}
function appendConversation(kind,text){
  const bubble=document.createElement('div');
  bubble.className=kind==='user'?'user-message':'assistant-message';
  bubble.textContent=text;
  $('conversation').appendChild(bubble);
  scrollChat();
  return bubble;
}
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
let modalTrigger = null;
function openLayer(name) {
  const layer = $(name+'-layer');
  modalTrigger = document.activeElement;
  layer.classList.remove('hidden');
  layer.setAttribute('aria-hidden','false');
  state.activeModal = name;
  document.body.style.overflow = 'hidden';
  q('.icon-button[data-close]', layer).focus();
  q('.app-shell').inert = true;
}

function closeLayer() {
  if (!state.activeModal) return;
  const layer = $(state.activeModal+'-layer');
  state.activeModal = null;
  document.body.style.overflow = '';
  q('.app-shell').inert = false;
  const focusTarget = modalTrigger?.getClientRects().length ? modalTrigger : $('search-input');
  focusTarget.focus({preventScroll:true});
  layer.classList.add('hidden');
  layer.setAttribute('aria-hidden','true');
  modalTrigger = null;
}
async function importRemote(){
  const buttons=[$('import-remote'),$('settings-import'),$('upgrade-import')];buttons.forEach(b=>{b.disabled=true;b.textContent='Importando…';});
  try{const r=await jsonRequest('/api/import-remote',{});toast(`Biblioteca atualizada: ${r.count} hinos únicos; ${r.added} novos; ${r.duplicates} registros duplicados.`);await refreshStatus();closeLayer();}
  catch(e){toast('Não foi possível baixar a coletânea. Use um JSON local ou confira a conexão. '+e.message);}
  finally{buttons[0].disabled=false;buttons[0].textContent='Importar as 3 coleções';buttons[1].disabled=false;buttons[1].textContent='Atualizar 3 coleções';buttons[2].disabled=false;buttons[2].textContent='Adicionar Avulsos e CIA';}
}
async function importFile(input){const file=input.files?.[0];if(!file)return;if(file.size>12_000_000){toast('O arquivo precisa ter até 12 MB.');return;}
  try{const data=JSON.parse(await file.text());const response=await jsonRequest('/api/import',{data});toast(`Biblioteca: ${response.count} hinos únicos (${response.added} novos).`);await refreshStatus();closeLayer();}
  catch(e){toast('Falha ao importar JSON: '+e.message);}finally{input.value='';}}
async function submitSearch(query) {
  if(query&&state.ready&&!state.busy){
    $('collection-picker').open=false;
    $('search-diagnostics').open=false;
    resetChatTurn();
  }
  if(await performSearch(query))$('results-title').focus({preventScroll:true});
}
$('search-form').addEventListener('submit',ev=>{ev.preventDefault();submitSearch($('search-input').value.trim());});

const workspaceTabs=[...document.querySelectorAll('.workspace-tabs [role="tab"]')];
function activateTab(tab,tabs){
  for(const candidate of tabs){
    const selected=candidate===tab;
    candidate.setAttribute('aria-selected',String(selected));
    candidate.tabIndex=selected?0:-1;
    $(candidate.getAttribute('aria-controls')).hidden=!selected;
  }
}
function bindTabs(tabs,select){
  for(const tab of tabs){
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      const visible=tabs.filter(candidate=>candidate.getClientRects().length);
      const index=visible.indexOf(tab);
      const next={ArrowLeft:(index+visible.length-1)%visible.length,
        ArrowRight:(index+1)%visible.length,Home:0,End:visible.length-1}[event.key];
      if(next===undefined)return;
      event.preventDefault();
      select(visible[next]);
      visible[next].focus();
    });
  }
}
function selectWorkspace(name){
  const tab=$('app-tab-'+name);
  if(tab.getAttribute('aria-selected')!=='true'){
    activateTab(tab,workspaceTabs);
    window.scrollTo({top:0,behavior:'instant'});
  }
  if(name==='chat'){
    if(!state.chatHistory.length){
      state.chatQuestions.add('ocasiao');
      chatSay('assistant','Para qual momento você está escolhendo os hinos? Você também pode colar uma anotação espiritual aqui.','preference:ocasiao');
    }
    scrollChat();
  }
  if(name==='bible')void BibleReader.open();
}
bindTabs(workspaceTabs,tab=>selectWorkspace(tab.id.replace('app-tab-','')));
q('.brand').addEventListener('click',event=>{event.preventDefault();selectWorkspace('search');});
$('search-open-library').addEventListener('click',()=>selectWorkspace('library'));
$('chat-new').addEventListener('click',()=>{
  resetChatTurn();
  clearChatContext();
  $('refine-input').value='';
  selectWorkspace('chat');
  $('refine-input').focus();
});
$('chat-stop').addEventListener('click',()=>{
  resetChatTurn();
  chatSay('assistant','Resposta interrompida.');
});
function scrollChat(){
  const feed=$('conversation').parentElement;
  if(feed)feed.scrollTop=feed.scrollHeight;
}
function updateChatControls(){
  const pending=state.chatPending;
  $('refine-send').disabled=state.busy||Boolean(pending);
  $('chat-search').disabled=state.busy||Boolean(pending);
  $('chat-new').disabled=Boolean(pending?.searching);
  $('refine-form').setAttribute('aria-busy',String(Boolean(pending)));
  $('chat-progress').classList.toggle('hidden',!pending);
  $('chat-stop').classList.toggle('hidden',Boolean(pending?.searching));
  $('chat-progress-text').textContent=pending?.searching?'Buscando hinos…':'Respondendo…';
  if(pending)scrollChat();
}
function resetChatTurn(){
  if(!state.chatPending)return;
  state.chatPending=null;
  GGUF.cancelSearchTask();
  updateChatControls();
}
function clearChatContext(){
  state.chatHistory=[];
  state.chatQuestions.clear();
  state.chatBrief={};
  $('conversation').replaceChildren();
  const hadEdits=state.chatAdded.size||state.chatRemoved.size;
  clearChatEdits();
  if(hadEdits)$('results-list').innerHTML=state.lastResults.map(resultCard).join('');
}
function clearChatEdits(){
  state.chatAdded=new Map();
  state.chatEligible=null;
  state.chatRemoved=new Set();
  state.chatChoices=null;
  state.chatProposal=null;
  $('curation-status')?.classList.add('hidden');
}
function chatSay(kind,text,intent){
  state.chatHistory.push({kind,text,intent});
  if(state.chatHistory.length>16)state.chatHistory.shift();
  return appendConversation(kind,text);
}
function visibleHymns(){
  const additions=[...state.chatAdded.values()].filter(hymn=>{
    const collections=state.searchSettings.collections;
    return (!state.chatEligible||state.chatEligible.has(hymn.id))&&
      (!collections||!hymn.collection_ids?.length||hymn.collection_ids.some(id=>collections[id]!==false));
  });
  const raw=state.lastResults.filter(hymn=>!state.chatRemoved.has(hymn.id)&&!state.chatAdded.has(hymn.id));
  return [...additions,...raw];
}
function renderCuratedResults(){
  const edited=state.chatAdded.size+state.chatRemoved.size>0;
  const note=$('curation-status');
  if(note)note.classList.toggle('hidden',!edited);
  if(!edited)return false;
  if(note)note.textContent='Nesta conversa · '+state.chatAdded.size+' acrescentados · '+state.chatRemoved.size+' retirados';
  const hymns=visibleHymns();
  $('results-list').innerHTML=hymns.length?hymns.map(resultCard).join(''):
    '<p class="subtle-note">Nenhum hino nesta página. Você pode pedir outras indicações no chat.</p>';
  return true;
}
function chatHymnName(hymn){
  return (hymn.number?'Hino '+hymn.number+' · ':'')+hymn.title;
}
function applyChatEdit(verb,hymn){
  const current=visibleHymns().some(item=>item.id===hymn.id);
  if(verb==='retirar'&&current){
    state.chatAdded.delete(hymn.id);
    state.chatRemoved.add(hymn.id);
  }else if(verb==='acrescentar'&&!current){
    state.chatRemoved.delete(hymn.id);
    state.chatAdded.set(hymn.id,{...hymn,curated:true,aiReview:null});
    state.chatEligible?.add(hymn.id);
  }else if(verb==='destacar'&&current){
    const bubble=chatSay('assistant','Destaque da lista');
    const button=document.createElement('button');
    button.className='secondary-btn';button.type='button';
    button.textContent=chatHymnName(hymn);
    button.addEventListener('click',()=>openHymn(hymn.id));
    bubble.appendChild(button);
    return true;
  }else return false;
  renderCuratedResults();
  chatSay('assistant',(verb==='retirar'?'Retirado da lista · ':'Acrescentado à lista · ')+chatHymnName(hymn));
  return true;
}
function resolveChatChoice(message,choices){
  const text=OfflineAPI.normalize(message);
  const aliases=[['cia',/\b(?:cia|criancas|infantil)\b/],['avulsos',/\bavulsos?\b/],['principal',/\b(?:coletanea|principal)\b/]];
  const group=aliases.find(([,pattern])=>pattern.test(text))?.[0];
  const matches=choices.filter(hymn=>group?hymn.collection_ids?.includes(group):
    OfflineAPI.normalize(hymn.title)===text.replace(/^["“]|["”]$/g,''));
  return matches.length===1?matches[0]:null;
}
function contextualRemoval(selector,visible){
  if(!selector)return [];
  const words=value=>OfflineAPI.normalize(value||'').replace(/[^a-z0-9]+/g,' ').trim();
  const phrase=words(selector).replace(/^(?:(?:sobre|que fala (?:de|sobre)|cujo tema e|da|do|de|o|a)\s+)+/,'');
  if(phrase.length<4)return [];
  return visible.filter(hymn=>[hymn.title,hymn.snippet].some(value=>(' '+words(value)+' ').includes(' '+phrase+' ')));
}
async function chatScripture(message){
  return jsonRequest('/api/scripture/context',{message,settings:state.searchSettings});
}
function showChatScripture(bubble,scripture){
  if(!scripture)return;
  const citation=document.createElement('details');
  citation.className='chat-citation';
  const label=document.createElement('summary');
  label.textContent='Bíblia Livre · '+scripture.reference;
  const excerpt=document.createElement('p');
  excerpt.textContent=scripture.text;
  citation.append(label,excerpt);
  bubble.appendChild(citation);
  scrollChat();
}
async function refineChatSearch(request,turn){
  let scripture=null;
  if(request.context&&request.query){
    scripture=await chatScripture(request.context);
    if(state.chatPending!==turn)return false;
    if(scripture&&(scripture.narrative||request.context.length>500)){
      const anchor=[scripture.narrative,scripture.reference].filter(Boolean).join(' ');
      request={...request,query:(anchor+'. '+request.query).slice(0,500)};
    }
  }
  if(!request.query){
    chatSay('assistant','Qual tema, passagem ou hino você quer buscar?');
    return false;
  }
  if(!state.ready){
    chatSay('assistant','Importe uma coletânea na aba Biblioteca para buscar hinos.');
    return false;
  }
  const success=await performSearch(request.query,{
    refine:request.refine&&Boolean(state.effectiveQuery),autoAI:false,fromChat:true
  });
  if(state.chatPending!==turn)return false;
  if(!success){
    chatSay('assistant','Não foi possível buscar hinos.');
    return false;
  }
  const bubble=chatSay('assistant',state.total?
    'Encontrei '+state.total+(state.total===1?' hino.':' hinos.'):
    'Não encontrei hinos para esse pedido. Podemos ajustar o tema.');
  if(state.total){
    for(const hymn of visibleHymns().slice(0,3)){
      const suggestion=document.createElement('button');
      suggestion.className='secondary-btn';suggestion.type='button';
      suggestion.textContent=chatHymnName(hymn);
      suggestion.addEventListener('click',()=>openHymn(hymn.id));
      bubble.appendChild(suggestion);
    }
    const button=document.createElement('button');
    button.className='secondary-btn';button.type='button';button.textContent='Ver resultados';
    button.addEventListener('click',()=>{
      selectWorkspace('search');
      $('results-title').focus({preventScroll:true});
    });
    bubble.appendChild(button);
    scrollChat();
  }
  const candidates=visibleHymns().slice(0,4);
  if(request.context&&candidates.length>1){
    turn.searching=false;
    updateChatControls();
    const result=await GGUF.refineChat({recommendation:true,message:request.context,shown:candidates,scripture});
    if(state.chatPending===turn&&result?.recommendation){
      const hymn=result.recommendation;
      const recommendation=chatSay('assistant','Sugestão da IA · '+chatHymnName(hymn)+'\n'+result.reason);
      const evidence=document.createElement('p');
      evidence.textContent='Trecho do hino: '+hymn.snippet;
      recommendation.appendChild(evidence);
      scrollChat();
    }
  }
  return true;
}
function saveChatBrief(message,lastQuestion){
  const field=lastQuestion==='preference:ocasiao'?'occasion':lastQuestion==='preference:tema'?'theme':null;
  if(!field||!LocalHymnAI.isBriefAnswer(message))return false;
  if(field==='occasion'&&/^(?:prefiro|quero|hinos?|tema)\b/iu.test(message.trim()))return false;
  const value=message.trim().replace(/[.!]+$/u,'');
  state.chatBrief[field]=value;
  if(field==='occasion'&&!state.chatBrief.theme&&!state.chatQuestions.has('tema')){
    state.chatQuestions.add('tema');
    chatSay('assistant','Ocasião: '+value+'. Que mensagem você quer transmitir com os hinos?','preference:tema');
  }else{
    const {theme,occasion}=state.chatBrief;
    const context=[occasion&&'ocasião: '+occasion,theme&&'tema: '+theme].filter(Boolean).join('; ');
    chatSay('assistant','Anotei '+context+'. Posso buscar hinos quando você pedir.');
  }
  return true;
}
async function submitRefinement(message,{viaButton=false}={}){
  if((!message&&!viaButton)||state.busy||state.chatPending)return false;
  if(message.length>LocalHymnAI.CHAT_MESSAGE_LIMIT){
    chatSay('assistant','Envie até '+LocalHymnAI.CHAT_MESSAGE_LIMIT+' caracteres por mensagem.');
    return false;
  }
  const history=state.chatHistory.slice();
  const lastQuestion=history.at(-1)?.intent;
  const answeringPreference=typeof lastQuestion==='string'&&lastQuestion.startsWith('preference:')&&message.length<=100;
  const pick=!viaButton&&OfflineAPI.chatSearchIntent(message).list;
  const request=pick?null:LocalHymnAI.chatSearchRequest(message,history,viaButton,state.chatBrief);
  const editCommand=!request&&OfflineAPI.chatEditCommand(message);
  const editTurn=Boolean(editCommand||state.chatProposal||state.chatChoices);
  const turn={epoch:state.searchEpoch,searching:Boolean(request)};
  state.chatPending=turn;
  chatSay('user',message||(request?.query?'Buscar hinos para o que conversamos':'Buscar hinos'),request?'search':editTurn?'edit':'conversation');
  updateChatControls();
  const current=()=>state.chatPending===turn&&turn.epoch===state.searchEpoch;
  try{
    if(request){
      state.chatChoices=null;
      state.chatProposal=null;
      return await refineChatSearch(request,turn);
    }
    if(!editTurn&&!pick&&saveChatBrief(message,lastQuestion))return true;
    const proposal=state.chatProposal;
    state.chatProposal=null;
    if(proposal&&/^(?:sim|pode (?:adicionar|incluir|acrescentar)|confirmo|aceito)[.!]?$/i.test(message))
      return applyChatEdit('acrescentar',proposal);
    if(proposal&&/^(?:não|nao|não quero)[.!]?$/i.test(message)){
      chatSay('assistant','Mantive a lista.');
      return true;
    }
    const explaining=/\b(?:explique|por que|qual a diferen[cç]a)\b/i.test(message);
    const keepList=/^(?:não|nao)\s+(?:retire|remova|tire|exclua|acrescente|adicione|inclua|coloque)\b[^,.!?]*[.!?]?$/i.test(message);
    if(keepList&&!explaining){
      chatSay('assistant','Mantive a lista como está.');
      return true;
    }
    const lookup=editCommand&&!explaining?
      await jsonRequest('/api/chat-candidates',{message,settings:state.searchSettings,...searchRestrictions()}):{hymns:[]};
    if(!current())return false;
    const visible=visibleHymns();
    const shown=visible.slice(0,6);
    let found=[];
    const clarified=state.chatChoices&&resolveChatChoice(message,state.chatChoices.hymns);
    const contextual=lookup.verb==='retirar'&&!lookup.exact?contextualRemoval(lookup.selector,visible):null;
    if(contextual&&!contextual.length&&!clarified){
      state.chatChoices=null;
      chatSay('assistant','Qual hino você quer retirar? Diga o número, o título ou a coletânea para eu identificar o hino.');
      return false;
    }
    const reference=lookup.exact?lookup:clarified?{verb:state.chatChoices.verb,hymns:[clarified]}:
      contextual?{verb:'retirar',hymns:contextual}:null;
    if(reference){
      const wantsOnList=reference.verb==='retirar';
      const matches=reference.hymns.filter(hymn=>visible.some(h=>h.id===hymn.id)===wantsOnList);
      const alternatives=wantsOnList&&matches.length?matches:reference.hymns;
      if(alternatives.length>1){
        state.chatChoices={verb:reference.verb,hymns:alternatives};
        chatSay('assistant','Qual deles você quer? '+alternatives.slice(0,5).map(hymn=>chatHymnName(hymn)+' ('+hymn.collection+')').join(' · '));
        return false;
      }
      state.chatChoices=null;
      if(wantsOnList&&!matches.length&&alternatives.length===1){
        const hymn=alternatives[0];
        state.chatRemoved.add(hymn.id);
        renderCuratedResults();
        chatSay('assistant','Ficará fora das sugestões desta conversa · '+chatHymnName(hymn));
        return true;
      }
      if(!matches.length){
        chatSay('assistant',alternatives.length?
          (wantsOnList?'Esse hino já está fora da lista.':'Esse hino já está na lista.'):
          'Não encontrei esse hino nas coletâneas selecionadas. Você pode indicar o título ou a coletânea.');
        return false;
      }
      return applyChatEdit(reference.verb,matches[0]);
    }else{
      state.chatChoices=null;
      const onList=new Set(visible.map(h=>h.id));
      const options=new Map();
      for(const h of lookup.hymns){
        if(!onList.has(h.id)&&!state.chatRemoved.has(h.id)&&!options.has(h.id))options.set(h.id,h);
      }
      found=[...options.values()].slice(0,3);
    }
    const previousNote=history.filter(item=>item.kind==='user'&&item.intent==='conversation').at(-1)?.text;
    const scripture=!lookup.verb&&(await chatScripture(message)||
      (message.length<120&&previousNote?await chatScripture(previousNote):null));
    if(!current())return false;
    const response=await GGUF.refineChat({message,history,shown,found,editIntent:lookup.verb,explaining,pick,scripture,
      asked:[...state.chatQuestions],answeringPreference,brief:state.chatBrief});
    if(!current())return false;
    if(response?.cancelled){chatSay('assistant','Conversa interrompida.');return false;}
    if(response?.verb==='destacar'&&pick)return applyChatEdit('destacar',response.hymn);
    if(response?.verb==='acrescentar'&&lookup.verb==='acrescentar'&&found.some(h=>h.id===response.hymn.id)){
      state.chatProposal=response.hymn;
      chatSay('assistant','Posso acrescentar '+chatHymnName(response.hymn)+'? Responda sim ou não.');
      return true;
    }
    if(response?.reply&&(response.question||!LocalHymnAI.repeatsChatReply(response.reply,history))){
      if(response.question)state.chatQuestions.add(response.question);
      showChatScripture(chatSay('assistant',response.reply,response.question?'preference:'+response.question:undefined),scripture);
      return true;
    }
    if(answeringPreference&&!explaining&&!lookup.verb){
      chatSay('assistant','Vou considerar essa preferência quando você pedir sugestões.');
      return true;
    }
    if(explaining){
      chatSay('assistant',visible.length?'A lista atual inclui '+visible.slice(0,3).map(chatHymnName).join(', ')+'. Abra um hino para ver o trecho que motivou a sugestão.':'Ainda não há resultados. Peça uma busca quando quiser ver as opções.');
      return true;
    }
    if(lookup.verb==='acrescentar'){
      chatSay('assistant','Qual hino você quer acrescentar? Informe o número ou o título.');
      return false;
    }
    if(scripture){
      showChatScripture(chatSay('assistant','Consultei este trecho da Bíblia Livre. O modelo local não respondeu a esta mensagem.'),scripture);
      return true;
    }
    chatSay('assistant',response?.unavailable?
      'Carregue um modelo GGUF em Ajustes › IA local para conversar. A busca pelo catálogo está disponível no botão Buscar hinos.':
      'O modelo local não respondeu. Você pode reenviar a mensagem.');
    return false;
  }catch(error){
    if(current())chatSay('assistant','Não foi possível continuar a conversa.');
    return false;
  }finally{
    if(state.chatPending===turn){
      state.chatPending=null;
      updateChatControls();
    }
  }
}
function sendChatInput(viaButton){
  const input=$('refine-input');
  const message=input.value.trim();
  if((!message&&!viaButton)||state.busy||state.chatPending)return;
  if(message.length<=LocalHymnAI.CHAT_MESSAGE_LIMIT)input.value='';
  void submitRefinement(message,{viaButton});
}
$('refine-form').addEventListener('submit',event=>{event.preventDefault();sendChatInput(false);});
$('refine-input').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){
    event.preventDefault();
    sendChatInput(false);
  }
});
$('chat-search').addEventListener('click',()=>sendChatInput(true));

const BibleReader=(()=>{
  const book=$('bible-book'),chapter=$('bible-chapter'),reading=$('bible-reading'),status=$('bible-reading-status');
  let books=[],loaded=false,sequence=0;
  function fill(select,items){
    select.replaceChildren(...items.map(([value,label])=>{
      const option=document.createElement('option');
      option.value=value;option.textContent=label;
      return option;
    }));
  }
  async function showChapter(){
    const current=++sequence;
    try{
      const passage=await jsonRequest('/api/scripture/chapter',{book:book.value,chapter:chapter.value});
      if(current!==sequence)return;
      reading.replaceChildren();
      status.textContent=passage?.reference||'Capítulo indisponível.';
      for(const verse of passage?.verses||[]){
        const row=document.createElement('p');
        const number=document.createElement('sup');
        number.textContent=verse.number;
        row.append(number,' '+verse.text);
        reading.appendChild(row);
      }
    }catch(error){
      if(current===sequence){reading.replaceChildren();status.textContent='Não foi possível abrir o capítulo.';}
    }
  }
  function changeBook(){
    const selected=books.find(item=>item.id===book.value);
    fill(chapter,(selected?.chapters||[]).map(number=>[number,number]));
    void showChapter();
  }
  book.addEventListener('change',changeBook);
  chapter.addEventListener('change',showChapter);
  async function open(){
    if(loaded)return;
    loaded=true;
    try{
      ({books}=await jsonRequest('/api/scripture/books'));
      if(books.length){
        fill(book,books.map(item=>[item.id,item.label]));
        book.disabled=false;chapter.disabled=false;
        changeBook();
        return;
      }
      status.textContent='Bíblia Livre indisponível nesta instalação.';
    }catch(error){status.textContent='Não foi possível carregar a Bíblia Livre.';}
    loaded=false;
  }
  return {open};
})();
$('load-more').addEventListener('click',()=>performSearch(state.effectiveQuery,{page:state.page+1,autoAI:false}));
$('results-list').addEventListener('click',ev=>{const button=ev.target.closest('[data-hymn-id]');if(button)openHymn(button.dataset.hymnId);});
$('new-search').addEventListener('click',()=>{if(state.busy)return;state.effectiveQuery='';state.originalQuery='';state.searchRootQuery='';state.hymnTrail=[];state.exclude=[];state.deprioritize=[];state.requiredTerms=[];state.semanticHints=[];state.lastResults=[];state.vectorQuery=null;state.aiContext=null;state.exactNumber=false;resetChatTurn();clearChatEdits();state.searchEpoch++;GGUF.cancelSearchTask();$('results-panel').classList.add('hidden');$('welcome-panel').classList.remove('hidden');$('search-input').value='';$('search-input').focus();window.scrollTo({top:0,behavior:'smooth'});});
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{$('search-input').value=b.dataset.suggestion;submitSearch(b.dataset.suggestion);}));

const settingsTabs = [...document.querySelectorAll('.settings-tabs [role="tab"]')];
function selectSettingsTab(tab){
  activateTab(tab,settingsTabs);
  if(tab.id==='settings-tab-about')BuildAbout.render();
  window.scrollTo({top:0,behavior:'instant'});
}
bindTabs(settingsTabs,selectSettingsTab);
function showModelSettings(){
  selectWorkspace('settings');
  selectSettingsTab($('settings-tab-ai'));
  $('settings-tab-ai').focus();
}
$('ai-indicator').addEventListener('click',showModelSettings);
$('chat-model-settings').addEventListener('click',showModelSettings);
$('about-app').addEventListener('toggle',()=>{if($('about-app').open)BuildAbout.render();});
$('import-remote').addEventListener('click',importRemote);$('settings-import').addEventListener('click',importRemote);$('upgrade-import').addEventListener('click',importRemote);
$('import-file').addEventListener('change',ev=>importFile(ev.target));$('settings-file').addEventListener('change',ev=>importFile(ev.target));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeLayer));
document.addEventListener('keydown',event=>{
  if (!state.activeModal) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLayer();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = q('[role="dialog"]', $(state.activeModal+'-layer'));
  const focusable = [...dialog.querySelectorAll('button, a[href], input, select, summary, [tabindex]')]
    .filter(el=>el.tabIndex>=0 && !el.disabled && el.getClientRects().length);
  const first = focusable[0];
  const last = focusable[focusable.length-1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

// Configurações 1.5 — persistência local e dicionário pessoal; não chamam o GGUF.
const SearchPreferences=(()=>{
  const ids={vectorMode:'vector-mode',fusionMode:'fusion-mode',mode:'search-mode',strength:'semantic-power',minAffinity:'min-affinity',pageSize:'page-size',
    narratives:'story-toggle',eventEvidence:'event-toggle',related:'related-toggle',scripture:'scripture-toggle',bridge:'bridge-toggle',bibleGraph:'bible-graph-toggle',bibleLinks:'bible-links-toggle',bibleDepth:'bible-depth',showReasons:'explain-toggle',showConcepts:'concepts-toggle',
    recWeight:'rec-weight',recCount:'rec-count',recContext:'rec-context',recAvoidVisited:'rec-visited',recBreakdown:'rec-breakdown'};
  const defaults=OfflineAPI.searchOptions();
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
    syncCollections();
    renderAliases();
  }
  function readInputs(){
    const options={...state.searchSettings};
    for(const [key,id] of Object.entries(ids)){
      const input=$(id);options[key]=input.type==='checkbox'?input.checked:input.type==='range'||key==='pageSize'||key==='bibleDepth'?Number(input.value):input.value;
    }
    options.collections=state.searchSettings.collections;
    if(!window.NativeVector)options.vectorMode='off';
    return OfflineAPI.searchOptions(options);
  }
  function save(){
    state.searchSettings=readInputs();
    localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();
  }
  function refreshSearch(){
    if(state.ready&&state.effectiveQuery)performSearch(state.effectiveQuery,{semanticHints:state.semanticHints,autoAI:false,preserveContext:true});
  }
  function syncCollections() {
    const selected = collectionIds.filter(id=>state.searchSettings.collections[id]!==false);
    for (const id of collectionIds) {
      const checked = selected.includes(id);
      $('collection-'+id).checked = checked;
      q(`[data-collection="${id}"]`).checked = checked;
    }
    $('collection-selection').textContent = selected.length===collectionIds.length?'Todas':
      selected.length===0?'Nenhuma':`${selected.length} de ${collectionIds.length}`;
  }
  $('rec-weight').oninput=()=>{$('rec-weight-value').textContent=$('rec-weight').value+'%';};
  $('semantic-power').oninput=()=>{$('semantic-power-value').textContent=$('semantic-power').value+'%';};
  $('min-affinity').oninput=()=>{$('min-affinity-value').textContent=$('min-affinity').value+'%';};
  $('settings-search-save').onclick=()=>{save();closeLayer();refreshSearch();toast('Preferências de busca aplicadas.');};
  for (const id of collectionIds) {
    for (const input of [$('collection-'+id), q(`[data-collection="${id}"]`)]) {
      input.addEventListener('change',()=>{
        state.searchSettings.collections[id] = input.checked;
        localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
        syncCollections();
        refreshSearch();
      });
    }
  }
  $('settings-search-reset').onclick=()=>{
    state.searchSettings=OfflineAPI.searchOptions(defaults);localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();refreshSearch();toast('Configurações restauradas.');
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
    state.repertoirePending=true;
    state.searchEpoch++;
    GGUF.cancelSearchTask();
    $('gguf-comparison').classList.add('hidden');
    try{
      const result=await jsonRequest('/api/repertoire/mark',{hymn_id:Number(id),not_learned:flag});
      toast(flag?'Hino marcado como não aprendido. Continua disponível na seção separada.':'Hino devolvido às indicações principais.');
      if(state.ready&&state.effectiveQuery){
        const epoch=state.searchEpoch;
        const response=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,parsed_query:true,...searchRestrictions(),
          semantic_hints:state.semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
        if(epoch===state.searchEpoch){
          state.page=1;state.total=response.total;state.hasMore=response.has_more;state.lastResults=response.results.slice();
          state.aiContext=response.ai_context;
          if(flag)state.chatAdded.delete(Number(id));
          if(!renderCuratedResults())$('results-list').innerHTML=response.results.length?response.results.map(resultCard).join(''):
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
    finally{operation=false;state.repertoirePending=false;}
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
      const response=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,parsed_query:true,not_learned_page:next,
        ...searchRestrictions(),semantic_hints:state.semanticHints,vector_query:state.vectorQuery,settings:state.searchSettings});
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
  const pending=new Map(),activeQueries=new Map();let sequence=0;
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
  function request(text){
    if(activeQueries.has(text))return activeQueries.get(text);
    const result=new Promise((resolve,reject)=>{
      const id=String(++sequence);const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Tempo excedido ao calcular embeddings'));},120000);
      pending.set(id,{resolve,reject,timeout});
      try{window.NativeVector.embed(id,text);}catch(e){pending.delete(id);clearTimeout(timeout);reject(e);}
    }).finally(()=>activeQueries.delete(text));
    activeQueries.set(text,result);
    return result;
  }
  async function maybeUpdate(query,epoch){
    if(state.searchSettings.vectorMode==='off'||!state.ready||!state.status?.vector_count)return;
    if(typeof ScriptureIndex!=='undefined'&&ScriptureIndex.parse(query))return;
    if(!window.NativeVector||!/^(?!\s*(?:hino\s*)?\d{1,4}\s*$)/i.test(query))return;
    status('E5 Small: interpretando a consulta no aparelho…');
    try{
      const answer=await request(query);
      if(epoch!==state.searchEpoch||!state.ready||state.searchSettings.vectorMode==='off')return;
      if(state.page!==1||state.busy)return;
      const result=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,parsed_query:true,...searchRestrictions(),
        semantic_hints:state.semanticHints,vector_query:answer.vector,settings:state.searchSettings});
      if(epoch!==state.searchEpoch||state.page!==1||state.busy)return;
      state.vectorQuery=answer.vector;
      state.total=result.total;state.page=1;state.hasMore=result.has_more;state.lastResults=result.results.slice();
      state.aiContext=result.ai_context;
      if(!renderCuratedResults())$('results-list').innerHTML=result.results.length?result.results.map(resultCard).join(''):
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
  const selectedState={ready:false,busy:false,task:null};
  let nextRequest=0,queuedAuto=null,queuedChat=null;
  const aiCache=new Map();
  const MAX_AI_MS=12000;
  const canUseTopics=()=>!state.exactNumber&&state.searchSettings.mode!=='literal';
  const phases={none:'Sem modelo',selected:'Arquivo selecionado',copying:'Copiando GGUF',loading:'Carregando modelo',ready:'GGUF carregado',generating:'IA em execução',error:'Falha ao carregar',unavailable:'Motor indisponível'};
  const generationStages=['Aguardando o motor…','Preparando contexto…','Processando entrada…','Gerando resposta…'];
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
    if(phase==='generating'){
      const task=selectedState.task;
      const message=task?.cancelled?'Interrompendo IA…':generationStages[status.generationStage]||generationStages[0];
      setActivity(true,message);
      const seconds=Math.floor((status.elapsedMs||0)/1000);
      $('ai-timer').textContent=seconds+' s';
      if(task?.type==='diagnostic')$('gguf-test-result').textContent=`${message} ${seconds} s`;
    }
    if(phase==='ready'&&!selectedState.task){setActivity(false);}
    if(phase==='selected'&&!selectedState.task){setActivity(false);showTask('Modelo selecionado, não carregado','Aguarde o carregamento automático ou tente novamente nas configurações.');}
    if(phase==='error'){setActivity(false);showTask('Modelo não foi carregado','Confira os detalhes do erro nas configurações. A busca offline continua disponível.');}
    if(phase==='none'||phase==='unavailable'){setActivity(false);showTask('Busca local disponível','Você pode carregar um GGUF para interpretação contextual complementar.');}
  }
  function info(){
    const status=nativeStatus();selectedState.ready=Boolean(status.loaded);selectedState.busy=Boolean(status.busy||selectedState.task);
    const available=Boolean(status.available); const phase=status.phase||(status.loaded?'ready':status.selected?'selected':'none');
    $('gguf-select').disabled=!available||selectedState.busy;$('gguf-load').disabled=!available||!status.selected||selectedState.busy||selectedState.ready;
    $('gguf-improve').disabled=!selectedState.ready||selectedState.busy||state.busy||state.repertoirePending||!state.effectiveQuery||!canUseTopics();
    $('gguf-compare').disabled=!state.lastResults.length;
    $('gguf-compare-model').disabled=!selectedState.ready||selectedState.busy||state.busy||state.repertoirePending||!state.effectiveQuery||state.exactNumber;
    $('gguf-compare-model').textContent=state.lastResults.length<2?'Buscar hinos com IA':'Comparar com IA';
    $('gguf-test').disabled=!selectedState.ready||selectedState.busy;
    $('gguf-cancel').disabled=!selectedState.task; if($('ai-cancel'))$('ai-cancel').classList.toggle('hidden',!selectedState.task);
    $('modal-ai-ask').disabled=!state.currentHymn;
    $('modal-ai-ask').textContent='Resumo temático offline';
    $('settings-ai').textContent=phases[phase]||phase;
    const modelName=status.name||'Nenhum arquivo selecionado';
    $('gguf-status').textContent=available?(status.selected?'Arquivo: '+modelName:'Nenhum arquivo selecionado.'):'Motor GGUF indisponível neste aparelho.';
    const backend = status.loaded?(status.armWeightsPacked?' · Buffer ARM64 KleidiAI':' · CPU padrão'):'';
    $('gguf-phase').textContent='Estado: '+(phases[phase]||phase)+backend+
      ((phase==='loading'||phase==='copying')&&Number.isFinite(status.progress)?' · '+status.progress+'%':'');
    const fmt=x=>Number.isFinite(x)&&x>0?Math.round(x)+' MB':'—';
    $('gguf-model-meta').textContent=`Tamanho GGUF: ${fmt(status.modelMB)} · Armazenamento livre: ${fmt(status.storageMB)} · Cache local: ${fmt(status.cachedMB)} · RAM disponível: ${fmt(status.availableMB)} · RAM total: ${fmt(status.totalMB)} · Memória nativa usada: ${fmt(status.nativeMB)}. Valores aproximados, sujeitos às restrições do Android.`;
    if(status.lastError){$('gguf-last').textContent='Erro mais recente: '+status.lastError;}
    else if(status.lastDurationMs>0){$('gguf-last').textContent=`Última execução: ${Math.round(status.lastDurationMs/1000)} s`;}
    $('gguf-banner').classList.toggle('hidden',!state.ready||!selectedState.ready);
    $('ai-workspace').classList.toggle('hidden',!selectedState.ready&&!selectedState.busy);
    $('gguf-banner-text').textContent=selectedState.ready?'IA local disponível':'Carregue um GGUF em Configurações para usar a IA.';
    $('refine-mode').textContent=selectedState.ready?'Modelo local pronto':selectedState.busy?'Preparando o modelo…':'Modelo local indisponível';
    updateIndicator(status);
    return status;
  }
  function resetTask(message,failed=false,chatResult=null){
    const completed=selectedState.task;
    selectedState.task=null;
    if(completed?.chatResolve)completed.chatResolve(chatResult||
      (completed.cancelled||completed.epoch!==state.searchEpoch?{cancelled:true}:null));setActivity(false);
    $('ai-timer').textContent='';$('ai-last').textContent=message;
    if(failed){toast(message);showTask('IA encontrou um erro','A pesquisa local permanece disponível. Veja o erro nas configurações.');}
    else showTask('Análise concluída',message);
    info();
    const next=queuedAuto;
    queuedAuto=null;
    if(queuedChat){
      const chat=queuedChat;
      queuedChat=null;
      if(chat.epoch===state.searchEpoch)startChat(chat);
      else chat.resolve({cancelled:true});
      return;
    }
    if(next?.epoch===state.searchEpoch)void maybeAuto(next.query);
  }
  function cancelIfBusy(){
    const task=selectedState.task;
    if(!task||task.cancelled)return;
    task.cancelled=true;
    if(!task.id){resetTask('Geração cancelada.');return;}
    native()?.cancel?.(task.id);
    showTask('Interrompendo IA','A busca local continua disponível, sem aguardar o GGUF.');
  }
  function cancelSearchTask(){
    queuedAuto=null;
    if(queuedChat){queuedChat.resolve({cancelled:true});queuedChat=null;}
    if(selectedState.task?.type!=='diagnostic')cancelIfBusy();
  }
  function sendTask(task,{prompt,grammar,maxTokens,timeoutMs,candidates,canLookup,lookupRequired,themeLabels,actions,editKeys,questions,noFreeQuestion}){
    task.id=String(++nextRequest);
    task.candidates=candidates;
    task.canLookup=canLookup;
    task.lookupRequired=lookupRequired;
    task.themeLabels=themeLabels;
    task.actions=actions;
    task.editKeys=editKeys;
    task.questions=questions;
    task.noFreeQuestion=noFreeQuestion;
    setActivity(true,generationStages[0]);
    try{native().generate(prompt,task.id,grammar,maxTokens,timeoutMs);}
    catch(error){
      if(task.type==='review'||task.type==='chat')resetTask('Busca local disponível. Não foi possível iniciar a IA.');
      else resetTask('Não foi possível iniciar a IA: '+error.message,true);
      return false;
    }
    info();
    return true;
  }
  function startTask(type,request,details={}){
    if(selectedState.busy||selectedState.task||!selectedState.ready||!native()?.generate)return false;
    const task={type,epoch:state.searchEpoch,startedAt:performance.now(),...details};
    selectedState.task=task;
    $('ai-last').textContent='';
    return sendTask(task,request);
  }
  function startChat(chat){
    if(startTask('chat',chat.request,{chatResolve:chat.resolve})){
      showTask('Refinando pelo chat','Você pode continuar consultando os resultados enquanto a IA responde.');
    }else chat.resolve(null);
  }
  function refineChat(context){
    if(!selectedState.ready)return Promise.resolve({unavailable:true});
    const constraints=[
      state.exclude.length&&'excluir '+state.exclude.join(', '),
      state.deprioritize?.length&&'menos foco em '+state.deprioritize.join(', '),
      state.requiredTerms?.length&&'obrigatório '+state.requiredTerms.join(', ')
    ].filter(Boolean).join(' · ');
    const request=context.recommendation?LocalHymnAI.prepareRecommendation(context.message,context.shown,context.scripture):
      LocalHymnAI.prepareChat({...context,query:state.effectiveQuery,constraints});
    if(!request)return Promise.resolve(null);
    return new Promise(resolve=>{
      const chat={request,resolve,epoch:state.searchEpoch};
      if(selectedState.task?.type==='review'){
        queuedChat=chat;
        cancelIfBusy();
      }else startChat(chat);
    });
  }
  function hintsFromJson(answer,task){
    try{
      const ids=JSON.parse(answer);
      if(!Array.isArray(ids)||ids.length>4)return [];
      const labels=ids.map(id=>{
        if(Number.isSafeInteger(id)&&id>=1&&id<=(task?.themeLabels?.length||0))return task.themeLabels[id-1];
        return typeof id==='string'?id:null; // compatibilidade com respostas antigas
      }).filter(Boolean);
      return OfflineAPI.validateHints(labels);
    }catch(error){ /* Resposta incompleta ou inválida. */ }
    return [];
  }
  async function maybeAuto(query){
    const hymns=state.lastResults.slice(0,LocalHymnAI.REVIEW_LIMIT);
    if(!selectedState.ready||!$('gguf-auto').checked||!state.ready||state.busy||
        state.repertoirePending||!canUseTopics()||hymns.length<LocalHymnAI.REVIEW_LIMIT||
        hymns.some(hymn=>hymn.match_type==='titulo_exato')||/["“”]/.test(query))return;
    if(selectedState.task){queuedAuto={query,epoch:state.searchEpoch};return;}
    if(selectedState.busy||!native()?.generate)return;
    const task={type:'review',epoch:state.searchEpoch,startedAt:performance.now()};
    selectedState.task=task;
    $('ai-last').textContent='';
    showTask('Revisando os primeiros hinos','Os resultados da busca inicial já estão disponíveis.');
    info();
    let request;
    try{
      const entries=await Promise.all(hymns.map(async hymn=>{
        const detail=await jsonRequest('/api/hymns/'+hymn.id);
        return [hymn.id,detail.lyrics];
      }));
      if(selectedState.task!==task||task.epoch!==state.searchEpoch)return;
      request=LocalHymnAI.prepareReview(query,new Map(entries),hymns,{
        exclude:state.exclude,required:state.requiredTerms,context:state.aiContext
      });
    }catch(error){
      if(selectedState.task===task)resetTask('Busca inicial preservada. Não foi possível ler os trechos para revisão.');
      return;
    }
    if(!request){resetTask('Busca inicial preservada. Trechos insuficientes para revisão.');return;}
    task.requests=request.requests;
    task.judgments=[];
    task.deadline=task.startedAt+request.timeoutMs;
    advanceReview(task);
  }
  function advanceReview(task){
    const timeoutMs=Math.floor(task.deadline-performance.now());
    if(timeoutMs<1000){
      resetTask('Busca inicial preservada. A revisão da IA atingiu o limite de tempo.');
      return;
    }
    sendTask(task,{...task.requests[task.judgments.length],timeoutMs});
  }
  function finishReview(task, ok, answer){
    if(!ok||performance.now()>task.deadline){
      resetTask('Busca inicial preservada. A revisão da IA não terminou.');
      return;
    }
    if(state.repertoirePending||!$('gguf-auto').checked){
      resetTask('A lista mudou durante a revisão.');
      return;
    }
    try{
      const {candidate}=task.requests[task.judgments.length];
      task.judgments.push(LocalHymnAI.readReview(answer,candidate));
    }catch(error){resetTask('Busca inicial preservada. A resposta da revisão foi inválida.');return;}
    if(task.judgments.length<task.requests.length){advanceReview(task);return;}
    const results=LocalHymnAI.applyReview(state.lastResults,task.judgments);
    if(!results){resetTask('A lista mudou durante a revisão.');return;}
    if(results===state.lastResults){resetTask('A revisão não identificou encaixe direto.');return;}
    const list=$('results-list');
    const active=document.activeElement;
    const focus=active&&list.contains(active)?active.dataset:null;
    const focusId=Number(focus?.hymnId||focus?.repertoireId);
    state.lastResults=results;
    if(!renderCuratedResults())list.innerHTML=results.map(resultCard).join('');
    if(focusId>0){
      const attribute=focus.hymnId?'data-hymn-id':'data-repertoire-id';
      list.querySelector('['+attribute+'="'+focusId+'"]')?.focus({preventScroll:true});
    }
    resetTask('A IA revisou os primeiros '+task.judgments.length+' hinos.');
  }
  function interpret(query,timeoutMs=MAX_AI_MS){
    if(!query?.trim()||state.busy||state.repertoirePending||!canUseTopics())return;
    const key=JSON.stringify([nativeStatus().name||'',OfflineAPI.normalize(query),state.exclude.map(OfflineAPI.normalize)]);
    const cached=aiCache.get(key);
    if(cached){applyHints(cached);return;}
    const preferred = [...(state.aiContext?.topics||[]),...state.lastResults.slice(0,3).flatMap(hymn=>hymn.topics||[])];
    const request=LocalHymnAI.prepareThemes(query,state.exclude,OfflineAPI.semanticLabels(),timeoutMs,preferred);
    if(request&&startTask('interpret',request,{cacheKey:key})){
      showTask('Sugerindo temas','A busca local continua disponível.');
    }
  }
  async function applyHints(hints){
    const ok=await performSearch(state.effectiveQuery,{semanticHints:hints,autoAI:false,preserveContext:true});
    const message=ok?'Temas da IA aplicados: '+hints.join(', ')+'.':'Não foi possível aplicar os temas à pesquisa atual.';
    if(ok)appendConversation('assistant',message);
    $('ai-last').textContent=message;
  }
  function testModel(){
    if(startTask('diagnostic',LocalHymnAI.diagnostic)){
      $('gguf-test-result').textContent='Iniciando teste de geração local…';
      showTask('Testando geração local','O teste envia uma consulta curta ao GGUF.');
    }
  }
  function compareWithModel(){
    if(state.busy||selectedState.busy||state.repertoirePending||!state.effectiveQuery||state.exactNumber)return;
    const search={query:state.effectiveQuery,exclusions:state.exclude.slice(),deprioritized:state.deprioritize?.slice(),context:state.aiContext,settings:state.searchSettings};
    const request=LocalHymnAI.prepareComparison(search.query,search.exclusions,state.lastResults,search.context);
    if(startTask('compare',request,{search,deadline:performance.now()+request.timeoutMs})){
      if(state.lastResults.length)compare();
      showTask('Buscando hinos com IA',`Trechos disponíveis para o modelo: ${request.candidates.size}.`);
    }
  }
  async function completeLookup(task,term){
    if(task.deadline-performance.now()<1000){resetTask('A comparação atingiu o limite de tempo antes da busca complementar.',true);return;}
    task.id=null;
    const search=task.search;
    const original=[...task.candidates.values()].map(hymn=>({...hymn,snippet:hymn.excerpt,match_type:hymn.matchType}));
    setActivity(true,'Consultando o índice local…');
    showTask('Busca complementar',`O modelo pediu uma busca por “${term}”.`);
    let additional;
    try{
      const result=await jsonRequest('/api/search',{query:term,exclude:search.exclusions,deprioritize:search.deprioritized,settings:{...search.settings,pageSize:10}});
      additional=result.results;
    }catch(error){
      if(selectedState.task===task)resetTask('A busca complementar falhou: '+error.message,true);
      return;
    }
    if(selectedState.task!==task)return;
    if(task.epoch!==state.searchEpoch){resetTask('A busca mudou durante a consulta à coletânea.');return;}
    const {hymns,added}=LocalHymnAI.mergeCandidates(original,additional);
    task.lookup={term,added};
    const request=LocalHymnAI.prepareComparison(search.query,search.exclusions,hymns,search.context,task.lookup);
    if(!request.candidates.size){displayComparison([],task.lookup);resetTask('A busca complementar terminou sem hinos para comparar.');return;}
    const remaining=Math.floor(task.deadline-performance.now());
    if(remaining<1000){resetTask('A comparação atingiu o limite de tempo após a busca complementar.',true);return;}
    sendTask(task,{...request,timeoutMs:remaining});
  }
  function displayComparison(picks,lookup){
    const format = hymn => [
      (hymn.number?'Hino '+hymn.number+' — ':'')+hymn.title,
      'Trecho da coletânea: “'+hymn.excerpt+'”'
    ].join('\n');
    const parts = [];
    if(state.lastResults.length)parts.push(indexComparison());
    if(lookup)parts.push('Busca complementar por “'+lookup.term+'” · '+lookup.added+' novo(s) candidato(s)');
    parts.push(picks.length?'Sugestões da IA\n\n'+picks.map(format).join('\n\n'):
      'A IA não destacou nenhum trecho.');
    $('gguf-comparison-text').textContent=parts.join('\n\n');
    const actions=$('gguf-comparison-actions');
    actions.replaceChildren();
    for(const hymn of picks){
      const button=document.createElement('button');
      button.className='secondary-btn';button.type='button';button.textContent='Ver '+hymn.title;
      button.addEventListener('click',()=>openHymn(hymn.id));
      actions.appendChild(button);
    }
    $('gguf-comparison').classList.remove('hidden');
  }
  function indexComparison() {
    const rows = state.lastResults.slice(0,5).map((hymn,index)=>[
      (index+1)+'. '+(hymn.number?hymn.number+' · ':'')+hymn.title+' · '+hymn.relevance_percent+'%',
      hymn.reason,
      hymn.snippet && '“'+hymn.snippet+'”'
    ].filter(Boolean).join('\n'));
    return ['Comparação do índice local',...rows].join('\n\n');
  }
  function compare(){
    if(!state.lastResults.length){toast('Primeiro faça uma pesquisa.');return;}
    $('gguf-comparison-text').textContent=indexComparison();
    $('gguf-comparison-actions').replaceChildren();
    $('gguf-comparison').classList.remove('hidden');
  }
  function detail(){
    const h=state.currentHymn;if(!h)return;
    const themes=(h.topics||[]).slice(0,6).join(', ')||'Nenhum tema reconhecido';
    $('modal-ai-output').textContent='Temas identificados pelo índice offline: '+themes+'. Verifique a letra antes de selecionar o hino.';
    $('modal-ai-output').classList.remove('hidden');
  }
  window.__ggufNativeEvent=(event,ok,value,requestId,metrics)=>{
    if(event==='phase'){info();return;}
    if(event==='selection'){if(ok){aiCache.clear();toast('Modelo selecionado: '+value);$('gguf-test-result').textContent='Carregando o modelo selecionado…';}else if(value!=='Seleção cancelada.')toast(value);info();return;}
    if(event==='load'){
      $('gguf-test-result').textContent=ok?'GGUF carregado. Toque em Testar modelo para verificar a geração.':'Carregamento falhou: '+value;
      toast(ok?'GGUF carregado.':'Falha ao carregar GGUF: '+value);info();return;
    }
    if(event!=='generate')return;
    const task=selectedState.task;
    if(!task||task.id!==requestId)return;
    if(task.cancelled){
      if(task.type==='diagnostic')$('gguf-test-result').textContent='Teste cancelado.';
      resetTask('Geração cancelada.');return;
    }
    if(task.type!=='diagnostic'&&task.epoch!==state.searchEpoch){resetTask('A busca mudou durante a geração.');return;}
    const answer=String(value).trim();
    if(task.type==='diagnostic'){
      const passed=ok&&answer==='OK'&&metrics?.tokens>0;
      const message=passed?`Teste passou. Preparação: ${metrics.setupMs} ms. Entrada: ${metrics.prefillMs} ms. Primeiro token: ${metrics.firstTokenMs} ms. Tokens gerados: ${metrics.tokens}.`:
        'Teste falhou: '+(ok?'a resposta esperada era OK.':value);
      $('gguf-test-result').textContent=message;
      resetTask(message,!passed);return;
    }
    if(task.type==='review'){finishReview(task,ok,answer);return;}
    if(task.type==='chat'){
      let result=null;
      try{if(ok)result=LocalHymnAI.readChat(answer,task);}catch(error){ /* A busca local continua disponível. */ }
      resetTask(result?'Resposta do chat pronta.':'A IA não conseguiu concluir a resposta.',false,result);
      return;
    }
    if(!ok){resetTask('IA falhou: '+value,true);return;}
    if(task.type==='compare'){
      try{
        const result=LocalHymnAI.readComparison(answer,task);
        if(result.lookup){completeLookup(task,result.lookup);return;}
        displayComparison(result.picks,task.lookup);
      }
      catch(error){resetTask('A IA respondeu em um formato inválido. Tente comparar novamente.',true);return;}
      resetTask('Comparação concluída.');return;
    }
    const hints=hintsFromJson(answer,task);
    if(!hints.length){resetTask('IA não sugeriu temas reconhecidos.');return;}
    aiCache.set(task.cacheKey,hints);
    if(aiCache.size>25)aiCache.delete(aiCache.keys().next().value);
    resetTask('Aplicando temas da IA…');
    applyHints(hints);
  };
  $('gguf-select').addEventListener('click',()=>{if(native()?.selectModel)native().selectModel();});
  $('gguf-load').addEventListener('click',()=>{if(native()?.loadModel){$('gguf-test-result').textContent='Aguardando carregamento do GGUF…';native().loadModel();}});
  $('gguf-test').addEventListener('click',testModel);
  $('gguf-improve').addEventListener('click',()=>interpret(state.effectiveQuery||state.originalQuery));
  $('gguf-cancel').addEventListener('click',cancelIfBusy);if($('ai-cancel'))$('ai-cancel').addEventListener('click',cancelIfBusy);
  $('gguf-compare-model').addEventListener('click',compareWithModel);
  $('gguf-compare').addEventListener('click',compare);$('modal-ai-ask').addEventListener('click',detail);
  // Em atualizações antigas a IA estava ligada automaticamente. Na 1.4 fica desligada inicialmente.
  const savedAuto=localStorage.getItem('hinos-gguf-auto-v15');$('gguf-auto').checked=savedAuto==='1';
  $('gguf-auto').addEventListener('change',()=>{
    const auto=$('gguf-auto').checked;
    localStorage.setItem('hinos-gguf-auto-v15',auto?'1':'0');
    if(!auto&&selectedState.task?.type==='review')cancelIfBusy();
  });
  if(native())setInterval(info,1250);
  info();return {info,maybeAuto,cancelSearchTask,refineChat};
})();
refreshStatus().catch(e=>toast('Não foi possível acessar a base local: '+e.message));
