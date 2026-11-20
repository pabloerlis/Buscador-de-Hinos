'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assets=path.join(__dirname,'../app/src/main/assets');
const sharedReason=/Temas no mesmo trecho/;

function createSearch(overrides=assets){
  const read=name=>{
    const file=path.join(overrides,name);
    return fs.readFileSync(fs.existsSync(file)?file:path.join(assets,name),'utf8');
  };
  const stored=new Map(),preferences=new Map();
  const indexedDB={open(){
    const request={};
    queueMicrotask(()=>{
      request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
        const transaction={objectStore(){return {
          get(key){const result={};queueMicrotask(()=>{result.result=stored.get(key);result.onsuccess();});return result;},
          put(value,key){stored.set(key,value);queueMicrotask(()=>transaction.oncomplete());}
        };}};
        return transaction;
      }};
      request.onsuccess();
    });
    return request;
  }};
  const document={createElement(){
    return {content:{textContent:''},set innerHTML(value){
      this.content.textContent=value.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
    }};
  }};
  const fixtures=['semantic-db.json','semantic-bridge.json','semantic-stories.json'];
  const data=new Map(fixtures.map(name=>[name,JSON.parse(read(name))]));
  const context=vm.createContext({console,setTimeout,clearTimeout,indexedDB,window:{indexedDB},document,
    localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,String(value))},
    fetch:async name=>({ok:data.has(name),json:async()=>data.get(name)})
  });
  for(const file of ['semantic-engine.js','bridge-engine.js','story-engine.js','bible-context.js',
    'recommendation-engine.js','repertoire-store.js','offline-api.js']){
    vm.runInContext(read(file),context,{filename:file});
  }
  return vm.runInContext('OfflineAPI.request',context);
}

const cases=[
  {title:'No caminho',a:'Quero perseverar até o fim.',b:'Confio em teu amparo.',queries:[
    'perseverança e confiança','confio mas preciso perseverar','estou cansado de esperar, mas ainda confio em Deus',
    'quero persistir e confiar','perseverança quando preciso confiar'
  ]},
  {title:'Pela manhã',a:'Agradeço pela manhã.',b:'Minha esperança está na promessa.',queries:[
    'gratidão e esperança','quero agradecer enquanto espero, com esperança','dar graças e lembrar da promessa',
    'sou grato pela esperança','um hino de ação de graças e esperança'
  ]},
  {title:'Diante de ti',a:'Em oração, eu ergo um clamor.',b:'Teu consolo acolhe minhas lágrimas.',queries:[
    'oração e consolo','quero orar em busca de consolo','um clamor para quem está em lágrimas',
    'um hino de consolo para o momento de oração','orações de consolo com clamor'
  ]},
  {title:'Quando te vi',a:'No Calvário vi teu sacrifício.',b:'O perdão apagou minha culpa.',queries:[
    'cruz e perdão','o sacrifício que trouxe perdão','um hino do calvário sobre perdão',
    'perdão por causa da cruz','lembrar do madeiro e do perdão'
  ]},
  {title:'Ao cair da noite',a:'Maranata, Jesus voltará.',b:'Vigiai, deixai as lâmpadas acesas.',queries:[
    'volta de Jesus e vigilância','Maranata e vigilância','quero vigiar porque Jesus voltará',
    'segunda vinda com lâmpadas acesas','Jesus voltará e precisamos estar em vigilância'
  ]},
  {title:'Ao teu encontro',a:'Preciso de cura em minha enfermidade.',b:'Em oração diante de ti me ajoelho.',queries:[
    'cura e oração','oração por cura','hinos para orar por quem está em enfermidade',
    'na enfermidade eu quero orar','um momento de clamor pela cura'
  ]},
  {title:'Em tuas mãos',a:'Tua graça divina me alcançou.',b:'Em ti encontrei salvação.',queries:[
    'graça e salvação','salvação pela graça','a graça divina veio para salvar',
    'um hino sobre o favor imerecido e a salvação','pela graça fui salvo'
  ]},
  {title:'Caminhamos juntos',a:'Há serviço para cada irmão.',b:'Unidos em Cristo, somos um só corpo.',queries:[
    'serviço e comunhão','servir em unidade','trabalho na obra com comunhão',
    'um hino sobre servir unidos em Cristo','serviço no corpo de Cristo'
  ]}
];
const number=n=>String(n).padStart(3,'0');
const song=(id,title,content)=>({title:number(id)+' - '+title,content});
const passageSlot=i=>i%3===2?1:2;
const songs=cases.flatMap(({title,a,b},i)=>{
  const start=i*4;
  const combined=passageSlot(i);
  return [
    song(start+3-combined,title+' ao longe',a+'\n \n'+b+'\nFechou-se a janela.'),
    song(start+combined,title,a+'\n'+b+'\nAbriu-se a porta.'),
    song(start+3,title+' hoje',a+'\nLá fora a manhã chegou.'),
    song(start+4,title+' agora',b+'\nO dia terminou.')
  ];
});
songs.push(song(91,'Uma só pista','Na aflição, sigo pelo campo.'));
songs.push(song(92,'Trecho distante','Quero perseverar até o fim.\nO dia chegou.\nA cortina se abriu.\nOs pássaros voaram.\nConfio em teu amparo.'));
const fixture=[{name:'Coletânea 2018',songs}];
const controls=[
  {query:'Hino 002'},
  {query:'No caminho'},
  {query:'“Confio em teu amparo”'},
  {query:'“Confio em teu amparo” e perseverança'},
  {query:'perseverança e confiança',settings:{mode:'literal'}},
  {query:'perseverança e confiança',settings:{strength:0}},
  {query:'apenas os de esperança',refine:true,previous:'gratidão e esperança'},
  {query:'gratidão e esperança sem gratidão'},
  {query:'somente “consolo”',refine:true,previous:'oração e consolo'},
  {query:'zzzzsemresultados'}
];
const queries=cases.flatMap(({queries},i)=>queries.map(query=>({query,grades:new Map([
  [number(i*4+passageSlot(i)),3],[number(i*4+3-passageSlot(i)),1],[number(i*4+3),1],[number(i*4+4),1]
])})));
function dcg(grades){
  return grades.slice(0,5).reduce((total,grade,i)=>total+(2**grade-1)/Math.log2(i+2),0);
}
async function assess(request){
  const scores=[];
  let bestFirst=0;
  for(const {query,grades} of queries){
    const {results}=await request('/api/search',{query});
    scores.push(dcg(results.map(h=>grades.get(h.number)||0))/dcg([3,1,1,1]));
    if(grades.get(results[0]?.number)===3)bestFirst++;
  }
  return {nDCG5:scores.reduce((x,y)=>x+y,0)/scores.length,bestFirst};
}
async function evaluateCatalog(filename,baseline){
  const corpus=JSON.parse(fs.readFileSync(filename,'utf8'));
  const versions=baseline?[['referência',baseline],['atual',assets]]:[['atual',assets]];
  const rankings=[];
  const evidenceByQuery=[];
  for(const [name,directory] of versions){
    const request=createSearch(directory);
    const imported=await request('/api/import',{data:corpus});
    const results=[],elapsed=[];
    for(const {query} of queries){
      const start=performance.now();
      const page=await request('/api/search',{query,_forRecommendations:true});
      elapsed.push(performance.now()-start);
      results.push(page.results.map(h=>h.id));
      if(name==='atual')evidenceByQuery.push(new Set(page._fullRanked.filter(h=>h.sharedPassage).map(h=>h.id)));
    }
    elapsed.sort((a,b)=>a-b);
    rankings.push({name,count:imported.count,results,p95:+elapsed[Math.ceil(.95*elapsed.length)-1].toFixed(2)});
  }
  assert.ok(evidenceByQuery.some(ids=>ids.size>0),'A coletânea importada precisa exercitar a pontuação por trecho.');
  // Verifica os dois rankings com a mesma evidência local, inclusive quando o ranking antigo não a mostrava.
  for(const {name,count,results,p95} of rankings){
    const jointEvidence=results.filter((hits,i)=>hits.some(id=>evidenceByQuery[i].has(id))).length;
    const jointFirst=results.filter((hits,i)=>evidenceByQuery[i].has(hits[0])).length;
    console.log(JSON.stringify({catalogo:name,hinos:count,consultas:queries.length,jointEvidence,jointFirst,p95MsNode:p95}));
  }
  if(rankings.length>1){
    const changed=rankings[0].results.filter((hits,i)=>hits.join(',')!==rankings[1].results[i].join(',')).length;
    console.log('Top 5 alterado em '+changed+' consultas na coletânea real.');
  }
}

