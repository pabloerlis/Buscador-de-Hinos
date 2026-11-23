'use strict';
// Regressão do bloqueio "Interpretando o pedido": o Java só aceitava IDs numéricos
// e o chat anterior usava chat-local-N. Execute a UI REAL do APK, não um mock do handler.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const java=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/br/com/buscadordehinos/app/MainActivity.java'),'utf8');
assert.match(java,/requestId\.matches\("\[0-9\]\{1,12\}"\)/);
assert.match(java,/Identificador de gera[çc][aã]o inv[aá]lido/);
const start=source.indexOf('const HymnChatUI=(()=>{');
const end=source.indexOf('\nrefreshStatus().catch(',start);
assert.ok(start>0&&end>start,'Código real de UI não encontrado');
const actualUI=source.slice(start,end);
const HymnChatTools=require('../app/src/main/assets/local-hymn-chat.js');

function fixture({silent=false}={}){
  const nodes=new Map(),calls=[],cancelled=[],timeouts=new Map(),intervals=new Map();
  let timerId=0;
  const element=()=>{
    const children=[],attrs=new Map(),classes=new Set();
    return {children,attrs,className:'',classList:{toggle(c,on){on?classes.add(c):classes.delete(c)},
      add(c){classes.add(c)},remove(c){classes.delete(c)}},
      value:'',textContent:'',disabled:false,scrollTop:0,scrollHeight:0,
      appendChild(child){children.push(child);return child},
      replaceChildren(...list){children.splice(0,children.length,...list)},
      get firstElementChild(){return children[0]||null},
      setAttribute(k,v){attrs.set(k,v)},
      focus(){},
      addEventListener(type,fn){this[type]=fn;}
    };
  };
  const $=name=>{
    if(!nodes.has(name))nodes.set(name,element());
    return nodes.get(name);
  };
  const window={
    NativeGGUF:{
      status:()=>JSON.stringify({loaded:true,busy:false,generationStage:2,elapsedMs:3200,promptTokens:123}),
      generate(prompt,id,grammar,maxTokens,timeoutMs){
        calls.push({prompt,id,grammar,maxTokens,timeoutMs});
        // Espelha o veto silencioso do JNI antes desta correção.
        if(!/^[0-9]{1,12}$/.test(id)||silent)return;
        queueMicrotask(()=>{
          const text=grammar?'"CONVERSAR"':'Posso ajudar a escolher esses hinos.';
          window.__hymnChatNativeEvent(true,text,id,{tokens:7});
        });
      },
      cancel:id=>cancelled.push(id)
    }
  };
  const ctx={
    window,$,document:{createElement:()=>element()},
    HymnChatTools,state:{
      ready:true,
      status:{vector_count:0},
      searchSettings:{vectorMode:'off',collections:{principal:true},pageSize:10}
    },
    performance:{now:()=>0},
    setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id},
    clearTimeout(id){timeouts.delete(id)},
    setInterval(fn,ms){const id=++timerId;intervals.set(id,{fn,ms});return id},
    clearInterval(id){intervals.delete(id)},
    openHymn(){},selectSettingsTab(){},openLayer(){},
    jsonRequest:async(url)=>{
      if(url==='/api/contextual/candidates')return {
        semantic_judgment:'NOT_VERIFIED',default_ranking_changed:false,
        count:2,candidates:[{hymn_id:1,title:'Retorno',number:'001',source_status:'unjudged_not_verified'}]
      };
      throw Error('Endpoint inesperado: '+url);
    }
  };
  const ui=vm.runInNewContext(actualUI+'\nHymnChatUI',ctx,{timeout:5000});
  return {ui,$,window,calls,cancelled,timeouts,intervals};
}
(async()=>{
 const direct=fixture();
 await direct.ui.submit('Procure hinos sobre retorno');
 assert.equal(direct.calls.length,1,'Ação explícita evita chamada extra ao roteador');
 assert.match(direct.calls[0].id,/^[0-9]{1,12}$/,'ID deve passar no regex Java');
 assert.match(direct.$('chat-messages').children.at(-1).textContent,/ajudar a escolher/);
 assert.equal(direct.$('chat-send').disabled,false);
 assert.equal(direct.timeouts.size,0,'Watchdog deve ser limpo após resposta nativa');
 assert.equal(direct.intervals.size,0,'Progresso deve parar ao terminar');
 const dialog=fixture();
 await dialog.ui.submit('Podemos conversar sobre a experiência?');
 assert.equal(dialog.calls.length,2,'Roteador e resposta são duas gerações distintas');
 assert.ok(dialog.calls.every(x=>/^[0-9]{1,12}$/.test(x.id)));
 assert.notEqual(dialog.calls[0].id,dialog.calls[1].id);
 assert.match(dialog.$('chat-messages').children.at(-1).textContent,/ajudar a escolher/);
 const stalled=fixture({silent:true});
 const inFlight=stalled.ui.submit('Podemos conversar sobre isso?');
 await Promise.resolve();
 assert.equal(stalled.calls.length,1);
 assert.equal(stalled.$('chat-send').disabled,true);
 assert.equal(stalled.timeouts.size,1,'Precisamos de watchdog quando o JNI não responde');
 for(const t of stalled.intervals.values())t.fn();
 assert.match(stalled.$('chat-messages').children.at(-1).textContent,/Processando entrada/);
 const [watchdogId,watchdog]=stalled.timeouts.entries().next().value;
 assert.ok(watchdog.ms>=30000&&watchdog.ms<40000);
 stalled.timeouts.delete(watchdogId); // Browser removes the fired timeout before invoking callback.
 watchdog.fn();
 await inFlight;
 assert.equal(stalled.$('chat-send').disabled,false,'Erro libera envio');
 assert.equal(stalled.timeouts.size,0);
 assert.equal(stalled.intervals.size,0);
 assert.equal(stalled.cancelled.length,1);
 assert.match(stalled.$('chat-messages').children.at(-1).textContent,/não retornou/);
 const cancelled=fixture({silent:true});
 const inflight=cancelled.ui.submit('Podemos conversar sobre isso?');
 await Promise.resolve();
 cancelled.$('chat-stop').click();
 await inflight;
 assert.equal(cancelled.$('chat-send').disabled,false);
 assert.equal(cancelled.timeouts.size,0);
 assert.ok(cancelled.$('chat-messages').children.some(m=>/interrompido/.test(m.textContent)));
 console.log('CHAT JNI REGRESSION PASS: numeric IDs, native callbacks, progress, timeout, cancellation, released UI.');
})().catch(e=>{console.error(e);process.exitCode=1;});
