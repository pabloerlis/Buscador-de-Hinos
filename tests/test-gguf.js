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
assert.match(java,/contains\(MODEL_URI_KEY\)\) \{\s*modelBridge\.loadModel\(\)/);
assert.match(java,/modelBridge\.loadSelection\(uri\)/);
assert.match(java,/private static final ExecutorService llmExecutor/);
assert.match(java,/long size=selection==null\?preferences\.getLong\(MODEL_BYTES_KEY,-1\)/);
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
assert.match(cpp,/cp\.n_ctx=1280/);
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
assert.match(java,/web\.addJavascriptInterface\(modelBridge, "NativeGGUF"\)/);
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


const storyDb = JSON.parse(read('app/src/main/assets/semantic-stories.json'));
const stories = vm.runInNewContext(read('app/src/main/assets/story-engine.js')+'\nStoryEngine').create(storyDb);
assert.equal(stories.interpret('Filho Pródigo').matches[0].reviewFocus,storyDb.stories[0].review_focus);
assert.ok(storyDb.stories.every(story=>story.review_focus?.length>=8));

const reviewLyrics=new Map([
  [1,'O Pai acolhe os seus no céu.\nCantaremos na glória.'],
  [2,'Eu me afastei de ti, meu pai.\nHoje volto ao teu lar.\nTu me recebes e me perdoas.'],
  [3,'O sol nasceu sobre as montanhas.'],
  [4,'Em ti confio na noite.\n\nCantarei tua misericórdia.']
]);
const reviewHymns=hymns.map(hymn=>({...hymn,snippet:hymn.id===2?'Hoje volto ao teu lar.':hymn.snippet}));
const review=ai.prepareReview('Filho Pródigo',reviewLyrics,reviewHymns,{
  context:{narrative:'voltar ao pai depois de se afastar'}
});
assert.match(review.requests[1].prompt,/voltar ao pai depois de se afastar/);
assert.match(review.requests[1].prompt,/Eu me afastei.*Hoje volto.*Tu me recebes/);
assert.match(review.requests[3].prompt,/Em ti confio.*Cantarei tua misericórdia/);
assert.equal(review.requests.length,4);
assert.equal(review.timeoutMs,30000);
const grades=['não','sim','não','não'];
const judgments=review.requests.map(({candidate},i)=>ai.readReview(grades[i],candidate));
assert.deepEqual(Array.from(ai.applyReview(reviewHymns,judgments),x=>x.id),[2,1,3,4,5,6]);
assert.match(judgments[1].excerpt,/Hoje volto ao teu lar/);
assert.equal(judgments[3].excerpt,'');
for(const invalid of ['talvez','sim\nnão','','sim 2']){
  assert.throws(()=>ai.readReview(invalid,review.requests[0].candidate));
}
assert.equal(ai.applyReview(reviewHymns.slice(1),judgments),null);
assert.equal(ai.applyReview(reviewHymns,review.requests.map(({candidate})=>ai.readReview('não',candidate))),reviewHymns);
assert.equal(ai.prepareReview('Filho Pródigo',reviewLyrics,reviewHymns.slice(0,3)),null);

const chatRequest=ai.prepareChat({query:'Consolo',message:'Prefiro hinos mais animados.',shown:reviewHymns.slice(0,2),
  found:reviewHymns.slice(2,4),history:[{kind:'assistant',text:'Você prefere hinos alegres ou solenes?'}]});
assert.match(chatRequest.prompt,/Você prefere hinos alegres ou solenes/);
assert.match(chatRequest.grammar,/^root ::= falar \| perguntar\n/);
assert.equal(ai.readChat('["perguntar","clima"]',chatRequest).reply,'Você prefere hinos mais alegres ou mais solenes?');
assert.throws(()=>ai.readChat('["retirar",2]',chatRequest));
assert.throws(()=>ai.readChat('["acrescentar",3]',chatRequest));
const addition=ai.prepareChat({query:'Consolo',message:'Acrescente esperança',editIntent:'acrescentar',found:reviewHymns.slice(2,4)});
assert.equal(ai.readChat('["acrescentar",1]',addition).hymn.id,3);
assert.throws(()=>ai.readChat('["falar","buscar: paz"]',chatRequest));
assert.throws(()=>ai.readChat('["buscar","Consolo e esperança"]',chatRequest));
const history=[{kind:'user',intent:'conversation',text:'Prefiro hinos mais alegres.'},
  {kind:'assistant',text:'Podemos pensar na abertura do culto.'},
  {kind:'user',intent:'edit',text:'Retire o hino 027.'}];
