'use strict';
(()=>{
  const native=window.NativeHarrierPackage;
  if(!native)return;
  const el=id=>document.getElementById(id);
  const panel=el('harrier-package-panel'),bar=el('harrier-progress'),status=el('harrier-package-status');
  const download=el('harrier-download'),cancel=el('harrier-cancel'),remove=el('harrier-remove');
  panel.classList.remove('hidden');
  function refresh(){
    try{
      const state=JSON.parse(native.status());
      const running=state.phase==='downloading',removing=state.phase==='removing',installed=state.phase==='installed';
      const done=Math.max(0,Math.min(366595730,Number(state.downloaded)||0));
      bar.value=done;
      status.textContent=state.message+(running?' · '+(done/1e6).toFixed(1)+' / 366,6 MB':'');
      download.classList.toggle('hidden',running||removing||installed);
      cancel.classList.toggle('hidden',!running);
      remove.classList.toggle('hidden',running||removing||!(installed||state.phase==='error'));
      download.disabled=running||removing||installed;
      cancel.disabled=!running;
      remove.disabled=running||removing;
    }catch(error){status.textContent='Não foi possível consultar o pacote.';}
  }
  download.addEventListener('click',()=>{native.install();refresh();});
  cancel.addEventListener('click',()=>{native.cancel();refresh();});
  remove.addEventListener('click',()=>{if(window.confirm('Remover somente os arquivos do Harrier? A biblioteca e o dicionário serão preservados.')){native.remove();refresh();}});
  refresh();setInterval(refresh,1000);
})();
