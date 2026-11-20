'use strict';
/* Sem "if" por história ou hino: casos mínimos permitem checar causalidade. */
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/event-frame-engine.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source,context);
const Engine=vm.runInContext('EventFrameEngine',context);

const passages={
  A:[
    'O jovem partiu e deixou a casa de seu pai.',
    'O filho regressou e voltou ao lar depois de muito sofrimento.',
    'O pai recebeu o filho e o abraçou, concedendo-lhe perdão.'
  ],
  B:[
    'O homem entrou no barco; os discípulos embarcaram.',
    'Uma grande tempestade agitou as ondas do mar.',
    'O Mestre se levantou, acalmou o vento e os discípulos se alegraram.'
  ],
  C:[
    'O enfermo sofria havia anos. Uma mulher buscou ajuda.',
    'Ela tocou a vestimenta do Mestre e recebeu cura.',
    'O Mestre respondeu: a confiança te salvou.'
  ],
  D:[
    'O pastor procurou uma ovelha perdida e a encontrou.',
    'Voltou com a ovelha nos ombros, reunindo seu rebanho.'
  ]
};
const sceneAliases={
  A:['filho voltou ao pai','pai recebeu o filho'],
  B:['tempestade no barco','Mestre acalmou a tempestade'],
  C:['mulher tocou o manto','cura de uma mulher'],
  D:['pastor procurou a ovelha','ovelha perdida encontrada']
};
const stories=Object.entries(passages).map(([id])=>({
  id,label:'História '+id,reference:id,aliases:['História do '+id,...sceneAliases[id]]
}));
const scripture={lookup:ref=>({verses:(passages[ref]||[]).map(text=>({text}))})};
const engine=Engine.create({narratives:stories},scripture);
assert.equal(engine.stats().episodes,4);
assert.ok(engine.stats().actionFamilies>=35);
const songs=[
  {id:1,title:'Um retorno',lyrics:'Parti da casa e deixei os caminhos antigos.\n\nVoltei ao pai e fui recebido. O pai me abraçou e me perdoou.'},
  {id:2,title:'Somente um assunto',lyrics:'O pai é bondoso e cuida de mim.\nA vida é preciosa e o amor é grande.'},
  {id:3,title:'Outra ação',lyrics:'Deixei minha angústia.\n\nVoltei para perto de Ti e fui perdoado.'},
  {id:4,title:'Ação negada',lyrics:'Não voltei, nem fui recebido.\nJamais abandonei minha casa.'},
  {id:5,title:'Mar e vento',lyrics:'Entramos no barco.\n\nA tempestade agitou as ondas.\n\nO Mestre levantou e acalmou o vento.'},
  {id:6,title:'Mar sem história',lyrics:'O oceano profundo e o vento calmo.\nPaz e fé em Deus.'},
  {id:7,title:'Oração e perdão',lyrics:'Eu oro por cura e perdão.\nDeus me abençoa.'},
  {id:8,title:'O perdido',lyrics:'Uma ovelha perdeu-se no campo.\nO pastor a procurou e encontrou.\nVoltou com alegria.'},
  {id:9,title:'Aleatório',lyrics:'A luz da manhã me conduz.\nO amor de Cristo é a minha canção.'}
];
engine.setCorpus(songs);
assert.equal(engine.stats().assigned,songs.length);
function ev(id,label){
  return engine.evaluate(songs.find(x=>x.id===id),{narrative:label});
}
const direct=ev(1,'História A'),topical=ev(2,'História A');
const analogy=ev(3,'História A'),negation=ev(4,'História A');
assert.ok(direct.score>=9,'Duas ações + ator no trecho precisam produzir evidência local: '+JSON.stringify(direct));
assert.ok(direct.tier>=1,'Ações e personagem na mesma cena dão nível narrativo');
assert.equal(topical.score,0,'Tema isolado não prova acontecimento');
assert.ok(analogy.score<=direct.score,'Analogia em primeira pessoa não supera representação direta');
assert.ok(negation.score<direct.score,'Frases negativas não são prova de ação ocorrida');
assert.match(direct.snippet,/Voltei ao pai/,'Evidência exibida deve vir de trecho existente da letra');
const storm=ev(5,'História B'),nonEvent=ev(6,'História B');
assert.ok(storm.score>nonEvent.score,'Ações no barco e acalmar devem vencer apenas vento/mar');
assert.ok(nonEvent.score<=4,'Uma cena nominal sem ações não deve ganhar promoção');
const heal=ev(7,'História C');assert.ok(heal.score<=8,'Cura e perdão genéricos não bastam para relato específico');
const shepherd=ev(8,'História D');assert.ok(shepherd.score>=10,'Personagem, procura e retorno devem ser detectados em qualquer narrativa');
assert.equal(engine.evaluate(songs[0],{narrative:'desconhecida'}).score,0,'Narrativa não identificada não pode receber evidência');
const noLyrics=engine.evaluate({id:100,title:'Nenhuma letra',lyrics:''},{narrative:'História A'});
assert.equal(noLyrics.score,0);
assert.equal(Engine.lcs(['a','b','c'],['b','a','c']),2,'Sequência deve preservar ordem, não usar conjunto de verbos');
const start=performance.now();
engine.setCorpus(Array.from({length:1557},(_,i)=>({id:i+1,title:'Hino '+i,lyrics:songs[i%songs.length].lyrics})));
assert.equal(engine.stats().assigned,1557);
assert.ok(performance.now()-start<6000,'Indexação de eventos excessivamente lenta na coletânea completa');
console.log('AÇÕES/ATORES: relato, analogia, negação, ator, ordem, falso positivo e desempenho aprovados.');
