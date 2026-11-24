'use strict';
/* Controlador Android WebView, separado da pontuação e sem chamadas de inferência.
 * Injetado pelo app.js depois que estado, busca e cartões existem.
 */
(function(root){
  function createSearchTuner(deps){
    const state=deps.state,byId=deps.byId,card=deps.card,submit=deps.submit;
    const inputs={topic:'tuner-topic',narrative:'tuner-narrative',events:'tuner-events',min:'tuner-min'};
    const read=(key,otherwise)=>{try{const raw=localStorage.getItem(key);return raw===null?otherwise:JSON.parse(raw);}catch(error){return otherwise;}};
    let cfg=SemanticTuner.config(read(SemanticTuner.STORAGE_KEY,{}));
    let history=SemanticTuner.history(read(SemanticTuner.HISTORY_KEY,[]));
    let pool=[],baseData=null,visibleCount=10;
    const store=()=>{try{localStorage.setItem(SemanticTuner.STORAGE_KEY,JSON.stringify(cfg));}catch(error){console.warn('Configuração não persistida',error.message);}};
    const isDirect=()=>cfg.enabled;
    const isActive=()=>cfg.enabled&&pool.length>0&&!state.exactNumber&&
      (!SemanticTuner.usesSearchOrder(cfg)||cfg.min>0);
    function sync(){
      byId('tuner-enabled').checked=cfg.enabled;
      for(const [key,id] of Object.entries(inputs)){
        byId(id).value=cfg[key];
        byId(id+'-value').textContent=cfg[key]+(key==='min'?'':'%');
        byId(id).disabled=!cfg.enabled;
      }
      document.documentElement.classList.toggle('semantic-direct-mode',cfg.enabled);
      for(const button of document.querySelectorAll('[data-tuner-preset]')){
        const preset=SemanticTuner.presets[button.dataset.tunerPreset];
        button.setAttribute('aria-pressed',String(Boolean(preset&&Object.entries(preset).every(([key,value])=>cfg[key]===value))));
      }
    }
    function renderHistory(){
      for(const id of ['tuner-history-home-list','tuner-history-results-list']){
        const target=byId(id);target.replaceChildren();
        if(!history.length){const empty=document.createElement('span');empty.className='tuner-history-empty';empty.textContent='Nenhuma pesquisa registrada neste aparelho.';target.appendChild(empty);continue;}
        for(const query of history){
          const button=document.createElement('button');button.type='button';button.textContent=query;button.title=query;
          button.addEventListener('click',()=>{byId('search-input').value=query;submit(query);});
          target.appendChild(button);
        }
      }
    }
    function record(query){
      history=SemanticTuner.addHistory(history,query);
      try{localStorage.setItem(SemanticTuner.HISTORY_KEY,JSON.stringify(history));}catch(error){console.warn('Histórico não persistido',error.message);}
      renderHistory();
    }
    function render(){
      sync();
      const status=byId('tuner-status');
      if(!baseData){status.textContent='Pesquise para ajustar resultados.';return;}
      if(!isActive()){
        state.page=baseData.page;
        const normal=(baseData.results||[]).map(hit=>pool.find(item=>item.id===hit.id)||hit);
        state.lastResults=normal.slice();
        byId('results-list').innerHTML=normal.length?normal.map(card).join(''):'<div class="empty-results"><h3>Nenhum hino encontrado</h3><p>Tente uma pesquisa mais ampla.</p></div>';
        byId('results-subtitle').textContent=state.exactNumber?'Resultado por número: ordem preservada.':baseData.total+' resultados · classificação padrão';
        byId('load-more').classList.toggle('hidden',!baseData.has_more);
        byId('load-more').textContent='Carregar mais '+baseData.page_size+' hinos';
        status.textContent=state.exactNumber?'Pesquisa por número não é reordenada.':'Ordem da busca contextual. Ajuste os pesos para personalizar.';
        return;
      }
      const ranked=SemanticTuner.rank(pool,cfg);
      const visible=ranked.slice(0,visibleCount);
      state.lastResults=visible.slice();
      byId('results-list').innerHTML=visible.length?visible.map(card).join(''):'<div class="empty-results"><h3>Nenhum candidato atingiu o mínimo</h3><p>Reduza o índice mínimo ou altere os pesos.</p></div>';
      byId('load-more').classList.toggle('hidden',visibleCount>=ranked.length);
      byId('load-more').textContent='Ver mais '+Math.min(10,ranked.length-visibleCount)+' candidatos';
      const limit=baseData.total>pool.length?' · até '+pool.length+' candidatos iniciais':'';
      byId('results-subtitle').textContent=ranked.length+' candidatos com índice suficiente'+limit;
      status.textContent=ranked.length+' de '+pool.length+' candidatos no painel. Pesos recalculados instantaneamente; nenhuma nova inferência foi executada.';
    }
    function accept(data){
      baseData=data;
      pool=Array.isArray(data.tuner_candidates)?data.tuner_candidates.slice(0,SemanticTuner.LIMIT):[];
      visibleCount=10;
      render();
    }
    function more(){if(!isActive())return false;visibleCount+=10;render();return true;}
    function candidates(limit=6){
      if(!cfg.enabled||!pool.length||state.exactNumber)return [];
      return SemanticTuner.rank(pool,{...cfg,min:0}).slice(0,Math.max(0,Math.min(12,limit)))
        .map(h=>({id:h.id,title:h.title}));
    }
    function updateNli(id,kind,modelRevision){
      if(typeof id!=='number'||!kind||!['entailment','neutral','contradiction'].includes(kind))return false;
      const item=pool.find(r=>r.id===id);if(!item)return false;
      item.nli_label=kind;
      item.nli_model_revision=modelRevision;
      if(isActive())render();
      else{
        const index=state.lastResults.findIndex(hit=>hit.id===id);
        if(index>=0){
          state.lastResults[index]=item;
          const existing=byId('results-list').querySelector('[data-card-id="'+id+'"]');
          if(existing)existing.outerHTML=card(item);
        }
      }
      return true;
    }
    function clearPool(){pool=[];baseData=null;visibleCount=10;sync();byId('tuner-status').textContent='Pesquise para ajustar resultados.';}
    for(const [key,id] of Object.entries(inputs)){
      byId(id).addEventListener('input',()=>{cfg[key]=Number(byId(id).value);store();render();});
    }
    byId('tuner-enabled').addEventListener('change',()=>{cfg.enabled=byId('tuner-enabled').checked;store();render();});
    for(const button of document.querySelectorAll('[data-tuner-preset]')){
      button.addEventListener('click',()=>{
        const preset=SemanticTuner.presets[button.dataset.tunerPreset];
        if(!preset)return;
        cfg=SemanticTuner.config({...cfg,...preset,enabled:true});store();render();
      });
    }
    byId('tuner-reset').addEventListener('click',()=>{cfg=SemanticTuner.config({...SemanticTuner.presets.balanced,enabled:true});store();render();});
    document.querySelectorAll('[data-tuner-clear-history]').forEach(button=>button.addEventListener('click',()=>{
      history=[];try{localStorage.removeItem(SemanticTuner.HISTORY_KEY);}catch(error){console.warn(error.message);}
      renderHistory();
    }));
    sync();renderHistory();
    return {accept,more,candidates,updateNli,record,clearPool,isDirect,isActive};
  }
  if(root)root.createSearchTuner=createSearchTuner;
})(typeof window==='object'?window:null);
