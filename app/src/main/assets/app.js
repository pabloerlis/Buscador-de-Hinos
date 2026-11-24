'use strict';
const $ = id => document.getElementById(id);
const q = (s,root=document) => root.querySelector(s);
const state={ready:false,status:null,originalQuery:'',effectiveQuery:'',exclude:[],deprioritize:[],requiredTerms:[],semanticHints:[],page:0,total:0,hasMore:false,busy:false,activeModal:null,lastResults:[],exactNumber:false,repertoirePending:false,currentHymn:null,searchRootQuery:'',hymnTrail:[],modalSequence:0,vectorQuery:null,searchEpoch:0,
  searchSettings:OfflineAPI.searchOptions()};
try{const saved=JSON.parse(localStorage.getItem('hinos-search-preferences-v15')||'{}');state.searchSettings=OfflineAPI.searchOptions(saved);}catch(error){console.warn('Preferências não puderam ser lidas',error.message);}
delete state.searchSettings.customAliases;
// Migrate former no-runtime default once, then preserve the user's explicit setting.
if(window.NativeHarrierPackage&&!localStorage.getItem('hinos-harrier-mode-v1')){state.searchSettings.vectorMode='balanced';localStorage.setItem('hinos-harrier-mode-v1','1');localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));}
if(!window.NativeHarrierPackage)state.searchSettings.vectorMode='off';
document.documentElement.classList.toggle('with-vector',Boolean(window.NativeHarrierPackage));
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let toastTimer=null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),6000);}
async function jsonRequest(url,payload){return OfflineAPI.request(url,payload);}
async function refreshStatus(){
  const result=await jsonRequest('/api/status');state.status=result;state.ready=result.ready;
  $('collection-label').textContent=result.ready?result.collection:'Coletânea não importada';
  $('data-count').textContent=result.ready?`${result.hymn_count} hinos disponíveis`:'Aguardando base';
  $('import-panel').classList.toggle('hidden',result.ready);
  $('welcome-panel').classList.toggle('hidden',!result.ready||document.body.classList.contains('has-results'));
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
  $('settings-embeddings').textContent=result.vector_count?`${result.vector_count} hinos · Harrier 600M`:'Não disponível para esta coletânea';
  $('settings-bridge').textContent=result.bridge_ready?`${result.bridge_entries} associações`:'Indisponível';
  OfflineComparison.refresh();
  return result;
}
function busySearch(value){
  state.busy=value; $('search-button').disabled=value;$('refine-send').disabled=value;updatePages();
  $('search-button').textContent=value?'Buscando…':'Buscar';
  if(!value)$('search-button').innerHTML='Buscar <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
}
function filterEvidenceLabel(evidence){
  return (evidence||[]).flatMap(item=>item.matches.map(match=>
    (item.kind==='prefer'?'Preferência: ':'')+item.term+(match.via_synonym?' → '+match.word:'')+
    ' ('+match.fields.map(field=>field==='title'?'título':'letra').join(' e ')+')')).join(' · ');
}
function renderHighlighted(element,value,ranges){
  const text=String(value??'');let offset=0;
  element.replaceChildren();
  for(const [start,end] of ranges||[]){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<offset||end<=start||end>text.length)continue;
    element.append(document.createTextNode(text.slice(offset,start)));
    const mark=document.createElement('mark');mark.className='filter-highlight';mark.textContent=text.slice(start,end);element.append(mark);offset=end;
  }
  element.append(document.createTextNode(text.slice(offset)));
}
function resultCard(hymn,{unlearned=false}={}){
  const number=hymn.number?escapeHTML(hymn.number):'—';
  const score=Number.isFinite(hymn.relevance_percent)?Math.min(100,Math.max(0,Math.round(hymn.relevance_percent))):0;
  const filterLabel=filterEvidenceLabel(hymn.filter_evidence);
  return `<article class="result-card ${unlearned?'is-unlearned':''}" data-card-id="${Number(hymn.id)}">
    <button class="view-btn" data-hymn-id="${Number(hymn.id)}" type="button">
      <span class="result-index" aria-label="${hymn.number?'Hino '+number:'Hino sem número'}">${number}</span>
      <span class="result-identity"><span class="hymn-number">${escapeHTML(hymn.collection||'Importados')}</span>
        <span class="result-name">${escapeHTML(hymn.title)}</span>${filterLabel?`<span class="filter-evidence-line" title="${escapeHTML(filterLabel)}">${escapeHTML(filterLabel)}</span>`:''}${hymn.vector_points>0?`<span class="harrier-evidence" title="Similaridade de cosseno, não probabilidade">Harrier · +${Number(hymn.vector_points).toFixed(1)} pontos</span>`:''}</span>
      ${hymn.match_type==='filtro'?'':`<span class="relevance" title="Afinidade estimada"><strong>${score}%</strong><span class="sr-only"> de afinidade</span></span>`}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    </button>
  </article>`;
}
function showResults(){
  $('welcome-panel').classList.add('hidden');
  $('results-panel').classList.remove('hidden');
  document.body.classList.add('has-results');
  $('results-evidence').open=false;
}
function updatePages(){
  $('result-pages').classList.toggle('hidden',state.page<2&&!state.hasMore);
  $('previous-page').disabled=state.busy||state.page<2;
  $('load-more').disabled=state.busy||!state.hasMore;
  $('page-status').textContent=`Página ${state.page} de ${Math.max(1,Math.ceil(state.total/state.searchSettings.pageSize))}`;
}
async function performSearch(query,{page=1,refine=false,semanticHints=[],preserveContext=false,paging=page>1,termFilters=state.searchFilters||[],allowVector=true}={}){
  if(state.busy)return false;
  if(!state.ready){toast('Importe a coletânea para começar.');$('import-remote').focus();return false;}
  if(!String(query).trim()&&!termFilters.length)return false;
  state.searchFilters=termFilters;
  if(!paging){
    state.searchEpoch++;
    if(state.searchSettings.vectorMode==='off'||state.searchSettings.mode==='literal'||!HarrierRuntime.available()||query!==state.effectiveQuery)state.vectorQuery=null;
    EmbeddingSearch.show('Busca local · preparando resultados');
    if(!preserveContext){
      state.vectorQuery=null;
      if(!refine)state.searchRootQuery=query;
      state.originalQuery=query;
      state.hymnTrail=[];
    }
    if(!preserveContext){showResults();$('results-list').innerHTML=Array.from({length:3},()=>'<div class="loading-skeleton"></div>').join('');$('result-pages').classList.add('hidden');}
  }
  busySearch(true);let succeeded=false;let isBibleSearch=false;
  try {
    let data;
    if(paging)data=await jsonRequest('/api/search',{query:state.effectiveQuery,page,parsed_query:true,...searchRestrictions(),semantic_hints:state.semanticHints,vector_query:state.vectorQuery,vector_model:'harrier-600m-q4f16',settings:state.searchSettings});
    else if(preserveContext)data=await jsonRequest('/api/search',{query,parsed_query:true,...searchRestrictions(),semantic_hints:semanticHints,vector_query:state.vectorQuery,vector_model:'harrier-600m-q4f16',settings:state.searchSettings});
    else data=await jsonRequest('/api/search',{query,term_filters:termFilters,refine,previous:refine?state.effectiveQuery:'',...(refine?searchRestrictions():{}),semantic_hints:semanticHints,settings:state.searchSettings});
    if(!paging){
      isBibleSearch=!!(data.bible_reference&&state.searchSettings.bibleGraph);
      state.effectiveQuery=data.effective_query;state.exclude=data.excluded||[];state.deprioritize=data.deprioritized||[];state.requiredTerms=data.required||[];state.semanticHints=semanticHints;
      if(data.reset_context||(!refine&&!preserveContext))state.searchRootQuery=state.effectiveQuery;
      
      state.exactNumber=Boolean(data.exact_number);
      $('results-list').innerHTML='';$('results-title').textContent=refine?'Pesquisa refinada':'Hinos encontrados';
      $('results-subtitle').textContent=`${data.total} resultado${data.total===1?'':'s'}${query?` para “${query}”`:" com os filtros"}`;
      const fragments=[];
      if(refine)fragments.push('Critérios contextuais aplicados localmente.');
      if(data.summary)fragments.push(data.summary);
      if(data.context_reranked)fragments.push('Ordem contextual experimental. Os percentuais mostram a afinidade da busca.');
      if(data.excluded?.length)fragments.push('Excluindo: '+data.excluded.join(', ')+'.');
      if(data.deprioritized?.length)fragments.push('Menor prioridade para '+data.deprioritized.join(', ')+'.');
      if(data.required?.length)fragments.push('Critérios obrigatórios: '+data.required.join(', ')+'.');
      $('notice').textContent=fragments.join(' ');$('notice').classList.toggle('hidden',!fragments.length);
      const concepts=data.interpretation||[];
      $('search-diagnostics').classList.toggle('hidden',!concepts.length);
      $('search-concepts').replaceChildren();
      for(const text of concepts){const item=document.createElement('span');item.className='concept-chip';item.textContent=text;$('search-concepts').appendChild(item);}
    }
    state.lastResults=data.results.slice();
    $('results-list').replaceChildren();
    state.page=data.page;state.total=data.total;state.hasMore=data.has_more;
    if(data.results.length)$('results-list').insertAdjacentHTML('beforeend',data.results.map(resultCard).join(''));
    else $('results-list').innerHTML=data.not_learned_total?'<div class="empty-results"><h3>Sem hinos disponíveis para indicação</h3><p>Os hinos relacionados estão na seção «Não aprendidos» abaixo.</p></div>':'<div class="empty-results"><h3>Nenhum hino encontrado</h3><p>Experimente termos mais gerais, outro tema ou uma frase da letra. Não apresentamos sugestões sem evidência mínima.</p></div>';
    if(!paging)RepertoireUI.renderSearch(data);
    EmbeddingSearch.report(data);
    succeeded=true;
  }catch(error){
    if(!paging&&!preserveContext){
      state.lastResults=[];state.page=0;state.total=0;state.hasMore=false;
      RepertoireUI.renderSearch({});
      $('results-list').innerHTML='<div class="empty-results"><h3>Falha na pesquisa</h3><p>Verifique a coletânea e tente novamente.</p></div>';
    }
    toast(error.message);
  }finally{busySearch(false);}
  if(succeeded&&query&&allowVector&&!paging&&!isBibleSearch&&!state.exactNumber&&!state.vectorQuery&&state.searchSettings.vectorMode!=='off'&&state.searchSettings.mode!=='literal')EmbeddingSearch.maybeUpdate(state.effectiveQuery,state.searchEpoch);
  OfflineComparison.refresh();
  return succeeded;
}
function searchRestrictions(){
  return {exclude:state.exclude,deprioritize:state.deprioritize,require:state.requiredTerms,term_filters:state.searchFilters||[]};
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
    const hymn=await jsonRequest(`/api/hymns/${Number(id)}`,{term_filters:(!fromRelated&&(!back||state.hymnTrail[0]===Number(id)))?state.searchFilters||[]:[]});if(sequence!==state.modalSequence)return;
    if(back){const index=state.hymnTrail.lastIndexOf(hymn.id);if(index>=0)state.hymnTrail=state.hymnTrail.slice(0,index+1);}
    else if(fromRelated){state.hymnTrail.push(hymn.id);if(state.hymnTrail.length>50)state.hymnTrail.shift();}
    else state.hymnTrail=[hymn.id];
    state.currentHymn=hymn;
    const reason=state.lastResults.find(item=>item.id===hymn.id)?.reason||'';
    $('modal-match-reason').textContent=reason;
    $('modal-match-reason').classList.toggle('hidden',!reason);
    $('modal-number').textContent=hymn.number?`HINO ${hymn.number}`:'HINO';renderHighlighted($('modal-title'),hymn.title,hymn.filter_highlights?.title);
    const filterLabel=filterEvidenceLabel(hymn.filter_evidence);
    $('modal-filter-evidence').textContent=filterLabel;
    $('modal-filter-evidence').classList.toggle('hidden',!filterLabel);
    $('reader-evidence').classList.toggle('hidden',!reason&&!filterLabel);
    $('reader-evidence').open=false;
    renderHighlighted($('modal-lyrics'),hymn.lyrics,hymn.filter_highlights?.lyrics);$('modal-topics').replaceChildren();
    if(hymn.topics?.length)hymn.topics.forEach(t=>{const s=document.createElement('span');s.className='small-tag';s.textContent=t;$('modal-topics').appendChild(s);});
    else $('modal-topics').textContent='Ainda não foram identificados temas automaticamente.';
    $('modal-references').textContent=hymn.references?.length?hymn.references.join(' · '):'Nenhuma referência explícita identificada.';
    $('modal-edition').textContent=(hymn.collectionRefs||[]).map(ref=>ref.name+(ref.number?' nº '+ref.number:'')).join(' · ') || `${hymn.collection} · Edição ${hymn.edition}`;
    $('modal-summary-output').classList.add('hidden');$('modal-summary-output').textContent='';
    RepertoireUI.renderModal(hymn);
    if(state.activeModal!=='modal')openLayer('modal');
    else q('#modal-layer .modal-body')?.scrollTo({top:0,behavior:'instant'});
    OfflineComparison.refresh();await renderRecommendations(hymn);
  }catch(e){toast(e.message);}
}
$('related-list').addEventListener('click',event=>{
  if(event.target.closest('[data-repertoire-id]'))return;
  const b=event.target.closest('[data-related-id]');if(b)openHymn(Number(b.dataset.relatedId),{fromRelated:true});
});
$('related-back').addEventListener('click',()=>{
  if(state.hymnTrail.length>1){const prior=state.hymnTrail[state.hymnTrail.length-2];openHymn(prior,{back:true});}
});
const layerTimers=new Map();
let layerReturnFocus=null;
function hideLayer(el){clearTimeout(layerTimers.get(el));layerTimers.delete(el);el.classList.add('hidden');el.classList.remove('is-closing');el.setAttribute('aria-hidden','true');el.inert=true;}
function openLayer(name){
  const el=$(name+'-layer');if(!el)return;
  if(state.activeModal===name)return;
  for(const closing of [...layerTimers.keys()])if(closing!==el)hideLayer(closing);
  if(state.activeModal)hideLayer($(state.activeModal+'-layer'));
  else layerReturnFocus=document.activeElement;
  clearTimeout(layerTimers.get(el));layerTimers.delete(el);el.classList.remove('is-closing','hidden');el.inert=false;
  el.setAttribute('aria-hidden','false');state.activeModal=name;document.body.style.overflow='hidden';
  q('.icon-button[data-close]',el)?.focus({preventScroll:true});
}
function closeLayer(){
  if(!state.activeModal)return;
  const el=$(state.activeModal+'-layer');state.activeModal=null;el.inert=true;el.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
  if(layerReturnFocus?.isConnected)layerReturnFocus.focus({preventScroll:true});layerReturnFocus=null;
  const duration=Appearance.duration();
  if(!duration){hideLayer(el);return;}
  el.classList.add('is-closing');layerTimers.set(el,setTimeout(()=>hideLayer(el),duration+30));
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
$('search-form').addEventListener('submit',ev=>{ev.preventDefault();LiveSearch.submit();});
$('refine-form').addEventListener('submit',async ev=>{ev.preventDefault();const message=$('refine-input').value.trim();if(!message||state.busy)return;appendConversation('user',message);$('refine-input').value='';closeLayer();const success=await performSearch(message,{refine:true});appendConversation('assistant',success?`Pesquisa refinada: ${state.total} resultados. Acrescente outra restrição se necessário.`:'Não consegui refinar a pesquisa.');});
$('open-refine').addEventListener('click',()=>{openLayer('refine');$('refine-input').focus();});
$('load-more').addEventListener('click',()=>performSearch(state.effectiveQuery,{page:state.page+1,paging:true}));
$('previous-page').addEventListener('click',()=>performSearch(state.effectiveQuery,{page:state.page-1,paging:true}));
$('results-list').addEventListener('click',ev=>{const button=ev.target.closest('[data-hymn-id]');if(button)openHymn(button.dataset.hymnId);});
function clearSearchResults(){
  state.searchFilters=[];state.effectiveQuery='';state.originalQuery='';state.searchRootQuery='';state.hymnTrail=[];state.exclude=[];state.deprioritize=[];state.requiredTerms=[];state.semanticHints=[];state.lastResults=[];state.vectorQuery=null;state.exactNumber=false;state.searchEpoch++;$('results-panel').classList.add('hidden');document.body.classList.remove('has-results');$('welcome-panel').classList.remove('hidden');
  $('conversation').replaceChildren();OfflineComparison.refresh();
}
$('new-search').addEventListener('click',()=>{
  if(state.busy)return;
  LiveSearch.clear();
  clearSearchResults();
  $('search-input').value='';
  $('search-input').focus();
});
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{$('search-input').value=b.dataset.suggestion;LiveSearch.submit();}));
$('open-appearance').addEventListener('click',()=>openLayer('appearance'));
$('open-settings').addEventListener('click',()=>openLayer('settings'));
$('about-app').addEventListener('toggle',()=>{if($('about-app').open)BuildAbout.render();});
$('import-remote').addEventListener('click',importRemote);$('settings-import').addEventListener('click',importRemote);$('upgrade-import').addEventListener('click',importRemote);
$('import-file').addEventListener('change',ev=>importFile(ev.target));$('settings-file').addEventListener('change',ev=>importFile(ev.target));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeLayer));document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeLayer();});