assert.equal(ai.chatSearchRequest('Prefiro hinos mais alegres',history),null);
assert.equal(ai.chatSearchRequest('Não precisa buscar agora',history),null);
assert.equal(ai.chatSearchRequest('Por favor, busque o hino 027.',history).query,'hino 027');
assert.equal(ai.chatSearchRequest('Pode buscar agora?',history).query,'hinos mais alegres.');
assert.equal(ai.chatSearchRequest('É para a ceia. Pode buscar no catálogo?',[]).query,'a ceia');
assert.equal(ai.chatSearchRequest('Pode buscar mais tarde?',history),null);
assert.equal(ai.chatSearchRequest('',history,true).query,'hinos mais alegres.');
assert.equal(ai.chatSearchRequest('Busque somente hinos de alegria',history).refine,true);
for(const response of ['["retirar",3]','["acrescentar",9]',
  '["acrescentar",1]','["falar","https://exemplo.com"]','[]','["buscar"]'])
  assert.throws(()=>ai.readChat(response,chatRequest));
const forcedChat=ai.prepareChat({query:'Paz',message:'Retire o hino 2',shown:reviewHymns,forced:{verb:'retirar',id:2}});
assert.match(forcedChat.grammar,/^root ::= retirar\n/);
assert.throws(()=>ai.readChat('["retirar",1]',forcedChat));