(async()=>{
  const options=Object.fromEntries(process.argv.slice(2).map(arg=>{
    const match=arg.match(/^--(baseline|catalog)=(.+)$/);
    assert.ok(match,'Use --baseline=diretório ou --catalog=arquivo.');
    return [match[1],match[2]];
  }));
  assert.equal(queries.length+controls.length,50);
  const request=createSearch();
  await request('/api/import',{data:fixture});
  const current=await assess(request);
  assert.ok(current.nDCG5>=.84,'Ranking temático controlado: '+JSON.stringify(current));
  const pairing=await request('/api/search',{query:'perseverança e confiança',settings:{pageSize:10}});
  const preferred=pairing.results.find(h=>h.number==='002');
  assert.equal(pairing.results[0]?.number,'002');
  assert.match(preferred?.reason,sharedReason);
  assert.match(preferred?.snippet,/perseverar.+Confio/);
  for(const id of ['001','091','092']){
    const query=id==='091'?'tribulação e consolo':'perseverança e confiança';
    const page=await request('/api/search',{query,settings:{pageSize:10}});
    const hit=page.results.find(h=>h.number===id);
    assert.ok(hit,'Hino de controle excluído: '+id);
    assert.doesNotMatch(hit.reason,sharedReason,'Evidência insuficiente no hino '+id);
  }
  const natural=await request('/api/search',{query:cases[0].queries[2]});
  assert.equal(natural.results[0]?.number,'002');
  assert.match(natural.results[0].reason,sharedReason);
  const originalControls=[];
  for(const payload of controls){
    const {results}=await request('/api/search',payload);
    assert.ok(results.every(h=>!sharedReason.test(h.reason)),payload.query);
    originalControls.push(results.map(h=>[h.number,h.relevance_score]));
  }
  const hidden=await request('/api/search',{query:'perseverança e confiança',settings:{showReasons:false}});
  assert.equal(hidden.results[0].reason,'');
  assert.equal(hidden.results[0].snippet,preferred.snippet);
  console.log('Ranking controlado atual, 40 consultas temáticas + 10 controles: '+JSON.stringify(current));
  if(options.baseline){
    const baseline=createSearch(options.baseline);
    await baseline('/api/import',{data:fixture});
    const previous=await assess(baseline);
    for(const [i,payload] of controls.entries()){
      const {results}=await baseline('/api/search',payload);
      assert.equal(JSON.stringify(originalControls[i]),JSON.stringify(results.map(h=>[h.number,h.relevance_score])),payload.query);
    }
    assert.ok(current.nDCG5>previous.nDCG5);
    console.log('Ranking controlado de referência: '+JSON.stringify(previous));
  }
  if(options.catalog)await evaluateCatalog(options.catalog,options.baseline);
})().catch(error=>{console.error(error);process.exitCode=1;});