// Reading preference is local; no lyric text or search state is modified.
const LyricReader=(()=>{
  let size=17;
  try{const saved=Number(localStorage.getItem('hinos-lyric-size'));if(Number.isInteger(saved)&&saved>=15&&saved<=25)size=saved;}catch(_){}
  function render(){
    $('modal-lyrics').style.setProperty('--lyric-size',size+'px');
    $('lyric-size').textContent=String(size);
    $('lyric-smaller').disabled=size<=15;
    $('lyric-larger').disabled=size>=25;
  }
  function change(delta){size=Math.max(15,Math.min(25,size+delta));render();try{localStorage.setItem('hinos-lyric-size',String(size));}catch(_){}}
  $('lyric-smaller').onclick=()=>change(-1);
  $('lyric-larger').onclick=()=>change(1);
  render();
})();
const LiveSearch=(()=>{
  const panel=$('term-filters-panel');
  const rows=$('term-filter-rows');
  const input=$('search-input');
  let timer;
  let appliedInput=null;
  function readFilters(){
    return [...rows.children].flatMap(row=>{
      const term=q('[data-field="term"]',row).value.trim();
      if(!/[a-z0-9]/.test(OfflineAPI.normalize(term)))return [];
      return [{term,kind:q('[data-field="kind"]',row).value,field:q('[data-field="field"]',row).value,
        synonyms:q('[data-field="synonyms"]',row).checked,lexical:q('[data-field="lexical"]',row).value==='full'}];
    });
  }
  function refreshControls(){
    const active=readFilters();
    const count=active.length;
    const labels={require:'+',exclude:'−',prefer:'~'};
    $('active-filter-summary').textContent=count?active.map(f=>labels[f.kind]+' '+f.term+(f.synonyms?' ≈':'')).join(' · '):'Obrigatórias, exclusões e sinônimos';
    $('term-filter-count').textContent=count?String(count):'';
    $('quick-filter-count').textContent=count?' · '+count:'';
    $('term-filter-add').disabled=rows.children.length>=12;
    $('term-filter-clear').disabled=!rows.children.length;
  }
  function add(focus=true){
    if(rows.children.length>=12)return;
    const row=$('term-filter-template').content.firstElementChild.cloneNode(true);
    rows.append(row);
    refreshControls();
    if(focus)q('[data-field="term"]',row).focus();
  }
  function run(live,filtersChanged=false){
    clearTimeout(timer);
    if(live&&!state.ready)return;
    if(state.busy){timer=setTimeout(()=>run(live,filtersChanged),90);return;}
    const query=input.value.trim();
    const termFilters=readFilters();
    if(!query&&!termFilters.length){
      if(!$('results-panel').classList.contains('hidden'))clearSearchResults();
      return;
    }
    const preserve=filtersChanged&&query===appliedInput&&!$('results-panel').classList.contains('hidden');
    appliedInput=query;
    performSearch(preserve?state.effectiveQuery:query,{
      termFilters,allowVector:!live,preserveContext:preserve,semanticHints:preserve?state.semanticHints:[]
    });
  }
  function schedule(filtersChanged=false){
    refreshControls();
    clearTimeout(timer);
    timer=setTimeout(()=>run(true,filtersChanged),180);
  }
  $('open-term-filters').onclick=()=>{
    q('.quick-filters').open=false;
    panel.open=true;
    if(!rows.children.length)add();
    else q('[data-field="term"]',rows).focus();
  };
  $('term-filter-add').onclick=()=>add();
  $('term-filter-done').onclick=()=>{panel.open=false;panel.querySelector('summary').focus();};
  $('term-filter-clear').onclick=()=>{rows.replaceChildren();add(false);schedule(true);};
  function refreshPreview(row){
    if(!row)return;
    const preview=q('.term-synonym-preview',row);
    const term=q('[data-field="term"]',row).value.trim();
    const enabled=q('[data-field="synonyms"]',row).checked;
    q('[data-field="lexical"]',row).disabled=!enabled;
    preview.hidden=!term||!enabled;
    if(!preview.hidden){
      const wide=q('[data-field="lexical"]',row).value==='full';
      const synonyms=OfflineAPI.filterSynonyms(term,{lexical:wide});
      q('.synonym-preview-title',preview).textContent=(wide&&!state.status?.lexical_ready?'Base ampla indisponível · ':'')+(synonyms.length?synonyms.length+' sinônimos aceitos':'Sem sinônimos disponíveis');
      q('.synonym-preview-words',preview).textContent=synonyms.join(', ')||'Somente o termo literal.';
      if(!synonyms.length)preview.open=false;
    }
  }
  rows.addEventListener('input',event=>{refreshPreview(event.target.closest('.term-filter-row'));schedule(true);});
  rows.addEventListener('click',event=>{
    const button=event.target.closest('[data-action="remove"]');
    if(!button)return;
    button.closest('.term-filter-row').remove();
    if(!rows.children.length)add(false);
    schedule(true);
  });
  input.addEventListener('input',()=>schedule());
  panel.addEventListener('toggle',()=>{if(panel.open&&!rows.children.length)add(false);});
  // Busca por atalhos inicia sem usar uma pesquisa que ficou na fila da digitação.
  return {
    submit:()=>run(false),
    synonymsChanged(){[...rows.children].forEach(refreshPreview);schedule(true);},
    clear(){clearTimeout(timer);appliedInput=null;rows.replaceChildren();panel.open=false;refreshControls();}
  };
})();