const ggufSource=js.slice(js.indexOf('const GGUF='),js.lastIndexOf('refreshStatus().catch'));
const turnSource=js.slice(js.indexOf('function scrollChat('),js.indexOf("$('refine-form').addEventListener"));
const searchSource=js.slice(js.indexOf('async function performSearch('),js.indexOf('function appendConversation'));
function setup({ready=true,initialResults=hymns,additionalSearch=null,auto=false,nativeModel=true,embeddingTask=null,chatLookup=null,searchResults=hymns,scripture=null}={}){
  const calls=[],cancelled=[],elements=new Map(),requests=[],lookups=[],embeddings=[],opened=[],messages=[];
  let now=0;
  const $=id=>{
    if(!elements.has(id)){
      const classes=new Set(['hidden']);
      elements.set(id,{classes,textContent:'',children:[],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(){}},
        addEventListener(name,handler){if(name==='click')this.click=handler;},setAttribute(){},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);},insertAdjacentHTML(){}});
    }
    return elements.get(id);
  };
  const window=nativeModel?{NativeGGUF:{status:()=>JSON.stringify({available:true,loaded:true,phase:'ready'}),
    generate:(...args)=>calls.push(args),cancel:id=>cancelled.push(id)}}:{};
  const vector=Array(384).fill(0.1);
  const settings={mode:'balanced',vectorMode:nativeModel?'balanced':'off',collections:{principal:true,avulsos:false}};
  const state={ready,searchEpoch:1,effectiveQuery:'Voltar para Deus',exclude:['tristeza'],lastResults:initialResults,searchSettings:settings,aiContext:context,vectorQuery:vector,chatHistory:[],chatAdded:new Map(),chatRemoved:new Set(),chatChoices:null,chatOptions:[],chatQuestions:new Set()};
  const {gguf,search,refine,visible}=vm.runInNewContext(aiSource+searchSource+turnSource+ggufSource+'\n({gguf:GGUF,search:performSearch,refine:submitRefinement,visible:visibleHymns})',{window,$,state,performance:{now:()=>now},localStorage:{getItem:()=>auto?'1':null},setInterval(){},toast(){},appendConversation:(kind,text)=>{messages.push(text);return $('conversation');},showResults(){},selectWorkspace(){},
    document:{createElement(){return {append(){},addEventListener(name,handler){this.click=handler;}};}},openHymn:id=>opened.push(id),
    OfflineAPI:{chatEditCommand:text=>/\b(?:acrescente|retire)\b/i.test(text),chatSearchIntent:text=>({eligible:true,canPick:true,list:/entre esses|desses/i.test(text)}),normalize:value=>value.toLowerCase(),semanticLabels:()=>['Arrependimento'],validateHints:hints=>hints},
    jsonRequest:async(url,payload)=>{
      if(url==='/api/scripture/context')return scripture;
      if(url.startsWith('/api/hymns/'))return {lyrics:reviewLyrics.get(Number(url.split('/').at(-1)))};
      if(url==='/api/chat-candidates'){
        lookups.push(payload.message);
        return chatLookup?chatLookup(payload.message):{hymns:hymns.slice(3)};
      }
      requests.push(payload);
      if(additionalSearch&&payload.settings.pageSize===10)return additionalSearch();
      return {results:searchResults,effective_query:payload.model_query||payload.query,model_refinement:payload.model_query||'',excluded:payload.exclude,deprioritized:nativeModel?payload.deprioritize:['tristeza'],ai_context:context,total:hymns.length,page:payload.page||1};
    },
    busySearch:value=>{state.busy=value;},resultCard:hymn=>'[hino:'+hymn.id+']',RepertoireUI:{renderSearch(){}},EmbeddingSearch:{maybeUpdate:(...args)=>{embeddings.push(args);return embeddingTask?.();}}});
  return {calls,cancelled,$,state,requests,lookups,embeddings,opened,messages,vector,gguf,search,refine,visible,setTime:ms=>{now=ms;},complete:(id,value,ok=true,metrics=null)=>window.__ggufNativeEvent('generate',ok,value,id,metrics)};
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

  const automatic=setup({auto:true,initialResults:reviewHymns});
  await automatic.gguf.maybeAuto('Filho Pródigo');
  assert.equal(automatic.calls.length,1);
  assert.match(automatic.calls[0][0],/Filho Pródigo/);
  assert.deepEqual(automatic.state.lastResults.map(x=>x.id),[1,2,3,4,5,6]);
  for(const [index,grade] of grades.entries()){
    if(index===1)automatic.setTime(3000);
    automatic.complete(automatic.calls[index][1],grade);
    if(index<grades.length-1)assert.equal(automatic.state.lastResults,reviewHymns);
  }
  assert.equal(automatic.calls[2][4],27000);
  assert.deepEqual(Array.from(automatic.state.lastResults,x=>x.id),[2,1,3,4,5,6]);
  assert.match(automatic.state.lastResults[0].aiReview.excerpt,/Hoje volto/);

  for(const [value,ok] of [['Tempo limite',false],['resposta inválida',true]]){
    const aborted=setup({auto:true,initialResults:reviewHymns});
    await aborted.gguf.maybeAuto('Filho Pródigo');
    aborted.complete(aborted.calls[0][1],value,ok);
    assert.equal(aborted.state.lastResults,reviewHymns);
  }
  const queued=setup({auto:true});
  await queued.gguf.maybeAuto(queued.state.effectiveQuery);
  const first=queued.calls[0][1];
  queued.state.searchEpoch++;
  queued.gguf.cancelSearchTask();
  await queued.gguf.maybeAuto('Paz na dificuldade');
  queued.complete(first,'sim');
  await tick();
  assert.equal(queued.calls.length,2);
  assert.equal(queued.state.lastResults,hymns);
  assert.match(queued.calls[1][0],/Paz na dificuldade/);

  let finishEmbedding;
  const immediateSearch=setup({auto:true,embeddingTask:()=>new Promise(resolve=>{finishEmbedding=resolve;})});
  immediateSearch.state.vectorQuery=null;
  assert.equal(await immediateSearch.search('Filho Pródigo'),true);
  assert.equal(immediateSearch.state.lastResults.length,6);
  assert.equal(immediateSearch.calls.length,0);
  finishEmbedding();
  await tick();
  assert.equal(immediateSearch.calls.length,1);
  const exactTitle=setup({auto:true,initialResults:[{...hymns[0],match_type:'titulo_exato'},...hymns.slice(1)]});
  await exactTitle.gguf.maybeAuto('Hino de teste 1');
  assert.equal(exactTitle.calls.length,0);

  const chosen=hymns[4];
  const cia={...hymns[5],number:chosen.number,collection:'CIA',collection_ids:['cia']};
  const chat=setup({initialResults:reviewHymns.slice(0,4),searchResults:reviewHymns.slice(0,4),chatLookup:message=>{
    if(/Acrescente o hino/.test(message))return {exact:true,verb:'acrescentar',hymns:[chosen,cia]};
    if(/Retire/.test(message))return {verb:'retirar',selector:message.slice(7),hymns:[]};
    if(/Somente/.test(message))return {refine:true,hymns:[]};
    return {hymns:[chosen,hymns[0]]};
  }});
  const firstTurn=chat.refine('Ainda estou em dúvida sobre o estilo');
  await tick();
  chat.complete(chat.calls[0][1],'["perguntar","clima"]');
  assert.equal(await firstTurn,true);
  assert.equal(chat.requests.length,0);
  const notes=setup({scripture:{reference:'Lucas 15:20',text:'Seu pai o viu e se compadeceu.'}});
  notes.state.chatQuestions.add('ocasiao');
  notes.state.chatQuestions.add('clima');
  const note='No culto, anotei que o Pai acolhe com misericórdia quem retorna. '
    +'A restauração começa quando a pessoa reconhece a distância e decide voltar. '.repeat(5)+'Lucas 15:20';
  const interpretation=notes.refine(note);
  await tick();
  assert.match(notes.calls[0][0],/Bíblia Livre Lucas 15:20: Seu pai o viu/);
  assert.ok(notes.calls[0][0].includes(note));
  const choices=notes.calls[0][2].split('\n').find(line=>line.startsWith('preference ::='));
  assert.doesNotMatch(choices,/ocasiao|clima/);
  notes.complete(notes.calls[0][1],'["falar","A anotação destaca o acolhimento do Pai. Perdão e restauração são caminhos para escolher os hinos."]');
  assert.equal(await interpretation,true);
  assert.equal(notes.requests.length,0);
  assert.match(notes.messages.at(-1),/Perdão e restauração/);
  const curate=notes.refine('Pode buscar agora?');
  await tick();
  assert.match(notes.requests.at(-1).query,/acolhe com misericórdia/);
  assert.match(notes.calls[1][0],/Escolha o hino/);
  assert.match(notes.messages.at(-1),/Encontrei/);
  notes.complete(notes.calls[1][1],'["indicar",2,"O trecho aproxima o tema de restauração do pedido."]');
  assert.equal(await curate,true);
  assert.match(notes.messages.at(-1),/Sugestão da IA/);

  const choose=chat.refine('Mais alegres, por favor');
  await tick();
  assert.match(chat.calls[1][0],/prefere hinos mais alegres ou mais solenes/);
  assert.doesNotMatch(chat.calls[1][2],/preference ::=/);
  assert.match(chat.calls[1][2],/^root ::= falar\n/);
  chat.complete(chat.calls[1][1],'["falar","Entendi. Para a abertura, vamos pensar em algo alegre e fácil de cantar em conjunto."]');
  assert.equal(await choose,true);
  assert.equal(chat.requests.length,0);
  assert.equal(chat.lookups.length,0);

  assert.equal(await chat.refine('Retire sobre sangue do cordeiro'),false);
  assert.match(chat.messages.at(-1),/Qual hino você quer retirar/);
  assert.equal(await chat.refine('Retire sobre Hino de teste 1'),true);
  assert.doesNotMatch(chat.$('results-list').innerHTML, /hino:1/);

  assert.equal(await chat.refine('Acrescente o hino 5'),false);
  assert.match(chat.messages.at(-1),/Qual deles você quer/);
  assert.equal(await chat.refine('O da CIA'),true);
  assert.ok(chat.visible().some(h=>h.id===6));
  assert.equal(chat.calls.length,2);
  assert.equal(await chat.refine('Busque somente hinos de alegria'),true);
  assert.equal(chat.requests.at(-1).query,'somente hinos de alegria');
  assert.equal(chat.requests[0].exclude[0],'tristeza');
  assert.ok(!chat.visible().some(h=>h.id===1));
  assert.ok(chat.visible().some(h=>h.id===6));
  assert.match(chat.messages.at(-1),/Encontrei/);

  const noModelChat=setup({nativeModel:false});
  assert.equal(await noModelChat.refine('Prefiro hinos de consolo'),false);
  assert.equal(noModelChat.requests.length,0);
  assert.match(noModelChat.messages.at(-1),/Carregue um modelo/);
  assert.equal(await noModelChat.refine('',{viaButton:true}),true);
  assert.equal(noModelChat.requests.at(-1).query,'hinos de consolo');

  const noEdits=setup({chatLookup:()=>({refine:true,hymns:[]})});
  assert.equal(await noEdits.refine('Não retire nenhum hino.'),true);
  assert.equal(noEdits.calls.length,0);
  const explanation=noEdits.refine('Não retire nenhum hino. Só me explique a lista.');
  await tick();
  assert.match(noEdits.calls[0][2],/^root ::= falar\n/);
  noEdits.complete(noEdits.calls[0][1],'["retirar",1]');
  assert.equal(await explanation,true);
  assert.equal(noEdits.state.chatRemoved.size,0);
  assert.equal(noEdits.requests.length,0);
  const plainFilter=noEdits.refine('Somente hinos de alegria');
  await tick();
  noEdits.complete(noEdits.calls[1][1],'["buscar","alegria"]');
  assert.equal(await plainFilter,false);
  assert.equal(noEdits.requests.length,0);
  assert.equal(noEdits.lookups.length,0);

  const addByTheme=setup({initialResults:hymns.slice(0,2),chatLookup:()=>({verb:'acrescentar',hymns:[chosen]})});
  const proposal=addByTheme.refine('Acrescente consolo');
  await tick();
  addByTheme.complete(addByTheme.calls[0][1],'["acrescentar",3]');
  assert.equal(await proposal,true);
  assert.equal(addByTheme.state.chatAdded.size,0);
  assert.match(addByTheme.messages.at(-1),/Responda sim ou não/);
  assert.equal(await addByTheme.refine('Sim'),true);
  assert.ok(addByTheme.state.chatAdded.has(chosen.id));

  const funeral=setup();
  const occasion=funeral.refine('Culto de velório. Hinos de consolo e encorajamento.');
  await tick();
  funeral.complete(funeral.calls[0][1],'["perguntar","clima"]');
  assert.equal(await occasion,true);
  const tone=funeral.refine('Solenes');
  await tick();
  assert.match(funeral.calls[1][0],/Confirme a preferência/);
  funeral.complete(funeral.calls[1][1],'["falar",", 1, 2, 3, 4, 5,"]');
  assert.equal(await tone,true);
  assert.match(funeral.messages.at(-1),/considerar essa preferência/);
  assert.equal(funeral.requests.length,0);
  const recommend=funeral.refine('Pode buscar agora?');
  await tick();
  assert.match(funeral.calls[2][0],/Solenes.*velório/);
  funeral.complete(funeral.calls[2][1],'["indicar",99,"Motivo fora do catálogo."]');
  assert.equal(await recommend,true);
  assert.match(funeral.messages.at(-1),/Encontrei/);

  const expiredChat=setup();
  const expiredTurn=expiredChat.refine('Quero esperança');
  await tick();
  expiredChat.complete(expiredChat.calls[0][1],'Tempo limite',false);
  assert.equal(await expiredTurn,false);
  assert.equal(expiredChat.requests.length,0);
  assert.match(expiredChat.messages.at(-1),/não respondeu/);

  const staleChat=setup();
  const staleTurn=staleChat.refine('Agora mais sobre vigiar');
  await tick();
  staleChat.state.searchEpoch++;
  staleChat.gguf.cancelSearchTask();
  staleChat.complete(staleChat.calls[0][1],'["retirar",1]');
  assert.equal(await staleTurn,false);
  assert.equal(staleChat.state.chatRemoved.size,0);

  const prefersChat=setup({auto:true,initialResults:reviewHymns});
  await prefersChat.gguf.maybeAuto('Paz');
  const reviewId=prefersChat.calls[0][1];
  const chatTurn=prefersChat.refine('E entre esses?');
  await tick();
  assert.deepEqual(prefersChat.cancelled,[reviewId]);
  prefersChat.complete(reviewId,'sim');
  prefersChat.complete(prefersChat.calls[1][1],'["destacar",1]');
  assert.equal(await chatTurn,true);
  assert.match(prefersChat.messages.at(-1),/Destaque da lista/);

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
