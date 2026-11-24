'use strict';
// Executa os scripts do HTML e inspeciona os cartões exibidos após a busca.
// Dependências de QA: jsdom e fake-indexeddb. O APK não precisa delas.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {JSDOM}=require('jsdom');
const {indexedDB}=require('fake-indexeddb');
const assets=path.resolve(__dirname,'../app/src/main/assets');
const corpus=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const vectors=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;
const queries=['filho pródigo','Ovelha perdida','Lázaro','Jesus acalma a tempestade',
  'Mulher do fluxo de sangue','Lucas 15:11','Marcos 10:46-52','gratidão e esperança'];
async function main(){
  const dom=new JSDOM(fs.readFileSync(path.join(assets,'index.html'),'utf8'),{
    url:'https://hinos.local/',runScripts:'outside-only'});
  const win=dom.window,ctx=dom.getInternalVMContext();
  try{
    win.HTMLElement.prototype.scrollIntoView=function(){};
    Object.defineProperty(win,'crypto',{value:webcrypto});
    Object.assign(win,{TextEncoder,indexedDB,scrollTo(){},fetch:async name=>{
      const file=path.join(assets,name);
      return {ok:fs.existsSync(file),json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};
    }});
    if(vectors)win.NativeVector={embed(id,text){
      win.VectorNative.complete({id,ok:true,vector:vectors[text],ms:0});
    }};
    for(const script of win.document.querySelectorAll('script[src]')){
      const name=script.getAttribute('src');
      vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),ctx,{filename:name});
    }
    const api=win.eval('OfflineAPI'),state=win.eval('state');
    await api.request('/api/import',{data:corpus});
    const status=await win.refreshStatus();
    assert.equal(status.hymn_count,1557);
    if(vectors)assert.ok(status.vector_count>=1450);
    for(const query of queries){
      assert.ok(await win.performSearch(query));
      if(vectors&&query==='gratidão e esperança'){
        const deadline=Date.now()+10000;
        while(!win.document.getElementById('vector-results-state').textContent.includes('ranking vetorial atualizado')){
          assert.ok(Date.now()<deadline,'E5 não concluiu: '+query);
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.ok(state.vectorQuery);
      }
      const base=await api.request('/api/search',{query,vector_query:state.vectorQuery,
        settings:state.searchSettings,tuner_pool:true});
      const ids=Array.from(win.document.querySelectorAll('#results-list article'),el=>Number(el.dataset.cardId));
      const shown=ids.map(id=>{
        const h=base.tuner_candidates.find(h=>h.id===id);
        return h.collection+':'+(h.number||h.title);
      });
      console.log(query,JSON.stringify(shown));
      if(query==='filho pródigo'){
        assert.ok(shown.includes('Avulsos 2018:VEM Ó PRÓDIGO'),'Avulso diretamente ligado ao tema ausente da primeira página');
        assert.equal(win.eval('SearchTuner.more()'),false,'Usar paginação de toda a coletânea');
        assert.ok(await win.performSearch(query,{page:2}));
        const loaded=Array.from(win.document.querySelectorAll('#results-list article'),el=>Number(el.dataset.cardId));
        assert.equal(new Set(loaded).size,loaded.length);
        assert.ok(loaded.length>ids.length);
      }
      assert.deepEqual(ids,Array.from(base.results,h=>h.id),'Painel alterou a ordem padrão em '+query);
      if(query==='filho pródigo')assert.deepEqual(shown.slice(0,3).sort(),
        ['Coletânea 2018:191','Coletânea 2018:264','Coletânea 2018:286']);
    }
  }finally{win.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