// Configurações 1.5 — persistência local e dicionário pessoal; sem geração de texto.
const SearchPreferences=(()=>{
  const ids={vectorMode:'vector-mode',mode:'search-mode',strength:'semantic-power',minAffinity:'min-affinity',pageSize:'page-size',
    narratives:'story-toggle',related:'related-toggle',scripture:'scripture-toggle',bridge:'bridge-toggle',bibleGraph:'bible-graph-toggle',bibleLinks:'bible-links-toggle',contextRerank:'context-rank-toggle',bibleDepth:'bible-depth',showReasons:'explain-toggle',showConcepts:'concepts-toggle',
    recWeight:'rec-weight',recCount:'rec-count',recContext:'rec-context',recAvoidVisited:'rec-visited',recBreakdown:'rec-breakdown'};
  const defaults=OfflineAPI.searchOptions();
  function fill(){
    const cfg=state.searchSettings;
    for(const [key,id] of Object.entries(ids)){
      const input=$(id);if(input.type==='checkbox')input.checked=cfg[key]!==false;
      else input.value=String(cfg[key]);
    }
    $('quick-context-rank').checked=cfg.contextRerank;
    $('rec-weight-value').textContent=cfg.recWeight+'%';$('semantic-power-value').textContent=cfg.strength+'%';$('min-affinity-value').textContent=cfg.minAffinity+'%';
    for(const id of ['principal','avulsos','cia','pessoal']){
      $('collection-'+id).checked=cfg.collections[id]!==false;
      const quick=document.querySelector('[data-collection="'+id+'"]');if(quick)quick.checked=cfg.collections[id]!==false;
    }
  }
  function readInputs(){
    const options={...state.searchSettings};
    for(const [key,id] of Object.entries(ids)){
      const input=$(id);options[key]=input.type==='checkbox'?input.checked:input.type==='range'||key==='pageSize'||key==='bibleDepth'?Number(input.value):input.value;
    }
    options.collections=Object.fromEntries(['principal','avulsos','cia','pessoal'].map(id=>[id,$('collection-'+id).checked]));
    if(!window.NativeHarrierPackage)options.vectorMode='off';
    return OfflineAPI.searchOptions(options);
  }
  function save(){
    state.searchSettings=readInputs();
    delete state.searchSettings.customAliases;
    localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();
  }
  function refreshSearch(){
    if(state.ready&&(state.effectiveQuery||state.searchFilters?.length))performSearch(state.effectiveQuery,{semanticHints:state.semanticHints,preserveContext:true});
  }
  $('rec-weight').oninput=()=>{$('rec-weight-value').textContent=$('rec-weight').value+'%';};
  $('semantic-power').oninput=()=>{$('semantic-power-value').textContent=$('semantic-power').value+'%';};
  $('min-affinity').oninput=()=>{$('min-affinity-value').textContent=$('min-affinity').value+'%';};
  $('settings-search-save').onclick=()=>{save();closeLayer();refreshSearch();toast('Preferências de busca aplicadas.');};
  document.querySelectorAll('[data-collection]').forEach(input=>input.addEventListener('change',()=>{
    const id=input.dataset.collection; $('collection-'+id).checked=input.checked;save();refreshSearch();
  }));
  $('quick-context-rank').onchange=()=>{
    $('context-rank-toggle').checked=$('quick-context-rank').checked;
    save();refreshSearch();
  };
  $('settings-search-reset').onclick=()=>{
    state.searchSettings=OfflineAPI.searchOptions(defaults);
    delete state.searchSettings.customAliases;
    localStorage.setItem('hinos-search-preferences-v15',JSON.stringify(state.searchSettings));
    fill();refreshSearch();toast('Configurações restauradas.');
  };
  fill();
  return {refreshSearch};
})();

