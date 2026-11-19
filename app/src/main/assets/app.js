'use strict';
const $ = (id) => document.getElementById(id);
const state = {ready:false, status:null, originalQuery:'', effectiveQuery:'', exclude:[], page:0, total:0, hasMore:false, busy:false, activeModal:null};
const q = (s, root=document) => root.querySelector(s);
const escapeHTML = (value) => String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let toastTimer = null;
function toast(msg) { const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),5000); }
async function jsonRequest(url, payload) { return OfflineAPI.request(url, payload); }

async function refreshStatus() {
  const result=await jsonRequest('/api/status');state.status=result;state.ready=result.ready;
  $('collection-label').textContent=result.ready?result.collection:'Coletânea não importada';
  $('data-count').textContent=result.ready?`${result.hymn_count} hinos disponíveis`:'Aguardando base';
  $('import-panel').classList.toggle('hidden',result.ready);
  $('refine-mode').textContent=result.ai_configured?'IA conectada · busca contextual':'Busca contextual local';
  $('settings-collection').textContent=result.collection||'Não importada';
  $('settings-count').textContent=result.hymn_count;
  $('settings-ai').textContent=result.ai_configured?'Configurada':'Desativada';
  $('settings-vectors').textContent=result.vector_count?`${result.vector_count} hinos`:'Não gerado';
  return result;
}
function busySearch(value) {
  state.busy=value;$('search-button').disabled=value;$('refine-send').disabled=value;$('load-more').disabled=value;
  $('search-button').textContent=value?'Buscando…':'Buscar';
  if(!value) $('search-button').innerHTML='Buscar <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
}
function resultCard(hymn) {
  const number=hymn.number?`HINO ${escapeHTML(hymn.number)}`:'HINO SEM NÚMERO';
  const tags=(hymn.topics||[]).slice(0,3).map(t=>`<span class="small-tag">${escapeHTML(t)}</span>`).join('');
  const className=hymn.relevance==='Muito relevante'?'':hymn.relevance==='Relevante'?'mid':'low';
  return `<article class="result-card"><div class="result-head"><span class="hymn-number">${number}</span><span class="relevance ${className}">${escapeHTML(hymn.relevance)}</span></div>
    <h3>${escapeHTML(hymn.title)}</h3><p class="lyric-quote">“${escapeHTML(hymn.snippet||'Nenhum trecho disponível')}”</p>
    <p class="why"><strong>Por que foi sugerido:</strong> ${escapeHTML(hymn.reason||'Correspondência textual ou temática.')}</p>
    <div class="result-bottom"><div class="tag-row">${tags}</div><button class="view-btn" data-hymn-id="${Number(hymn.id)}" type="button">Ver hino <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button></div></article>`;
}
function showResults() {
  $('welcome-panel').classList.add('hidden');$('results-panel').classList.remove('hidden');
  $('results-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
async function performSearch(query, {page=1, refine=false}={}) {
  if(state.busy) return;
  if(!state.ready){toast('Importe a coletânea para começar.');$('import-panel').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(!query.trim()) return;
  if(page===1) {state.originalQuery=query;showResults();$('results-list').innerHTML=Array.from({length:3},()=>'<div class="loading-skeleton"></div>').join('');$('load-more').classList.add('hidden');}
  busySearch(true);
  try {
    let data;
    if(page>1){data=await jsonRequest('/api/search',{query:state.effectiveQuery,page,exclude:state.exclude});}
    else {data=await jsonRequest('/api/search',{query,refine,previous:refine?state.effectiveQuery:'',exclude:refine?state.exclude:[]});}
    if(page===1){
      state.effectiveQuery=data.effective_query;state.exclude=data.excluded||[];
      $('results-list').innerHTML='';
      $('results-title').textContent=refine?'Pesquisa refinada':'Hinos encontrados';
      $('results-subtitle').textContent=`${data.total} resultado${data.total===1?'':'s'} para “${query}”`;
      const note=$('notice');
      const fragments=[];
      if(data.used_ai)fragments.push('Interpretação contextual processada com IA.');
      else if(refine)fragments.push('Busca contextual local aplicado.');
      if(data.summary)fragments.push(data.summary);
      if(data.excluded?.length)fragments.push('Excluindo: '+data.excluded.join(', ')+'.');
      note.textContent=fragments.join(' ');note.classList.toggle('hidden',!fragments.length);
    }
    state.page=data.page;state.total=data.total;state.hasMore=data.has_more;
    if(data.results.length) {
      $('results-list').insertAdjacentHTML('beforeend',data.results.map(resultCard).join(''));
    } else if(page===1){
      $('results-list').innerHTML='<div class="empty-results"><h3>Nenhum hino encontrado</h3><p>Experimente termos mais gerais, outro tema ou uma frase da letra. O sistema não apresenta sugestões sem evidência mínima.</p></div>';
    }
    $('load-more').classList.toggle('hidden',!data.has_more);
  }catch(error){
    if(page===1)$('results-list').innerHTML='<div class="empty-results"><h3>Falha na pesquisa</h3><p>Verifique a conexão com o servidor e tente novamente.</p></div>';
    toast(error.message);
    return false;
  }finally{busySearch(false);}
  return true;
}
function appendConversation(kind, text){
  const el=document.createElement('div');el.className=kind==='user'?'user-message':'assistant-message';el.textContent=text;
  $('conversation').appendChild(el);$('conversation').scrollTop=$('conversation').scrollHeight;
}
async function openHymn(id){
  try {
    const hymn=await jsonRequest(`/api/hymns/${Number(id)}`);
    $('modal-number').textContent=hymn.number?`HINO ${hymn.number}`:'HINO';
    $('modal-title').textContent=hymn.title;
    $('modal-lyrics').textContent=hymn.lyrics;
    $('modal-topics').replaceChildren();
    if(hymn.topics?.length){hymn.topics.forEach(t=>{const s=document.createElement('span');s.className='small-tag';s.textContent=t;$('modal-topics').appendChild(s);});}
    else {$('modal-topics').textContent='Ainda não foram identificados temas automaticamente.';}
    $('modal-references').textContent=hymn.references?.length?hymn.references.join(' · '):'Nenhuma referência explícita identificada.';
    $('modal-edition').textContent=`${hymn.collection} · Edição ${hymn.edition}`;
    openLayer('modal');
  }catch(e){toast(e.message);}
}
function openLayer(name){const el=$(name+'-layer');el.classList.remove('hidden');el.setAttribute('aria-hidden','false');state.activeModal=name;document.body.style.overflow='hidden';q('.icon-button[data-close]',el)?.focus();}
function closeLayer(){if(!state.activeModal)return;const el=$(state.activeModal+'-layer');el.classList.add('hidden');el.setAttribute('aria-hidden','true');state.activeModal=null;document.body.style.overflow='';}
async function importRemote(){
  const buttons=[$('import-remote'),$('settings-import')];buttons.forEach(b=>{b.disabled=true;b.textContent='Importando…';});
  try {
    const r=await jsonRequest('/api/import-remote',{});
    toast(`Importação concluída: ${r.count} hinos de ${r.collection}.`);
    await refreshStatus();closeLayer();
  }catch(e){toast('Não foi possível baixar a coletânea. Use um arquivo JSON local ou confira a conexão. '+e.message);}
  finally{buttons[0].disabled=false;buttons[0].textContent='Importar do GitHub';buttons[1].disabled=false;buttons[1].textContent='Atualizar do GitHub';}
}
async function importFile(input){
  const file=input.files?.[0];if(!file)return;
  if(file.size>12_000_000){toast('O arquivo precisa ter até 12 MB.');return;}
  try {
    const data=JSON.parse(await file.text());
    const response=await jsonRequest('/api/import',{data});
    toast(`Importados ${response.count} hinos: ${response.collection}.`);
    await refreshStatus();closeLayer();
  }catch(e){toast('Falha ao importar JSON: '+e.message);}finally{input.value='';}
}
$('search-form').addEventListener('submit',(ev)=>{ev.preventDefault();performSearch($('search-input').value.trim());});
$('refine-form').addEventListener('submit',async(ev)=>{
  ev.preventDefault();const message=$('refine-input').value.trim();if(!message||state.busy)return;
  appendConversation('user',message);$('refine-input').value='';
  const success=await performSearch(message,{refine:true});
  appendConversation('assistant',success?`Pesquisa refinada: ${state.total} resultado${state.total===1?'':'s'}. Você pode acrescentar outro critério.`:'Não consegui refinar a pesquisa. Confira a conexão e tente novamente.');
});
$('load-more').addEventListener('click',()=>performSearch(state.effectiveQuery,{page:state.page+1}));
$('results-list').addEventListener('click',(ev)=>{const btn=ev.target.closest('[data-hymn-id]');if(btn)openHymn(btn.dataset.hymnId);});
$('new-search').addEventListener('click',()=>{
  state.effectiveQuery='';state.originalQuery='';state.exclude=[];$('results-panel').classList.add('hidden');$('welcome-panel').classList.remove('hidden');$('search-input').value='';$('search-input').focus();window.scrollTo({top:0,behavior:'smooth'});
  $('conversation').innerHTML='<div class="assistant-message">Precisa de algo mais específico? Descreva a mensagem ou ocasião desejada.</div>';
});
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{$('search-input').value=b.dataset.suggestion;performSearch(b.dataset.suggestion);}));
$('open-settings').addEventListener('click',()=>openLayer('settings'));
$('import-remote').addEventListener('click',importRemote);$('settings-import').addEventListener('click',importRemote);
$('import-file').addEventListener('change',ev=>importFile(ev.target));$('settings-file').addEventListener('change',ev=>importFile(ev.target));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeLayer));
document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeLayer();});
refreshStatus().catch(e=>toast('Não foi possível acessar a base local: '+e.message));
// Android WebView: arquivos locais empacotados, sem service worker.
