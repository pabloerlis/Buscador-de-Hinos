'use strict';
(()=>{
  const native=window.NativeHarrierPackage;
  if(!native)return;
  const el=id=>document.getElementById(id);
  const panel=el('harrier-package-panel'),bar=el('harrier-progress'),status=el('harrier-package-status');
  const download=el('harrier-download'),cancel=el('harrier-cancel'),remove=el('harrier-remove');
  const test=el('harrier-test'),result=el('harrier-diagnostic-result');
  let preparing=false;
  panel.classList.remove('hidden');
  window.HarrierDiagnostic={complete(event){
    preparing=false;
    if(event.ok){
      const r=event.result;
      result.textContent='Aprovado: 3/3 vetores · similaridade mínima '+(r.min_cosine*100).toFixed(3)+'% · carregamento '+r.load_ms+' ms · inferências '+r.cases.map(x=>x.ms+' ms').join(', ')+'.';
    }else result.textContent='Falha: '+(event.error||'diagnóstico indisponível');
    refresh();
  }};
  test.addEventListener('click',async()=>{
    if(preparing)return;
    preparing=true;result.textContent='Preparando tokenizer e conferindo tokens de referência…';refresh();
    try{
      const read=async path=>{const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error('Arquivo local indisponível: '+path);return response.json();};
      const [tokenizer,config,ref]=await Promise.all([read('/harrier/tokenizer.json'),read('/harrier/tokenizer_config.json'),read('harrier-conformance.json')]);
      const encode=HarrierTokenization.create(tokenizer,config);
      const ids=HarrierTokenization.conform(encode,ref);
      result.textContent='Tokenização aprovada. Executando três inferências…';
      native.diagnose(JSON.stringify(ids));
    }catch(error){preparing=false;result.textContent='Falha: '+error.message;refresh();}
  });
  function refresh(){
    try{
      const state=JSON.parse(native.status());
      const running=state.phase==='downloading',removing=state.phase==='removing',testing=state.phase==='testing',installed=state.phase==='installed';
      const done=Math.max(0,Math.min(366595730,Number(state.downloaded)||0));
      bar.value=done;
      status.textContent=state.message+(running?' · '+(done/1e6).toFixed(1)+' / 366,6 MB':'');
      download.classList.toggle('hidden',running||removing||installed||testing);
      cancel.classList.toggle('hidden',!running);
      remove.classList.toggle('hidden',running||removing||testing||!(installed||state.phase==='error'));
      test.classList.toggle('hidden',!(installed||testing));test.disabled=testing||preparing;
      download.disabled=running||removing||installed||testing;
      cancel.disabled=!running;
      remove.disabled=running||removing||testing||preparing;
    }catch(error){status.textContent='Não foi possível consultar o pacote.';}
  }
  download.addEventListener('click',()=>{native.install();refresh();});
  cancel.addEventListener('click',()=>{native.cancel();refresh();});
  remove.addEventListener('click',()=>{if(window.confirm('Remover somente os arquivos do Harrier? A biblioteca e o dicionário serão preservados.')){native.remove();refresh();}});
  refresh();setInterval(refresh,1000);
})();
