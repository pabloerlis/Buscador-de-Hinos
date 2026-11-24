'use strict';
const HarrierRuntime=(()=>{
  const native=window.NativeHarrierPackage;
  const PREFIX='Instruct: Retrieve passages from Portuguese Christian hymns that express the biblical context or spiritual meaning of the query.\nQuery: ';
  const MODEL='harrier-600m-q4f16';
  let encode=null,ready=false,preparing=false,attempted=false,sequence=0,active=null,lastError='',diagnostic=null;
  const el=id=>document.getElementById(id);
  function nativeStatus(){try{return JSON.parse(native?.status()||'{}');}catch(e){return {};}}
  function available(){return !!native&&ready&&!!encode&&nativeStatus().ready===true;}
  function deactivate(reason){
    ready=false;encode=null;diagnostic=null;lastError=reason||'';
    if(active){clearTimeout(active.timer);active.reject(Error(reason||'Modelo desativado'));active=null;}
    if(typeof VectorIndex!=='undefined')VectorIndex.clear();
    if(typeof OfflineAPI!=='undefined')OfflineAPI.request('/api/vector/clear').catch(()=>{});
    window.dispatchEvent(new CustomEvent('harrier-state',{detail:{ready:false}}));
  }
  const read=async path=>{const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error('Arquivo local indisponível: '+path);return response.json();};
  async function validate(){
    if(preparing||!native||nativeStatus().phase!=='installed')return;
    attempted=true;preparing=true;deactivate('');lastError='';el('harrier-diagnostic-result').textContent='Validando tokenizer e modelo automaticamente…';refresh();
    try{
      const [tokenizer,config,ref]=await Promise.all([read('/harrier/tokenizer.json'),read('/harrier/tokenizer_config.json'),read('harrier-conformance.json')]);
      encode=HarrierTokenization.create(tokenizer,config);
      const ids=HarrierTokenization.conform(encode,ref);
      native.diagnose(JSON.stringify(ids));
    }catch(error){preparing=false;encode=null;lastError=error.message;el('harrier-diagnostic-result').textContent='Falha: '+lastError;refresh();}
  }
  async function onDiagnostic(event){
    if(!preparing)return;
    try{
      if(!event.ok||!encode||nativeStatus().ready!==true)throw Error(event.error||'Diagnóstico não aprovado');
      const coverage=await OfflineAPI.request('/api/vector/refresh');
      if(nativeStatus().ready!==true)throw Error('Modelo desativado');
      if(coverage.error&&coverage.count===0&&coverage.source_count===0)throw Error(coverage.error);
      diagnostic=event.result;ready=true;lastError='';
      el('harrier-diagnostic-result').textContent='Validado: 3/3 vetores · cosseno mínimo '+(diagnostic.min_cosine*100).toFixed(3)+'% · '+coverage.count+' hinos vinculados.';
      window.dispatchEvent(new CustomEvent('harrier-state',{detail:{ready:true,coverage}}));
    }catch(error){deactivate(error.message);el('harrier-diagnostic-result').textContent='Falha: '+lastError;}
    finally{preparing=false;refresh();}
  }
  window.HarrierDiagnostic={complete:onDiagnostic};
  function complete(event){
    if(!active||String(event.id)!==active.id)return;
    const item=active;active=null;clearTimeout(item.timer);
    if(event.ok&&event.model===MODEL&&Array.isArray(event.vector)&&event.vector.length===1024&&event.vector.every(Number.isFinite)&&available())item.resolve(event);
    else item.reject(Error(event.error||'Inferência Harrier inválida'));
  }
  function embed(query){
    if(!available())return Promise.reject(Error(lastError||'Modelo não validado'));
    if(active)return Promise.reject(Error('Inferência anterior em andamento'));
    let ids;try{ids=encode(PREFIX+query);}catch(e){return Promise.reject(e);}
    return new Promise((resolve,reject)=>{
      const id=String(++sequence);
      const timer=setTimeout(()=>{if(active?.id===id){active=null;reject(Error('Tempo limite da inferência'));}},90000);
      active={id,resolve,reject,timer};
      try{native.embed(id,JSON.stringify(ids));}catch(e){clearTimeout(timer);active=null;reject(e);}
    });
  }
  function refresh(){
    if(!native)return;
    const s=nativeStatus(),running=s.phase==='downloading',removing=s.phase==='removing'||s.removing,testing=s.phase==='testing',installed=s.phase==='installed';
    if((running||removing||s.phase==='absent'||s.phase==='error')&&(ready||encode)&&!preparing){deactivate('Pacote indisponível');attempted=false;}
    if(!installed&&!testing&&!preparing)attempted=false;
    if(ready&&s.ready!==true&&!preparing){deactivate('Sessão encerrada');attempted=false;}
    el('harrier-progress').value=Math.max(0,Math.min(366595730,Number(s.downloaded)||0));
    el('harrier-package-status').textContent=available()?'Harrier ativo · inferência offline':(s.message||'Modelo indisponível')+(running?' · '+(s.downloaded/1e6).toFixed(1)+' / 366,6 MB':'');
    el('harrier-download').classList.toggle('hidden',running||removing||installed||testing);
    el('harrier-cancel').classList.toggle('hidden',!running);
    el('harrier-test').classList.toggle('hidden',!(installed||testing));
    el('harrier-test').disabled=preparing||testing||!!active;
    el('harrier-remove').classList.toggle('hidden',running||removing||testing||!(installed||s.phase==='error'));
    el('harrier-remove').disabled=preparing||testing||!!active;
    if(installed&&!removing&&!attempted&&!preparing&&!ready)validate();
  }
  function start(){
    if(!native)return;
    el('harrier-package-panel').classList.remove('hidden');
    el('harrier-download').addEventListener('click',()=>{attempted=false;native.install();refresh();});
    el('harrier-cancel').addEventListener('click',()=>{native.cancel();refresh();});
    el('harrier-test').addEventListener('click',()=>{if(!active)validate();});
    el('harrier-remove').addEventListener('click',()=>{if(window.confirm('Remover somente os arquivos do Harrier? A biblioteca e o dicionário serão preservados.')){deactivate('Pacote removido');attempted=true;native.remove();refresh();}});
    refresh();setInterval(refresh,1000);
  }
  window.addEventListener('DOMContentLoaded',start,{once:true});
  return {available,embed,complete,status:()=>({ready:available(),preparing,error:lastError,phase:nativeStatus().phase})};
})();
window.HarrierRuntime=HarrierRuntime;
