'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('app/src/main/assets/index.html');
const js=read('app/src/main/assets/app.js');
const java=read('app/src/main/java/br/com/buscadordehinos/app/MainActivity.java');
const cpp=read('app/src/main/cpp/hinos_jni.cpp');
const cmake=read('app/src/main/cpp/CMakeLists.txt');
const build=read('app/build.gradle');
const workflow=read('.github/workflows/android-apk.yml');
for(const id of ['gguf-cancel','ai-cancel','gguf-select','gguf-load','gguf-improve','gguf-compare','gguf-compare-model','gguf-test','gguf-test-result','gguf-comparison','gguf-status','gguf-banner','gguf-auto','ai-workspace','ai-indicator','modal-ai-ask','settings-ai','gguf-phase','gguf-model-meta'])assert.match(html,new RegExp('id="'+id+'"'),id);
for(const fn of ['selectModel','loadModel','generate','cancel','status'])assert.match(java,new RegExp('public (?:synchronized )?'+(fn==='status'?'String':'void')+' '+fn+'\\('),'Java bridge: '+fn);
assert.match(js,/window\.NativeGGUF/);
assert.match(js,/\.generate\(prompt/);
assert.match(js,/\.status\?\.\(\)/);
assert.match(js,/relevance_percent/);
assert.match(js,/semanticHints/);
assert.match(js,/function maybeAuto/);
assert.match(js,/function compare/);
assert.match(js,/function detail/);
assert.match(java,/ACTION_OPEN_DOCUMENT/);
assert.match(java,/takePersistableUriPermission/);
assert.doesNotMatch(java,/nativeLoad\("\/proc\/self\/fd\/"/);
assert.match(java,/getContentResolver\(\)\.openInputStream\(uri\)/);
assert.match(java,/getFilesDir\(\)/);
assert.match(java,/prepareModelFile\(uri,size\)/);
assert.match(java,/new StatFs\(/);
assert.match(java,/modelPhase="copying"/);
assert.match(js,/Copiando GGUF/);
assert.match(java,/nativeLoadProgress/);
assert.match(java,/modelPhase/);
assert.match(java,/modelError/);
assert.match(java,/getNativeHeapAllocatedSize/);
assert.match(java,/FileOutputStream\(partial\)/);
assert.match(cpp,/llama_model_load_from_file/);
assert.match(cpp,/params\.load_mode=LLAMA_LOAD_MODE_MMAP/);
assert.doesNotMatch(cpp,/params\.use_mmap|params\.use_mlock|params\.use_direct_io/);
assert.match(cpp,/llama_log_set/);
assert.match(cpp,/progress_callback=modelProgress/);
assert.match(cpp,/cp\.n_ctx=3072/);
assert.match(cpp,/cp\.n_batch=96/);
assert.match(cpp,/llama_chat_apply_template/);
assert.match(cpp,/llama_decode/);
assert.match(cpp,/llama_sampler_sample/);
assert.match(cmake,/ggml-org\/llama.cpp/);
assert.match(cmake,/GIT_TAG b11960/);
assert.doesNotMatch(cmake,/GIT_TAG b8201/);
assert.match(build,/versionName '\d+\.\d+\.\d+'/);
assert.match(build,/abiFilters 'arm64-v8a'/);
assert.match(build,/ndkVersion '27\.2\.12479018'/);
assert.match(build,/gradleProperty\('enableLocalModels'\).*orElse\(false\)/);
assert.match(java,/if\(BuildConfig\.ENABLE_LOCAL_MODELS\)\{\s*web\.addJavascriptInterface\(new ModelBridge/);
assert.ok(workflow.includes('ndk;27.2.12479018'),'Full build requires the Android NDK');
assert.ok(workflow.includes('scripts/build_e5_assets.py'));
assert.ok(workflow.includes('scripts/qa_e5.py'));
assert.ok(workflow.includes('assembleDebug assembleDebugAndroidTest -PenableLocalEmbeddings=true'));
assert.ok(workflow.includes('scripts/qa_android_emulator.sh'));
assert.ok(workflow.includes('needs: [build_apk, device_smoke]'));
assert.ok(workflow.includes('-PenableLocalModels=true'),'Final APK must retain the GGUF C++ motor');
assert.ok(workflow.includes('EXPECT_GGUF_ENGINE: \'true\''),'APK audit must reject missing GGUF runtime');
assert.ok(build.includes("gradleProperty('enableLocalEmbeddings')"));
assert.match(js,/MAX_AI_MS=12000/);
assert.match(cmake,/GGML_CPU_KLEIDIAI ON/);
assert.match(cpp,/params\.use_extra_bufts=allowPackedWeights==JNI_TRUE/);
assert.match(js,/OfflineAPI\.validateHints/);
assert.match(cpp,/nativeCancel/);
assert.match(cpp,/cp\.abort_callback=shouldCancel/);
assert.match(java,/nativeGenerate\(prompt\.getBytes\(StandardCharsets\.UTF_8\),grammar\.getBytes\(StandardCharsets\.UTF_8\)/);
assert.match(cpp,/llama_sampler_init_grammar/);
assert.match(cpp,/cp\.abort_callback_data=&deadline/);
assert.match(cpp,/g_context=llama_init_from_model/);
assert.match(cpp,/llama_memory_clear\(llama_get_memory\(g_context\),true\)/);
assert.match(cpp,/llama_set_abort_callback\(g_context,shouldCancel,&deadline\)/);
assert.match(cpp,/nativeGenerationStats/);
assert.match(java,/nativeGenerationStats\(\)/);
assert.match(java,/timeoutMs>120000/);
assert.match(java,/value\+=" \[etapa: "/);
assert.match(html,/id="gguf-auto"/);
assert.doesNotMatch(html,/id="gguf-auto" checked/);
assert.match(html,/Percentuais|percentuais/);

const aiSource=read('app/src/main/assets/local-hymn-ai.js');
const ai=vm.runInNewContext(aiSource+'\nLocalHymnAI');
const hymns=Array.from({length:6},(_,index)=>({id:index+1,number:String(index+1),title:'Hino de teste '+(index+1),snippet:'Deus acolhe quem volta de coração.'}));
const context={reference:'Lucas 15:20',passage:'Vinha ele ainda longe, quando seu pai o viu.',topics:['Arrependimento']};
const request=ai.prepareComparison('Voltar para Deus',['tristeza'],hymns,context);
assert.equal(request.candidates.size,5);
assert.match(request.prompt,/Lucas 15:20[\s\S]*seu pai o viu[\s\S]*5 \| Deus acolhe/);
assert.doesNotMatch(request.prompt,/^6 \|/m);
assert.match(request.prompt,/tristeza/);
const longText='fé e confiança na adversidade '.repeat(30);
const noisyInput=('a'+String.fromCharCode(0xD800)).repeat(300);
const manyLongHymns=Array.from({length:5},(_,i)=>({id:Number.MAX_SAFE_INTEGER-i,title:noisyInput,snippet:longText}));
const longContext={reference:longText,passage:longText,topics:Array(4).fill(longText)};
for(const lookup of [null,{term:'a'.repeat(64),added:2}]){
  const bounded=ai.prepareComparison(noisyInput,Array(4).fill(longText),manyLongHymns,longContext,lookup);
  assert.ok(bounded.prompt.length<=2400,'A entrada da IA respeita o limite da ponte Android.');
  assert.match(bounded.prompt,/trecho/);
}
assert.match(request.grammar,/hymn-id ::= "1" \| "2" \| "3" \| "4" \| "5"/);
const compactThemes=ai.prepareThemes('Voltar para Deus',[],['Arrependimento','Fé','Consolo'],60000);
assert.equal(compactThemes.maxTokens,24);
assert.equal(compactThemes.timeoutMs,60000);
assert.match(compactThemes.grammar,/theme ::= "1" \| "2" \| "3"/);
assert.match(compactThemes.prompt,/1:Arrependimento/);
assert.equal(compactThemes.themeLabels[0],'Arrependimento');
const preferred=ai.prepareThemes('Voltar para Deus',[],['Fé','Consolo','Arrependimento'],12000,['arrependimento','inexistente']);
assert.deepEqual([...preferred.themeLabels],['Arrependimento']);
const grounded=ai.prepareComparison('Voltar para Deus',[],hymns.map(h=>({...h,match_type:h.id===3?'acontecimento':'contexto'})),context);
assert.deepEqual([...grounded.candidates.keys()],[3]);
assert.throws(()=>ai.readComparison('[1]',grounded));
assert.ok(request.maxTokens<=72,'Comparação deve limitar tokens de saída');
assert.ok(request.prompt.length<1250,'Prompt curto para reduzir prefill ARM64');
const withoutCandidates=ai.prepareComparison('Voltar para Deus',[],[],null);
assert.equal(withoutCandidates.candidates.size,0);
assert.match(withoutCandidates.grammar,/^root ::= lookup\n/);
assert.throws(()=>ai.readComparison('[]',withoutCandidates));
const valid='[2]';
const toolCall='{"buscar_hinos":"fé e reconciliação"}';
assert.equal(ai.readComparison(valid,request).picks[0].excerpt,hymns[1].snippet);
assert.equal(ai.readComparison('[]',request).picks.length,0);
assert.equal(ai.readComparison(toolCall,request).lookup,'fé e reconciliação');
for(const invalid of ['[6]','["2"]','[2,2]','[2,3,4]','[{"id":2}]','sem JSON']){
  assert.throws(()=>ai.readComparison(invalid,request));
}
for(const invalid of ['https://fora','hino 42','fé\n','   ','a'.repeat(65)]){
  assert.throws(()=>ai.readComparison(JSON.stringify({buscar_hinos:invalid}),request));
}
const limited=ai.prepareComparison('Voltar para Deus',[],hymns,null,{term:'reconciliação',added:1});
assert.throws(()=>ai.readComparison(toolCall,limited));
assert.doesNotMatch(limited.grammar,/\bbuscar_hinos\b/);
const merged=ai.mergeCandidates(hymns.slice(0,5),[hymns[0],hymns[5],hymns[5]]);
assert.equal(merged.added,1);
assert.equal(merged.hymns.at(-1).id,6);

const ggufSource=js.slice(js.indexOf('const GGUF='),js.lastIndexOf('refreshStatus().catch'));
const searchSource=js.slice(js.indexOf('async function performSearch('),js.indexOf('function appendConversation'));
function setup({ready=true,initialResults=hymns,additionalSearch=null,auto=false,nativeModel=true}={}){
  const calls=[],cancelled=[],elements=new Map(),requests=[],embeddings=[],opened=[],messages=[];
  let now=0;
  const $=id=>{
    if(!elements.has(id)){
      const classes=new Set(['hidden']);
      elements.set(id,{classes,textContent:'',children:[],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(){}},
        addEventListener(name,handler){if(name==='click')this.click=handler;},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},insertAdjacentHTML(){}});
    }
    return elements.get(id);
  };
  const window=nativeModel?{NativeGGUF:{status:()=>JSON.stringify({available:true,loaded:true,phase:'ready'}),
    generate:(...args)=>calls.push(args),cancel:id=>cancelled.push(id)}}:{};
  const vector=Array(384).fill(0.1);
  const settings={mode:'balanced',vectorMode:nativeModel?'balanced':'off',collections:{principal:true,avulsos:false}};
  const state={ready,searchEpoch:1,effectiveQuery:'Voltar para Deus',exclude:['tristeza'],lastResults:initialResults,searchSettings:settings,aiContext:context,vectorQuery:vector};
  const {gguf,search}=vm.runInNewContext(aiSource+searchSource+ggufSource+'\n({gguf:GGUF,search:performSearch})',{window,$,state,performance:{now:()=>now},localStorage:{getItem:()=>auto?'1':null},setInterval(){},toast(){},appendConversation:(kind,text)=>messages.push(text),showResults(){},
    document:{createElement(){return {addEventListener(name,handler){this.click=handler;}};}},openHymn:id=>opened.push(id),
    OfflineAPI:{normalize:value=>value.toLowerCase(),semanticLabels:()=>['Arrependimento'],validateHints:hints=>hints},
    jsonRequest:async(url,payload)=>{
      requests.push(payload);
      if(additionalSearch&&payload.settings.pageSize===10)return additionalSearch();
      return {results:hymns,effective_query:payload.query,excluded:payload.exclude,deprioritized:nativeModel?payload.deprioritize:['tristeza'],ai_context:context,total:hymns.length,page:payload.page||1};
    },
    busySearch:value=>{state.busy=value;},resultCard:()=>'',RepertoireUI:{renderSearch(){}},EmbeddingSearch:{maybeUpdate:(...args)=>embeddings.push(args)}});
  return {calls,cancelled,$,state,requests,embeddings,opened,messages,vector,gguf,search,setTime:ms=>{now=ms;},complete:(id,value,ok=true,metrics=null)=>window.__ggufNativeEvent('generate',ok,value,id,metrics)};
}

async function checkBridge(){
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const diagnostic=setup({ready:false});
  diagnostic.$('gguf-test').click();
  const [prompt,id,grammar]=diagnostic.calls[0];
  assert.equal(prompt,ai.diagnostic.prompt);
  assert.equal(grammar,ai.diagnostic.grammar);
  diagnostic.gguf.cancelSearchTask();
  assert.equal(diagnostic.cancelled.length,0);
  diagnostic.complete(id,'OK',true,{setupMs:10,prefillMs:5,firstTokenMs:15,tokens:1});
  assert.match(diagnostic.$('gguf-test-result').textContent,/Teste passou.*Primeiro token: 15 ms/);

  const comparison=setup();
  comparison.$('gguf-compare-model').click();
  const comparisonId=comparison.calls[0][1];
  const immediate=comparison.$('gguf-comparison-text').textContent;
  assert.match(immediate,/Comparação do índice local.*\n/);
  comparison.complete('0',valid);
  assert.equal(comparison.$('gguf-comparison-text').textContent,immediate);
  comparison.complete(comparisonId,valid);
  assert.match(comparison.$('gguf-comparison-text').textContent,/Sugestões da IA[\s\S]*Hino de teste 2.*\nTrecho da coletânea:/);
  assert.equal(comparison.requests.length,0);

  const timeout=setup();
  timeout.$('gguf-compare-model').click();
  const fallback=timeout.$('gguf-comparison-text').textContent;
  timeout.complete(timeout.calls[0][1],'Tempo limite de geração atingido.',false);
  assert.equal(timeout.$('gguf-comparison-text').textContent,fallback);
  assert.match(timeout.$('ai-last').textContent,/Tempo limite/);

  const extra=setup({additionalSearch:async()=>({results:[hymns[5]]})});
  extra.$('gguf-compare-model').click();
  extra.setTime(2000);
  extra.complete(extra.calls[0][1],toolCall);
  await tick();
  assert.equal(extra.requests[0].query,'fé e reconciliação');
  assert.deepEqual(extra.requests[0].exclude,['tristeza']);
  assert.equal(extra.requests[0].settings.collections.avulsos,false);
  assert.equal(extra.state.effectiveQuery,'Voltar para Deus');
  assert.equal(extra.state.lastResults,hymns);
  assert.equal(extra.calls.length,2);
  assert.equal(extra.calls[1][4],18000);
  assert.notEqual(extra.calls[1][1],extra.calls[0][1]);
  assert.doesNotMatch(extra.calls[1][2],/\bbuscar_hinos\b/);
  extra.complete(extra.calls[1][1],'[6]');
  assert.match(extra.$('gguf-comparison-text').textContent,/Busca complementar por “fé e reconciliação”/);
  assert.match(extra.$('gguf-comparison-text').textContent,/Hino de teste 6/);
  extra.$('gguf-comparison-actions').children[0].click();
  assert.deepEqual(extra.opened,[6]);
  assert.equal(extra.requests.length,1);

  const noResults=setup({initialResults:[],additionalSearch:async()=>({results:[]})});
  noResults.$('gguf-compare-model').click();
  noResults.complete(noResults.calls[0][1],toolCall);
  await tick();
  assert.equal(noResults.calls.length,1);
  assert.match(noResults.$('gguf-comparison-text').textContent,/0 novo\(s\) candidato\(s\)/);

  let finishLookup;
  const pending=setup({additionalSearch:()=>new Promise(resolve=>{finishLookup=resolve;})});
  pending.$('gguf-compare-model').click();
  pending.complete(pending.calls[0][1],toolCall);
  pending.gguf.cancelSearchTask();
  finishLookup({results:[hymns[5]]});
  await tick();
  assert.equal(pending.calls.length,1);
  assert.match(pending.$('gguf-comparison-text').textContent,/Comparação do índice local/);
  assert.doesNotMatch(pending.$('gguf-comparison-text').textContent,/Sugestões da IA/);

  const expired=setup({additionalSearch:async()=>({results:[hymns[5]]})});
  expired.$('gguf-compare-model').click();
  expired.setTime(20500);
  expired.complete(expired.calls[0][1],toolCall);
  await tick();
  assert.equal(expired.calls.length,1);
  assert.equal(expired.requests.length,0);
  assert.match(expired.$('ai-last').textContent,/limite de tempo/);

  const stale=setup();
  stale.$('gguf-compare-model').click();
  stale.state.searchEpoch++;
  stale.complete(stale.calls[0][1],valid);
  assert.match(stale.$('gguf-comparison-text').textContent,/Comparação do índice local/);
  assert.doesNotMatch(stale.$('gguf-comparison-text').textContent,/Sugestões da IA/);

  const cancelled=setup();
  cancelled.$('gguf-compare-model').click();
  cancelled.$('gguf-cancel').click();
  assert.deepEqual(cancelled.cancelled,[cancelled.calls[0][1]]);
  cancelled.complete(cancelled.calls[0][1],valid);
  assert.match(cancelled.$('gguf-comparison-text').textContent,/Comparação do índice local/);
  assert.doesNotMatch(cancelled.$('gguf-comparison-text').textContent,/Sugestões da IA/);

  const enrichment=setup();
  enrichment.$('gguf-improve').click();
  assert.match(enrichment.calls[0][2],/theme ::= "1"/);
  assert.match(enrichment.calls[0][0],/Arrependimento/);
  enrichment.complete(enrichment.calls[0][1],'[1]');
  await tick();
  assert.equal(enrichment.requests[0].exclude[0],'tristeza');
  assert.equal(enrichment.requests[0].vector_query,enrichment.vector);
  assert.equal(enrichment.embeddings.length,0);

  const queued=setup({auto:true});
  queued.gguf.maybeAuto(queued.state.effectiveQuery);
  const first=queued.calls[0][1];
  queued.state.searchEpoch++;
  queued.gguf.cancelSearchTask();
  queued.gguf.maybeAuto('Paz na dificuldade');
  queued.complete(first,'["Arrependimento"]');
  assert.equal(queued.calls.length,2);
  assert.match(queued.calls[1][0],/Paz na dificuldade/);

  const literal=setup({auto:true});
  literal.state.searchSettings.mode='literal';
  literal.gguf.maybeAuto(literal.state.effectiveQuery);
  literal.$('gguf-improve').click();
  assert.equal(literal.calls.length,0);
  const offline=setup({auto:true,nativeModel:false,initialResults:[]});
  assert.equal(await offline.search('Gratidão sem foco em tristeza'),true);
  assert.match(offline.$('notice').textContent,/Menor prioridade para tristeza/);
  assert.equal(offline.$('gguf-compare').disabled,false);
  offline.$('gguf-compare').click();
  assert.match(offline.$('gguf-comparison-text').textContent,/Hino de teste 1.*\n“Deus acolhe quem volta de coração/);
  await offline.search(offline.state.effectiveQuery,{page:2});
  assert.deepEqual(offline.requests.at(-1).deprioritize,['tristeza']);
  assert.equal(offline.requests.at(-1).parsed_query,true);
  await offline.search('com esperança',{refine:true});
  assert.deepEqual(offline.requests.at(-1).deprioritize,['tristeza']);
  assert.equal(offline.calls.length+offline.embeddings.length,0);
  console.log('GGUF: diagnóstico, consulta complementar, filtragem, validação, cancelamento e temas estruturados aprovados.');
}

checkBridge().catch(error=>{console.error(error);process.exitCode=1;});