const AppTabs=(()=>{
  const tabs=[$('tab-search'),$('tab-dictionary')];
  function select(tab,{focus=false}={}){
    for(const item of tabs){
      const selected=item===tab;
      item.setAttribute('aria-selected',String(selected));
      item.tabIndex=selected?0:-1;
      const panel=$(item.getAttribute('aria-controls'));const changed=panel.hidden&&selected;panel.hidden=!selected;
      panel.classList.remove('tab-enter');if(changed){void panel.offsetWidth;panel.classList.add('tab-enter');}
    }
    if(focus)tab.focus();
  }
  for(const tab of tabs){
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      const index=tabs.indexOf(tab);
      const target={ArrowLeft:tabs[1-index],ArrowRight:tabs[1-index],Home:tabs[0],End:tabs[1]}[event.key];
      if(!target)return;
      event.preventDefault();
      select(target,{focus:true});
    });
  }
  return {showSearch:()=>select(tabs[0])};
})();

const PersonalDictionary=(()=>{
  const pageSize=4;
  const maxEntries=50;
  const maxPerStory=15;
  const normalize=value=>OfflineAPI.normalize(value).replace(/[^a-z0-9]+/g,' ').trim();
  const input=$('alias-term');
  const picker=$('alias-story');
  const storyFilter=$('alias-story-filter');
  const filter=$('alias-filter');
  const list=$('alias-list');
  const feedback=$('alias-feedback');
  let stories=[];
  let aliases={};
  let currentPage=1;
  let visible=[];
  let editing=null;
  let removed=null;
  let storyPage=1;
  let visibleStories=[];
  let editingStory=null;
  let synonymPairs=[];
  let synonymPage=1;
  let synonymBusy=false;

  async function loadStories(){
    const data=await jsonRequest('/api/stories');
    stories=(data.stories||[]).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
    aliases=data.associations||{};
    $('story-new').disabled=Boolean(data.dictionaryError);
    if(stories.length)$('settings-stories').textContent=`${stories.length} narrativas locais`;
    $('alias-new').disabled=!stories.length||Boolean(data.dictionaryError);
    render();
    renderPersonalStories();
    await loadSynonyms();
    if(data.dictionaryError){$('alias-state').textContent=data.dictionaryError;$('story-state').textContent=data.dictionaryError;}
  }
  function renderPersonalStories(){
    const personal=stories.filter(story=>story.personal);
    const pages=Math.max(1,Math.ceil(personal.length/pageSize));
    storyPage=Math.min(storyPage,pages);
    visibleStories=personal.slice((storyPage-1)*pageSize,storyPage*pageSize);
    $('story-state').textContent=personal.length
      ? `${personal.length} ${personal.length===1?'narrativa cadastrada':'narrativas cadastradas'}`
      : 'Cadastre uma narrativa para usá-la na busca e nas associações.';
    $('story-list').innerHTML=visibleStories.map((story,index)=>`
      <li class="dictionary-row">
        <div class="dictionary-entry">
          <strong>${escapeHTML(story.label)}</strong>
          <span>${escapeHTML(story.reference||story.clues.join(' · '))}</span>
        </div>
        <div class="dictionary-row-actions">
          <button type="button" class="text-action" data-story-search="${index}">Buscar</button>
          <button type="button" class="text-action" data-story-edit="${index}">Editar</button>
        </div>
      </li>`).join('');
    $('story-pages').hidden=pages===1;
    $('story-previous').disabled=storyPage===1;
    $('story-next').disabled=storyPage===pages;
    $('story-page-status').textContent=`Página ${storyPage} de ${pages}`;
  }
  function showDictionary(view){
    for(const name of ['aliases','stories','synonyms']){
      $('view-'+name).setAttribute('aria-pressed',String(view===name));
      $('dictionary-'+name).hidden=view!==name;
    }
    $('alias-new').hidden=view!=='aliases';
    $('story-new').hidden=view!=='stories';
  }
  function renderSynonyms(){
    const pages=Math.max(1,Math.ceil(synonymPairs.length/5));
    synonymPage=Math.min(pages,Math.max(1,synonymPage));
    $('synonym-list').replaceChildren();
    for(const pair of synonymPairs.slice((synonymPage-1)*5,synonymPage*5)){
      const row=document.createElement('li');row.className='dictionary-row';
      const label=document.createElement('strong');label.className='dictionary-entry';label.textContent=pair.join(' ↔ ');
      const button=document.createElement('button');button.type='button';button.className='text-action';button.textContent='Remover';
      button.disabled=synonymBusy||$('synonym-save').disabled;
      button.onclick=()=>saveSynonym(pair,true);
      row.append(label,button);$('synonym-list').append(row);
    }
    $('synonym-page-status').textContent=synonymPage+' / '+pages;
    $('synonym-pages').hidden=pages===1;
    $('synonym-previous').disabled=synonymPage===1;
    $('synonym-next').disabled=synonymPage===pages;
  }
  async function loadSynonyms(){
    const data=await jsonRequest('/api/dictionary/synonyms');
    synonymPairs=data.pairs||[];
    $('synonym-save').disabled=Boolean(data.dictionaryError);
    $('synonym-state').textContent=data.dictionaryError||synonymPairs.length+' pares personalizados. Só valem quando os sinônimos estão ativados no filtro.';
    renderSynonyms();
  }
  async function saveSynonym(pair,remove=false){
    if(synonymBusy||$('synonym-save').disabled)return;
    synonymBusy=true;$('synonym-save').disabled=true;renderSynonyms();
    try{
      await jsonRequest('/api/dictionary/synonyms/save',{pair,remove});
      if(!remove)$('synonym-form').reset();
      await loadSynonyms();
      LiveSearch.synonymsChanged();
    }catch(error){$('synonym-state').textContent=error.message;}
    finally{synonymBusy=false;$('synonym-save').disabled=false;renderSynonyms();}
  }
  $('view-synonyms').onclick=()=>showDictionary('synonyms');
  $('synonym-form').onsubmit=event=>{event.preventDefault();saveSynonym([$ ('synonym-term-a').value,$('synonym-term-b').value]);};
  $('synonym-previous').onclick=()=>{synonymPage--;renderSynonyms();};
  $('synonym-next').onclick=()=>{synonymPage++;renderSynonyms();};
  function editStory(story=null){
    editingStory=story;
    $('story-editor-title').textContent=story?'Editar narrativa':'Nova narrativa';
    $('personal-story-label').value=story?.label||'';
    $('personal-story-reference').value=story?.reference||'';
    $('personal-story-clues').value=story?.clues.join('; ')||'';
    $('personal-story-feedback').hidden=true;
    openLayer('personal-story');
  }
  function searchTerm(term){
    AppTabs.showSearch();
    $('search-input').value=term;
    LiveSearch.submit();
  }
  $('view-aliases').onclick=()=>showDictionary('aliases');
  $('view-stories').onclick=()=>showDictionary('stories');
  $('story-new').onclick=()=>editStory();
  $('story-previous').onclick=()=>{storyPage--;renderPersonalStories();};
  $('story-next').onclick=()=>{storyPage++;renderPersonalStories();};
  $('story-list').onclick=event=>{
    const button=event.target.closest('[data-story-search],[data-story-edit]');
    if(!button)return;
    if(button.hasAttribute('data-story-search'))searchTerm(visibleStories[Number(button.dataset.storySearch)].label);
    else editStory(visibleStories[Number(button.dataset.storyEdit)]);
  };
  $('personal-story-form').onsubmit=async event=>{
    event.preventDefault();
    const button=$('personal-story-save');
    const message=$('personal-story-feedback');
    message.hidden=true;
    button.disabled=true;
    try{
      const entry=await jsonRequest('/api/stories/save',{
        id:editingStory?.id,label:$('personal-story-label').value,reference:$('personal-story-reference').value,
        clues:$('personal-story-clues').value.split(/[;\n]/).map(term=>term.trim()).filter(Boolean)
      });
      await loadStories();
      storyPage=Math.floor(stories.filter(story=>story.personal).findIndex(story=>story.id===entry.id)/pageSize)+1;
      renderPersonalStories();
      if(state.activeModal==='personal-story'){
        closeLayer();
        $('story-new').focus();
      }
      toast('Narrativa salva.');
      SearchPreferences.refreshSearch();
    }catch(error){
      message.textContent=error.message;
      message.hidden=false;
    }finally{button.disabled=false;}
  };

  function entries(){
    const byId=new Map(stories.map(story=>[story.id,story]));
    return Object.entries(aliases).flatMap(([id,terms])=>
      terms.map(term=>({id,term,story:byId.get(id)}))
    ).sort((a,b)=>a.term.localeCompare(b.term,'pt-BR'));
  }
  function render(){
    const all=entries();
    const query=normalize(filter.value);
    const filtered=all.filter(({term,story})=>normalize([term,story?.label,story?.reference].join(' ')).includes(query));
    const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
    currentPage=Math.min(currentPage,pages);
    visible=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);
    $('alias-directory').hidden=!all.length;
    $('alias-state').textContent=all.length
      ? filtered.length===0?'Nenhuma associação encontrada.':`${all.length} ${all.length===1?'associação salva':'associações salvas'}`
      : stories.length?'Salve suas expressões para encontrar narrativas bíblicas.':'Narrativas indisponíveis.';
    list.innerHTML=visible.map(({term,story},index)=>`
      <li class="dictionary-row">
        <div class="dictionary-entry">
          <strong>${escapeHTML(term)}</strong>
          <span>${escapeHTML(story?.label||'Narrativa indisponível')}${story?.reference?' · '+escapeHTML(story.reference):''}</span>
        </div>
        <div class="dictionary-row-actions">
          <button type="button" class="text-action" data-alias-test="${index}">Buscar</button>
          <button type="button" class="text-action" data-alias-edit="${index}">Editar</button>
        </div>
      </li>`).join('');
    $('alias-pages').hidden=pages===1;
    $('alias-previous').disabled=currentPage===1;
    $('alias-next').disabled=currentPage===pages;
    $('alias-page-status').textContent=`Página ${currentPage} de ${pages}`;
    $('alias-undo-panel').hidden=!removed;
  }
  function notify(message=''){
    feedback.textContent=message;
    feedback.hidden=!message;
  }
  function renderStories(selected){
    const query=normalize(storyFilter.value);
    const matches=stories.filter(story=>normalize(story.label+' '+story.reference).includes(query));
    const placeholder=new Option(matches.length?'Selecione uma narrativa':'Nenhuma narrativa encontrada','');
    placeholder.disabled=true;
    picker.replaceChildren(placeholder,...matches.map(story=>new Option(story.label+' · '+story.reference,story.id)));
    picker.value=matches.some(story=>story.id===selected)?selected:'';
    $('alias-add').disabled=!matches.length;
  }
  function edit(entry=null){
    editing=entry;
    $('alias-title').textContent=entry?'Editar associação':'Nova associação';
    $('alias-remove').hidden=!entry;
    input.value=entry?.term||'';
    storyFilter.value='';
    renderStories(entry?.id);
    notify();
    openLayer('alias');
  }
  async function save(items){
    const next={};
    for(const {id,term} of items)(next[id]??=[]).push(term);
    try{aliases=await jsonRequest('/api/dictionary/aliases',{previous:aliases,associations:next});return true;}
    catch(error){return false;}
  }
  function complete(message){
    closeLayer();
    render();
    $('alias-new').focus();
    if(message)toast(message);
    SearchPreferences.refreshSearch();
  }
  $('alias-new').addEventListener('click',()=>edit());
  storyFilter.addEventListener('input',()=>renderStories(picker.value));
  filter.addEventListener('input',()=>{currentPage=1;render();});
  $('alias-previous').addEventListener('click',()=>{currentPage--;render();});
  $('alias-next').addEventListener('click',()=>{currentPage++;render();});
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-alias-edit],[data-alias-test]');
    if(!button)return;
    if(button.hasAttribute('data-alias-edit'))edit(visible[Number(button.dataset.aliasEdit)]);
    else{
      const {term}=visible[Number(button.dataset.aliasTest)];
      searchTerm(term);
    }
  });
  $('alias-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const term=input.value.trim();
    const id=picker.value;
    if(term.length<4||!normalize(term)||!stories.some(story=>story.id===id)){
      notify('Informe uma expressão de 4 a 90 caracteres e selecione a narrativa.');
      return;
    }
    const remaining=entries().filter(entry=>entry.id!==editing?.id||entry.term!==editing.term);
    if(remaining.some(entry=>normalize(entry.term)===normalize(term))){
      notify('Esta expressão já está cadastrada. Edite a associação existente.');
      return;
    }
    if(remaining.length>=maxEntries||remaining.filter(entry=>entry.id===id).length>=maxPerStory){
      notify('Limite de 50 associações no total e 15 por narrativa.');
      return;
    }
    const button=$('alias-add');
    button.disabled=true;
    $('alias-remove').disabled=true;
    const stored=await save([...remaining,{id,term}]);
    button.disabled=false;
    $('alias-remove').disabled=false;
    if(!stored){
      notify('Não foi possível salvar neste aparelho.');
      return;
    }
    removed=null;
    filter.value='';
    currentPage=Math.floor(entries().findIndex(entry=>entry.id===id&&entry.term===term)/pageSize)+1;
    complete(editing?'Associação atualizada.':'Associação salva.');
  });
  $('alias-remove').addEventListener('click',async()=>{
    if(!editing)return;
    const remaining=entries().filter(entry=>entry.id!==editing.id||entry.term!==editing.term);
    $('alias-remove').disabled=true;
    $('alias-add').disabled=true;
    const stored=await save(remaining);
    $('alias-remove').disabled=false;
    $('alias-add').disabled=false;
    if(!stored){notify('Não foi possível remover neste aparelho.');return;}
    removed=editing;
    complete();
  });
  $('alias-undo').addEventListener('click',async()=>{
    if(!removed)return;
    $('alias-undo').disabled=true;
    const stored=await save([...entries(),removed]);
    $('alias-undo').disabled=false;
    if(!stored){toast('Não foi possível restaurar a associação.');return;}
    removed=null;
    filter.value='';
    currentPage=1;
    complete('Associação restaurada.');
  });
  const backupInput=$('dictionary-import');
  const exportButton=$('dictionary-export');
  const backupStatus=$('dictionary-backup-status');
  function setBackupStatus(message,busy=false){
    backupStatus.textContent=message;
    backupStatus.hidden=!message;
    backupInput.disabled=busy;
    exportButton.disabled=busy;
  }
  $('dictionary-backup').onclick=()=>openLayer('dictionary-backup');
  window.DictionaryBackup={
    complete(message){setBackupStatus(message);}
  };
  exportButton.onclick=async()=>{
    setBackupStatus('Preparando arquivo…',true);
    try{
      const data=await jsonRequest('/api/dictionary/export');
      const json=JSON.stringify(data,null,2)+'\n';
      if(typeof window.NativeHinos?.saveDictionaryBackup==='function'){
        window.NativeHinos.saveDictionaryBackup(json);
        return;
      }
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const link=document.createElement('a');
      link.href=url;
      link.download='Buscador-de-Hinos-Dicionario.json';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      setBackupStatus('Arquivo preparado para download.');
    }catch(error){setBackupStatus(error.message);}
  };
  backupInput.onchange=async()=>{
    const file=backupInput.files?.[0];
    backupInput.value='';
    if(!file)return;
    if(file.size>256000){setBackupStatus('Arquivo maior que o limite de 256 KB.');return;}
    setBackupStatus('Lendo backup…',true);
    try{
      let data;
      try{data=JSON.parse(await file.text());}
      catch(error){throw Error('O arquivo escolhido não contém um JSON válido.');}
      const result=await jsonRequest('/api/dictionary/restore',data);
      removed=null;
      filter.value='';
      currentPage=storyPage=1;
      await loadStories();
      SearchPreferences.refreshSearch();
      LiveSearch.synonymsChanged();
      const summary=`Restaurado: ${result.addedStories} narrativa(s), ${result.addedAliases} associação(ões) e ${result.addedSynonyms||0} par(es) de sinônimos.`;
      const conflicts=result.conflicts?` ${result.conflicts} expressão(ões) já vinculada(s) no aparelho foi(foram) mantida(s).`:'';
      setBackupStatus(summary+conflicts);
    }catch(error){setBackupStatus(error.message);}
  };
  loadStories().catch(()=>{render();renderPersonalStories();});
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
    try{
      const result=await jsonRequest('/api/repertoire/mark',{hymn_id:Number(id),not_learned:flag});
      toast(flag?'Hino marcado como não aprendido. Continua disponível na seção separada.':'Hino devolvido às indicações principais.');
      if(state.ready&&(state.effectiveQuery||state.searchFilters?.length)){
        const epoch=state.searchEpoch;
        const response=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,parsed_query:true,...searchRestrictions(),
          semantic_hints:state.semanticHints,vector_query:state.vectorQuery,vector_model:'harrier-600m-q4f16',settings:state.searchSettings});
        if(epoch===state.searchEpoch){
          state.page=1;state.total=response.total;state.hasMore=response.has_more;state.lastResults=response.results.slice();
          
          $('results-list').innerHTML=response.results.length?response.results.map(resultCard).join(''):
            response.not_learned_total?'<div class="empty-results"><h3>Todos os hinos relacionados estão em Não aprendidos</h3></div>':'<div class="empty-results"><h3>Nenhum hino encontrado</h3></div>';
          updatePages();
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
    if(operation||(!state.effectiveQuery&&!state.searchFilters?.length))return;
    operation=true;const next=hiddenPage+1;
    try{
      const response=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,parsed_query:true,not_learned_page:next,
        ...searchRestrictions(),semantic_hints:state.semanticHints,vector_query:state.vectorQuery,vector_model:'harrier-600m-q4f16',settings:state.searchSettings});
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


