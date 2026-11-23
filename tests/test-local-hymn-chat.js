'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require('../app/src/main/assets/local-hymn-chat.js');
const assets=path.join(__dirname,'../app/src/main/assets');
const read=x=>fs.readFileSync(path.join(assets,x),'utf8');

assert.ok(tool.PLAN_GRAMMAR.includes('BUSCAR'));
assert.ok(tool.PLAN_GRAMMAR.includes('BIBLIA'));
for(const x of ['BUSCAR','LER','BIBLIA','CONVERSAR'])assert.equal(tool.readPlan(JSON.stringify(x)),x);
for(const output of ['BUSCAR','{"fetch":"url"}','"DELETE"','"hino 20"','["BUSCAR"]',''])assert.throws(()=>tool.readPlan(output));
const session={topic:'',turns:[],preferences:[],candidates:[],bibleReference:null};
const plan=tool.planPrompt('Quando o filho pródigo voltou, quero um hino para reconciliação',session);
assert.ok(plan.prompt.includes('Nova mensagem'));
assert.ok(plan.grammar.includes('CONVERSAR'));
assert.ok(plan.prompt.length<1701);
tool.remember(session,'Quero hinos sobre o filho pródigo.');
session.turns.push({role:'user',text:'Quero hinos sobre o filho pródigo.'},
 {role:'assistant',text:'Vou procurar na coletânea.'});
tool.remember(session,'Prefiro o retorno arrependido, sem foco na festa.');
assert.ok(session.preferences[0].includes('sem foco'));
const follow=tool.planPrompt('Por que você perguntou de novo?',session);
assert.match(follow.prompt,/Prefiro o retorno arrependido/);
assert.match(follow.prompt,/Quero hinos sobre o filho pródigo/);
const query=tool.queryFor(session,'Sugira outros hinos de reconciliação');
assert.match(query,/filho pródigo/);
assert.match(query,/outros hinos/);
const sample=tool.extractLyrics('O princípio é diferente\n\nO meio fala de mudança\n\nO fim fala de acolhimento');
assert.match(sample.text,/Início:.*Meio:.*Fim:/s);
assert.equal(sample.stanza_count,3);
assert.equal(tool.extractLyrics('').text,'');
assert.ok(tool.extractLyrics('X'.repeat(4000)).truncated);
const calls=[];
const api=async(url,payload)=>{
  calls.push({url,payload});
  if(url==='/api/contextual/candidates')return {
    count:19,semantic_judgment:'NOT_VERIFIED',default_ranking_changed:false,
    candidates:[
      {hymn_id:8,number:'008',title:'Novo caminho',source_status:'unjudged_not_verified'},
      {hymn_id:20,number:'020',title:'Voltar para a casa',source_status:'unjudged_not_verified'}
    ]
  };
  if(url==='/api/bible/context')return {
    reference:'Lucas 15:20',source:'Bíblia Livre',verses:[
      {number:20,text:'O pai recebeu o filho.'}
    ]
  };
  if(url==='/api/search')return {results:[{id:20,number:'020'}]};
  if(url==='/api/hymns/20')return {
    id:20,number:'020',title:'Voltar para a casa',
    lyrics:'Início do retorno\n\nMeio do relato\n\nConclusão de reconciliação'
  };
  throw Error('No unauthorized endpoint: '+url);
};
(async()=>{
  const options={collections:{principal:true,avulsos:false},vectorMode:'off'};
  const search=await tool.execute('BUSCAR','Quero hinos do retorno',session,api,options);
  assert.equal(search.tool,'search_hymns');
  assert.equal(session.candidates.length,2);
  assert.equal(calls[0].url,'/api/contextual/candidates');
  assert.equal(calls[0].payload.settings.collections.avulsos,false);
  assert.doesNotMatch(search.modelContext,/O meio fala de mudança/);
  const bible=await tool.execute('BIBLIA','O que diz Lucas 15:20?',session,api,options);
  assert.equal(bible.tool,'get_bible_context');
  assert.equal(session.bibleReference,'Lucas 15:20');
  assert.equal(calls[1].url,'/api/bible/context');
  const lyrics=await tool.execute('LER','Analise o hino 20',session,api,options);
  assert.equal(lyrics.tool,'get_hymn_full_lyrics');
  assert.match(lyrics.modelContext,/Início:.*Meio:.*Fim:/s);
  assert.ok(calls.some(x=>x.url==='/api/hymns/20'));
  const answer=tool.answerPrompt('Por que ele combina?',session,lyrics);
  assert.ok(answer.prompt.includes('Não afirme ter conferido letra inteira'));
  assert.ok(answer.prompt.includes('sem foco'));
  assert.ok(answer.prompt.length<=2600);
  assert.equal(answer.grammar,'');
  assert.equal(tool.sanitizeAnswer('<|assistant|>Fala de reconciliação.'),'Fala de reconciliação.');
  const talk=await tool.execute('CONVERSAR','Entendi',session,api,options);
  assert.equal(talk.tool,'none');
  await assert.rejects(()=>tool.execute('EXECUTAR','apagar tudo',session,api,options),/não autorizada/);
  const bad=async()=>({count:1,semantic_judgment:'VERIFIED',default_ranking_changed:true,candidates:[]});
  await assert.rejects(()=>tool.execute('BUSCAR','teste',session,bad,options),/rejeitada/);
  assert.ok(calls.every(x=>/^(\/api\/contextual\/candidates|\/api\/bible\/context|\/api\/search|\/api\/hymns\/\d+)$/.test(x.url)),
    'No arbitrary endpoints');
  const index=read('index.html'),app=read('app.js');
  for(const id of ['main-tab-chat','main-tab-search','chat-screen','chat-input','chat-form','chat-events','chat-messages','chat-reset','chat-stop']){
    assert.ok(index.includes('id="'+id+'"'),id);
  }
  assert.ok(index.includes('local-hymn-chat.js'));
  assert.ok(app.includes("window.__hymnChatNativeEvent?.(ok,value,requestId,metrics)"));
  assert.ok(app.includes("HymnChatTools.execute(plan,userText,session,jsonRequest,state.searchSettings)"));
  assert.ok(read('offline-api.js').includes("url==='/api/bible/context'"));
  assert.ok(read('style.css').includes('.chat-screen'));
  console.log('CHAT P4 PILOT PASS: grammar allowlist, session, local search/Bible/lyrics, evidence, UI wiring and no arbitrary tools.');
})().catch(e=>{console.error(e);process.exitCode=1;});
