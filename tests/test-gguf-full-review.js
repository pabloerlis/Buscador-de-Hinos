'use strict';
// Testa revisão integral, fila de candidatos e ausência de hinos repetidos.
// Usa apenas letras sintéticas. Nunca distribui letras reais no teste.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assets=path.resolve(__dirname,'../app/src/main/assets');
const read=name=>fs.readFileSync(path.join(assets,name),'utf8');
const aiSource=read('local-hymn-ai.js');
const appSource=read('app.js');
const html=read('index.html');
const cpp=fs.readFileSync(path.resolve(__dirname,'../app/src/main/cpp/hinos_jni.cpp'),'utf8');
assert.match(cpp,/cp\.n_ctx=3072/);
assert.match(cpp,/n_tokens>2500/);
assert.match(html,/id="gguf-review-model"/);
assert.match(html,/id="gguf-more-two"/);
const ai=vm.runInNewContext(aiSource+'\nLocalHymnAI');
const input='Retorno, arrependimento e acolhimento.';
const complete='O filho saiu da casa do pai.\n\nDepois decidiu voltar.\nO pai o recebeu com amor.';
const request=ai.prepareFullReview(input,[],{id:2,title:'Volta',lyrics:complete},{reference:'Lucas 15'});
assert.match(request.prompt,/O filho saiu da casa do pai/);
assert.match(request.prompt,/O pai o recebeu com amor/);
assert.equal(ai.readFullReview('3').approved,true);
assert.equal(ai.readFullReview('2').approved,true);
assert.equal(ai.readFullReview('1').approved,false);
assert.equal(ai.readFullReview('0').approved,false);
assert.throws(()=>ai.readFullReview('["2"]'));
assert.equal(ai.prepareFullReview(input,[],{lyrics:'x'.repeat(8501)}),null);

const ggufSource=appSource.slice(appSource.indexOf('const GGUF='),appSource.lastIndexOf('refreshStatus().catch'));
const hymns=[
  {id:1,title:'Hino A',number:'001',lyrics:'O céu é maravilhoso.'},
  {id:2,title:'Hino B',number:'002',lyrics:complete},
  {id:3,title:'Hino B duplicado',number:'003',lyrics:complete},
  {id:4,title:'Hino C',number:'004',lyrics:'Saí do caminho.\nMas voltei, e fui perdoado.'},
  {id:5,title:'Não aprendido',number:'005',lyrics:'Sou acolhido.'},
  {id:6,title:'Hino D',number:'006',lyrics:'Eu me arrependi e voltei.'},
  {id:7,title:'Hino E',number:'007',lyrics:'A reconciliação chegou ao meu lar.'},
  {id:8,title:'Hino F',number:'008',lyrics:'O pai acolheu o filho.'}
];
const emitted=[],toastMessages=[],opened=[],elements=new Map();
function $(id){
  if(!elements.has(id)){
    const classes=new Set(['hidden']);
    elements.set(id,{
      textContent:'',children:[],disabled:false,className:'',
      classList:{
        add:x=>classes.add(x),remove:x=>classes.delete(x),
        contains:x=>classes.has(x),toggle(x,force){
          if(force===undefined){if(classes.has(x))classes.delete(x);else classes.add(x);}
          else if(force)classes.add(x);else classes.delete(x);
        }
      },
      addEventListener(type,fn){if(type==='click')this.click=fn;},
      replaceChildren(){this.children=[];},appendChild(x){this.children.push(x);}
    });
  }
  return elements.get(id);
}
const window={NativeGGUF:{
  status:()=>JSON.stringify({available:true,selected:true,loaded:true,phase:'ready'}),
  generate:(...args)=>emitted.push(args),cancel(){}
}};
const state={ready:true,status:{hymn_count:8},searchEpoch:1,
  searchRootQuery:'Retorno',originalQuery:'Retorno',effectiveQuery:'Retorno',
  exclude:[],deprioritize:[],requiredTerms:[],semanticHints:[],exactNumber:false,
  lastResults:hymns.slice(0,5),repertoirePending:false,busy:false,
  searchSettings:{mode:'balanced',vectorMode:'off',collections:{principal:true}},aiContext:null,
  vectorQuery:null};
const context={
  window,$,state,console,performance:{now:()=>0},
  document:{createElement(){return {
    textContent:'',className:'',addEventListener(type,fn){if(type==='click')this.click=fn;}
  };}},
  localStorage:{getItem:()=>null,setItem(){}},setInterval(){},
  toast:m=>toastMessages.push(m),openHymn:id=>opened.push(id),
  searchRestrictions:()=>({exclude:[],deprioritize:[],require:[]}),
  OfflineAPI:{normalize:s=>String(s).toLowerCase(),semanticLabels:()=>[],validateHints:x=>x},
  jsonRequest:async(url)=>{
    if(url==='/api/search')return {_fullRanked:hymns.map(h=>({id:h.id,title:h.title,number:h.number}))};
    if(url==='/api/repertoire')return {not_learned:[{id:5}]};
    if(url.startsWith('/api/hymns/'))return hymns.find(h=>h.id===Number(url.split('/').at(-1)));
    throw Error('Unexpected URL '+url);
  }
};
vm.createContext(context);
vm.runInContext(aiSource+ggufSource,context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  $('gguf-review-model').click();
  await tick();
  assert.equal(emitted.length,1);
  assert.match(emitted[0][0],/O céu é maravilhoso/);
  const grades=['0','3','2','3','2','3'];
  let cursor=0;
  // O hino duplicado 3 não será enviado ao modelo.
  while(cursor<4){
    const call=emitted[cursor];
    assert.ok(call,'Faltou chamada ao modelo '+cursor);
    window.__ggufNativeEvent('generate',true,grades[cursor],call[1],{tokens:1});
    cursor++;
    await tick();
  }
  assert.equal($('gguf-comparison-actions').children.length,2);
  assert.match($('gguf-comparison-text').textContent,/Hino B/);
  assert.match($('gguf-comparison-text').textContent,/Hino C/);
  assert.doesNotMatch($('gguf-comparison-text').textContent,/Hino B duplicado/);
  assert.equal($('gguf-more-two').classList.contains('hidden'),false);
  $('gguf-more-two').click();
  await tick();
  assert.equal(emitted.length,5);
  window.__ggufNativeEvent('generate',true,'3',emitted[4][1],{tokens:1});
  await tick();
  assert.equal(emitted.length,6);
  window.__ggufNativeEvent('generate',true,'2',emitted[5][1],{tokens:1});
  await tick();
  assert.equal($('gguf-comparison-actions').children.length,4);
  const text=$('gguf-comparison-text').textContent;
  for(const title of ['Hino B','Hino C','Hino D','Hino E'])
    assert.equal(text.split(title).length-1,1,'Recomendação duplicada: '+title);
  assert.doesNotMatch(text,/Não aprendido/);
  console.log('GGUF review: letra integral, rejeição, +2, deduplicação e repertório PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