// Harrier: inference on device, status based on actual applied ranking.
const EmbeddingSearch=(()=>{
  let running=false,queued=null;
  function show(message){
    const target=$('vector-results-state');if(target)target.textContent=message;
    const settings=$('vector-state');if(settings)settings.textContent=message;
  }
  function report(data,ms){
    if(data?.vector_evaluated){
      const count=data.vector_contributors||0;
      show(count>0?'Harrier aplicado · '+count+' hinos receberam pontuação vetorial · '+(data.vector_page_contributors||0)+' nesta página'+(Number.isFinite(ms)?' · '+ms+' ms':''):'Harrier consultado · nenhuma pontuação vetorial aplicada'+(Number.isFinite(ms)?' · '+ms+' ms':''));
    }else{
      const status=HarrierRuntime.status();
      let reason=state.searchSettings.vectorMode==='off'?'modelo desativado nas preferências':
        state.searchSettings.mode==='literal'?'modo literal':data?.exact_number?'número exato':
        data?.bible_reference?'referência bíblica: motor contextual dedicado':
        !state.effectiveQuery?'somente filtros':status.preparing?'validando Harrier':
        status.error?'Harrier indisponível: '+status.error:!status.ready?'Harrier não está pronto':
        !state.status?.vector_count?'nenhum hino vinculado à base vetorial':'Harrier ainda não utilizado nesta pesquisa';
      show('Busca local · '+reason);
    }
  }
  async function maybeUpdate(query,epoch){
    if(!query||state.searchSettings.vectorMode==='off'||state.searchSettings.mode==='literal'||!state.ready||
       !HarrierRuntime.available()||!state.status?.vector_count||state.exactNumber||
       (typeof ScriptureIndex!=='undefined'&&ScriptureIndex.parse(query))||/["“”]/.test(query))return;
    if(running){queued={query,epoch};return;}
    running=true;show('Harrier calculando embedding no aparelho · busca local já disponível');
    try{
      const answer=await HarrierRuntime.embed(query);
      if(epoch!==state.searchEpoch||!state.ready||state.searchSettings.vectorMode==='off'||state.searchSettings.mode==='literal'||
         !HarrierRuntime.available()||state.page!==1||state.busy)return;
      const result=await jsonRequest('/api/search',{query:state.effectiveQuery,page:1,parsed_query:true,...searchRestrictions(),
        semantic_hints:state.semanticHints,vector_query:answer.vector,vector_model:'harrier-600m-q4f16',settings:state.searchSettings});
      if(epoch!==state.searchEpoch||state.page!==1||state.busy||!HarrierRuntime.available())return;
      if(result.vector_evaluated)state.vectorQuery=answer.vector;
      state.total=result.total;state.page=1;state.hasMore=result.has_more;state.lastResults=result.results.slice();
      $('results-list').innerHTML=result.results.length?result.results.map(resultCard).join(''):
        result.not_learned_total?'<div class="empty-results"><h3>Somente hinos ainda não aprendidos</h3><p>Veja a seção separada abaixo.</p></div>':'<div class="empty-results"><h3>Nenhum resultado</h3><p>Experimente ampliar o contexto.</p></div>';
      RepertoireUI.renderSearch(result);updatePages();OfflineComparison.refresh();
      $('results-subtitle').textContent=result.total+' resultados · '+(result.vector_evaluated?'busca híbrida':'busca local');
      report(result,answer.ms);
    }catch(error){if(epoch===state.searchEpoch)show('Busca local preservada · Harrier: '+error.message);}
    finally{running=false;const next=queued;queued=null;if(next&&next.epoch===state.searchEpoch)maybeUpdate(next.query,next.epoch);}
  }
  return {maybeUpdate,show,report};
})();
window.addEventListener('harrier-state',async event=>{
  state.vectorQuery=null;state.searchEpoch++;
  try{
    await refreshStatus();
    if(!event.detail.ready){EmbeddingSearch.show('Busca local · Harrier desativado ou indisponível');}
    if(state.ready&&state.effectiveQuery&&!state.busy){
      await performSearch(state.effectiveQuery,{preserveContext:true,semanticHints:state.semanticHints});
    }
  }catch(error){EmbeddingSearch.show('Busca local · '+error.message);}
});


const OfflineComparison=(()=>{
  function compare(){
    const selected=state.lastResults.slice(0,5);
    if(!selected.length){toast('Primeiro faça uma pesquisa.');return;}
    const text='Afinidade estimada dos primeiros resultados\n\n'+selected.map((h,i)=>`${i+1}. ${h.number?h.number+' · ':''}${h.title} · ${h.relevance_percent}%${h.reason?'\n'+h.reason:''}${h.snippet?'\n“'+h.snippet+'”':''}`).join('\n\n');
    appendConversation('assistant',text);
  }
  function detail(){
    const h=state.currentHymn;if(!h)return;
    const themes=(h.topics||[]).slice(0,6).join(', ')||'Nenhum tema reconhecido';
    $('modal-summary-output').textContent='Temas identificados pelo índice offline: '+themes+'. Verifique a letra antes de selecionar o hino.';
    $('modal-summary-output').classList.remove('hidden');
  }

  $('offline-compare').addEventListener('click',compare);
  $('modal-summary-ask').addEventListener('click',detail);
  return {refresh(){$('offline-compare').disabled=!state.lastResults.length;$('modal-summary-ask').disabled=!state.currentHymn;}};
})();
refreshStatus().catch(e=>toast('Não foi possível acessar a base local: '+e.message));
