'use strict';
// Executes the actual shipped WebView HTML, app.js and tuner controller.
// The Java bridge is replaced by a controllable test double, not a model.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {JSDOM}=require('jsdom');
const asset=n=>fs.readFileSync(path.join(__dirname,'../app/src/main/assets',n),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,description)=>{for(let i=0;i<250;i++){if(fn())return;await wait(10);}throw Error('Timed out: '+description);};
const rows=[1,2,3].map(id=>({id,number:String(id),title:'Hino de teste '+id,collection:'Coletânea 2018',topics:[],snippet:'Trecho '+id,reason:'Índice de teste',relevance_percent:100-id,tuner_signals:{lexical:20-id}}));
const full=rows.map(r=>({...r,lyrics:'Mensagem de teste '+r.id+'\nSegunda linha '+r.id}));
(async()=>{
 const dom=new JSDOM(asset('index.html'),{url:'https://app.local/',runScripts:'outside-only'});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);
 try{
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLElement.prototype.scrollTo=function(){};
  w.scrollTo=()=>{};
  let loaded=true,active=null,calls=0,mode='normal',hold=false,vectorHold=false,vectorPending=[];
  const decisions=[],observedQueries=new Set();
  const base={results:rows,tuner_candidates:rows,total:3,page:1,page_size:5,has_more:true,excluded:[],required:[],deprioritized:[],interpretation:[],ai_context:{reference:null,passage:'',topics:[]},not_learned_total:0};
  w.OfflineAPI={
   searchOptions(p={}){return {collections:{principal:true,avulsos:true,cia:true,pessoal:true},vectorMode:'balanced',fusionMode:'rrf',mode:'balanced',strength:75,minAffinity:0,pageSize:5,recWeight:65,recCount:5,bibleDepth:1,customAliases:{},...p};},
   normalize:s=>String(s).toLowerCase(),
   async request(url,payload){
    if(url==='/api/status')return {ready:true,hymn_count:3,collection:'Teste',collections:{principal:3,avulsos:1,cia:1},vector_count:3};
    if(url==='/api/stories')return {stories:[]};
    if(url==='/api/repertoire')return {count:0,not_learned:[]};
    if(url.startsWith('/api/hymns/'))return full.find(h=>h.id===Number(url.split('/').pop()));
    if(url==='/api/search'){observedQueries.add(payload.query);return {...base,effective_query:payload.query,exact_number:payload.query==='001',results:payload.query==='001'?[rows[0]]:rows};}
    throw Error('Unexpected API '+url);
   }
  };
  w.ScriptureIndex={parse:()=>null};
  w.NativeVector={embed(id){const complete=()=>w.VectorNative.complete({id,ok:true,vector:Array(384).fill(0.1),ms:1});if(vectorHold)vectorPending.push(complete);else setTimeout(complete,0);}};
  w.NativeGGUF={
   status:()=>JSON.stringify({available:true,selected:true,loaded,busy:Boolean(active),phase:active?'generating':loaded?'ready':'selected',name:'Qwen3 fixture'}),
   generate(prompt,id,grammar,maxTokens,timeoutMs){
    calls++;const req={id,prompt};active=req;
    const complete=()=>{if(active!==req)return;active=null;
      const isGrade=prompt.includes('Hino 1 (');
      const titles=[...prompt.matchAll(/Hino \d+ \(Hino de teste (\d+)\):/g)].map(m=>Number(m[1]));
      const score=t=>mode==='abstain'?1:mode==='second'?t===2?4:1:t===3?4:t===2?3:1;
      const answer=isGrade?JSON.stringify(titles.map(t=>[score(t),1])):'Interpretacao contextual de teste';
      decisions.push({id,isGrade,titles,answer});
      w.__ggufNativeEvent('generate',true,answer,id,{tokens:12});
    };
    if(!hold)setTimeout(complete,0);else req.complete=complete;
   },
   cancel(id){if(active?.id===id){active=null;setTimeout(()=>w.__ggufNativeEvent('generate',false,'Geração cancelada.',id,null),0);}},
   loadModel(){},selectModel(){}
  };
  w.BuildAbout={render(){}};
  for(const name of ['semantic-tuner.js','semantic-tuner-ui.js','app.js'])w.eval(asset(name));
  const ids=()=>[...d.querySelectorAll('#results-list [data-card-id]')].map(n=>Number(n.dataset.cardId));
  const mainTitle=()=> $('results-title').textContent;
  const search=async query=>{ $('search-input').value=query;$('search-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>observedQueries.has(query)&&!$('search-button').disabled,'new query rendered: '+query);};
  await until(()=>$('data-count').textContent.includes('3 hinos'),'initialization');
  assert.equal($('gguf-auto').checked,true,'LLM must default on even after update');
  // Deterministic ranking is [1,2,3]. First real wiring test rejects #1,
  // accepts #3 then #2, and renders only those two in the primary list.
  await search('Contexto A');
  await until(()=>mainTitle()==='Hinos recomendados pelo Qwen3','primary LLM ranking');
  assert.deepEqual(ids(),[3,2]);assert.ok($('results-list').textContent.includes('4/4'));assert.ok($('load-more').classList.contains('hidden'));
  assert.ok(decisions.filter(x=>x.isGrade).length>=2,'two grading passes');
  $('tuner-topic').value='0';$('tuner-topic').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.deepEqual(ids(),[3,2],'sliders cannot overwrite authoritative LLM');
  $('load-more').click();assert.deepEqual(ids(),[3,2],'pagination cannot reinsert rejects');
  // Changing only the mocked LLM judgment must change visible IDs.
  mode='second';await search('Contexto B');
  await until(()=>mainTitle()==='Hinos recomendados pelo Qwen3'&&ids().length===1&&ids()[0]===2,'counterfactual LLM decision');
  // Abstention must stay empty, never fall back silently.
  mode='abstain';await search('Contexto C');
  await until(()=>mainTitle()==='Hinos recomendados pelo Qwen3'&&ids().length===0&&/Nenhum hino aprovado/.test($('results-list').textContent),'abstention');
  assert.match($('results-list').textContent,/Nenhum hino aprovado/);
  // Simulate E5 response initiated with LLM off, then turn Qwen3 on while
  // the vector request is outstanding. Late E5 must not replace Qwen3.
  mode='normal';$('gguf-auto').checked=false;$('gguf-auto').dispatchEvent(new w.Event('change'));
  vectorHold=true;await search('Contexto D');
  await until(()=>vectorPending.length>0,'E5 pending');
  $('gguf-auto').checked=true;$('gguf-auto').dispatchEvent(new w.Event('change'));
  // Release every pending vector (also used internally in curator).
  vectorHold=false;vectorPending.splice(0).forEach(f=>f());
  await until(()=>mainTitle()==='Hinos recomendados pelo Qwen3'&&ids().join(',')==='3,2','late E5 protection');
  // Exact-number lookup never triggers LLM.
  const before=calls;await search('001');await wait(30);
  assert.equal(calls,before);assert.deepEqual(ids(),[1]);
  // Missing model must be labeled, not presented as LLM output.
  loaded=false;await search('Contexto E');await until(()=>mainTitle()==='Resultados do índice local','fallback');
  assert.match($('results-subtitle').textContent,/sem curadoria LLM/);
  assert.deepEqual(ids(),[1,2,3]);
  // Cancel an in-flight generation; no fake final ranking.
  loaded=true;hold=true;await search('Contexto F');await until(()=>active!==null,'active');
  $('gguf-cancel').click();await until(()=>mainTitle()==='Resultados do índice local','cancel fallback');
  assert.match($('results-subtitle').textContent,/Qwen3 não concluiu/);
  console.log('QWEN3_PRIMARY_UI_OK: decisions alter visible IDs, rejects removed, two passes, abstention, sliders, pagination, late E5, exact search, unavailable and cancellation.');
 }finally{dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
