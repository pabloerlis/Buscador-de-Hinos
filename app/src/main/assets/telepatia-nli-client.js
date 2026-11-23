'use strict';
/* Telepatia NLI no Android: modelo EXTERNO, tokens auditados e inferência REAL.
 * Sem LFM3, sem chamadas de rede, sem pontuação presumida na ausência do modelo.
 * Reranking de sliders é calculado sobre rótulos em cache, não roda ONNX.
 */
const TelepatiaUI=(()=>{
  const bridge=window.NativeNLI||null;
  const el=id=>document.getElementById(id);
  const LIMIT=3;                 // primeiro protótipo: limitar custo de CPU Android
  const MAX_WINDOWS=10;
  const MAX_TEXT=12000;
  let tokenizer=null,sequenceVersion=0,activeEpoch=0,currentQuery='',currentCandidates=[];
  let modelHash='',taskSeq=0,awaiting=new Map(),preparing=null;
  const answerCache=new Map();
  const labels={entailment:'Implicação',neutral:'Neutro',contradiction:'Contradição'};
  const phraseLabel=(s)=>labels[s]||'Não avaliado';
  const statusMessage=(msg,kind='info')=>{const node=el('nli-status');if(node){node.textContent=msg;node.dataset.kind=kind;}};
  function status(){
    try{return bridge?JSON.parse(bridge.status()):{available:false,phase:'unavailable'};}
    catch(error){return {available:false,phase:'error',error:error.message};}
  }
  function refresh(){
    const s=status(), ready=Boolean(s.loaded&&s.phase==='ready');
    const select=el('nli-select'), load=el('nli-load');
    if(select)select.disabled=!s.available||s.busy;
    if(load)load.disabled=!s.available||s.busy||!s.installed||ready;
    if(!s.available)statusMessage('O APK não contém a ponte Android do Telepatia. Busca E5 disponível.','warning');
    else if(s.phase==='error')statusMessage('Telepatia: '+(s.error||'erro no modelo externo.'),'error');
    else if(ready)statusMessage('Telepatia NLI carregado: pronto para avaliar hinos.','success');
    else if(s.busy||['loading','installing'].includes(s.phase))
      statusMessage('Verificando e carregando os arquivos externos do Telepatia…');
    else if(s.installed)statusMessage('Arquivos externos selecionados. Toque em Carregar modelo.');
    else statusMessage('Selecione o ZIP externo validado do telepatia-ai/laya-pt-es-nli. Nenhum peso está incluído no APK.');
    return ready;
  }
  function reply(payload){
    const item=awaiting.get(String(payload.id));if(!item)return;
    awaiting.delete(String(payload.id));
    clearTimeout(item.timer);
    if(payload.ok&&['entailment','neutral','contradiction'].includes(payload.label))
      item.resolve(payload);
    else item.reject(new Error(payload.error||'O classificador não devolveu uma das três classes NLI.'));
  }
  function nativeEvent(evt){
    refresh();
    if(evt.ok&&['selection','load'].includes(evt.event)){
      tokenizer=null;modelHash='';answerCache.clear();
      if(currentQuery&&currentCandidates.length)run(currentQuery,currentCandidates,activeEpoch);
    }
  }
  window.TelepatiaNative={event:nativeEvent,complete:reply};
  async function tokenizerFromExternalModel(){
    if(tokenizer)return tokenizer;
    if(preparing)return preparing;
    preparing=(async()=>{
      if(!status().loaded)throw Error('Modelo NLI não carregado.');
      const [r1,r2,lib]=await Promise.all([
        fetch('/nli/tokenizer.json',{cache:'no-store'}),
        fetch('/nli/tokenizer_config.json',{cache:'no-store'}),
        import('./telepatia-tokenizers.mjs')]);
      if(!r1.ok||!r2.ok)throw Error('Arquivos do tokenizador não foram encontrados no ZIP externo.');
      if(!lib.Tokenizer)throw Error('Biblioteca local do tokenizador não foi incluída na compilação.');
      const config=await r2.json();
      const instance=new lib.Tokenizer(await r1.json(),config);
      for(const special of ['cls_token','sep_token','mask_token']){
        const item=config[special],name=typeof item==='string'?item:item?.content;
        if(!name||!Number.isInteger(instance.token_to_id(name)))
          throw Error('Tokenizador Telepatia incompatível: '+special);
      }
      tokenizer=instance;return tokenizer;
    })().finally(()=>{preparing=null;});
    return preparing;
  }
  function ask(windowTokens){
    const id=String(++taskSeq);
    if(!bridge||!bridge.infer) return Promise.reject(new Error('Ponte Android NLI indisponível.'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{awaiting.delete(id);reject(Error('Tempo excedido na inferência NLI.'));},120000);
      awaiting.set(id,{resolve,reject,timer});
      try{bridge.infer(id,JSON.stringify({input_ids:windowTokens.input_ids,marker_pos:windowTokens.marker_pos}));}
      catch(e){clearTimeout(timer);awaiting.delete(id);reject(e);}
    });
  }
  const hashText=async value=>{
    if(!window.crypto?.subtle)return String(value.length)+':'+value.slice(0,120);
    const bytes=new TextEncoder().encode(value);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  };
  function combine(parts){
    const n={entailment:0,neutral:0,contradiction:0};
    for(const label of parts)n[label]++;
    // A single stanza cannot establish global centrality.
    if(n.contradiction>0)return n.contradiction>=n.entailment?'contradiction':'neutral';
    if(n.entailment>parts.length/2)return 'entailment';
    return 'neutral';
  }
  async function classify(hymn,query,epoch){
    const full=await OfflineAPI.request('/api/hymns/'+Number(hymn.id));
    if(epoch!==activeEpoch)return;
    const text=full.lyrics||'';
    if(!text.trim())throw Error('Hino sem letra para avaliar.');
    if(text.length>MAX_TEXT)throw Error('Letra excede limite de contexto para NLI.');
    const model=status();
    const hash=await hashText(text);
    const key=JSON.stringify([model.model_sha||model.revision,query,hymn.id,hash]);
    if(answerCache.has(key))return answerCache.get(key);
    const tok=await tokenizerFromExternalModel();
    const hypothesis='A mensagem principal da letra corresponde a este contexto: '+query;
    const windows=TelepatiaSequence.sequence(tok,text,hypothesis,{maxWindows:MAX_WINDOWS});
    const labelsPerWindow=[];
    for(const win of windows){
      if(epoch!==activeEpoch||!status().loaded)return;
      const response=await ask(win);
      if(epoch!==activeEpoch)return;
      labelsPerWindow.push(response.label);
    }
    const label=combine(labelsPerWindow);
    const decision={label,windows:labelsPerWindow,model_revision:model.revision};
    answerCache.set(key,decision);
    if(answerCache.size>80)answerCache.delete(answerCache.keys().next().value);
    return decision;
  }
  async function run(query,candidates,epoch){
    if(!bridge||!status().loaded||!query||!candidates?.length)return;
    activeEpoch=epoch;
    let assessed=0;
    statusMessage('Telepatia: verificando mensagem central dos primeiros candidatos no dispositivo…');
    for(const hymn of candidates.slice(0,LIMIT)){
      if(epoch!==activeEpoch||!status().loaded)break;
      try{
        const decision=await classify(hymn,query,epoch);
        if(!decision||epoch!==activeEpoch)break;
        if(SearchTuner.updateNli(Number(hymn.id),decision.label,decision.model_revision))assessed++;
        statusMessage('Telepatia NLI: '+assessed+'/'+Math.min(candidates.length,LIMIT)+' candidatos classificados (não é probabilidade).');
      }catch(error){
        statusMessage('Telepatia NLI: '+(error?.message||String(error))+'. Busca semântica preservada.','warning');
        break;
      }
    }
    if(epoch===activeEpoch&&assessed)
      statusMessage('Telepatia: '+assessed+' avaliações reais disponíveis no ranking. Sliders não repetem inferência.','success');
  }
  function onResults(data,query,epoch){
    activeEpoch=++sequenceVersion;
    if(!data||!query||!SearchTuner.isDirect())return;
    currentQuery=String(query);
    currentCandidates=SearchTuner.candidates(LIMIT);
    if(status().loaded)run(currentQuery,currentCandidates,activeEpoch);
    else refresh();
  }
  function reset(){activeEpoch=++sequenceVersion;currentQuery='';currentCandidates=[];}
  if(el('nli-select'))el('nli-select').addEventListener('click',()=>{if(bridge?.selectModel)bridge.selectModel();});
  if(el('nli-load'))el('nli-load').addEventListener('click',()=>{if(bridge?.loadModel)bridge.loadModel();});
  refresh();
  return {onResults,reset,refresh,combine};
})();
window.TelepatiaUI=TelepatiaUI;
