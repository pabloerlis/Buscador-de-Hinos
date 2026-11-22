'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync('app/src/main/assets/local-hymn-ai.js','utf8');
const ai = vm.runInNewContext(source+'\nLocalHymnAI');
const hymns = [
  {id:1,title:'Na manjedoura',snippet:'Os anjos cantam ao nascer Jesus.',match_type:'contexto'},
  {id:2,title:'Gratidão',snippet:'O povo oferece louvor pela colheita.',match_type:'contexto'},
  {id:3,title:'O retorno',snippet:'Deixou o pai, se arrependeu, voltou e foi acolhido pelo pai.',match_type:'acontecimento'},
  {id:4,title:'No mar',snippet:'A tempestade cessou e o barco chegou à praia.',match_type:'contexto'},
  {id:5,title:'Esperança',snippet:'A esperança da ressurreição nos sustenta.',match_type:'contexto'}
];
const request = ai.prepareComparison('Filho pródigo: deixa o pai e volta arrependido.', [], hymns,
  {reference:'Lucas 15:11-32'}, {term:'retorno',added:0});
if (request.candidates.size !== 1 || !request.candidates.has(3)) throw Error('A evidência direta não restringiu os candidatos.');
const out = 'app/src/androidTest/assets/lfm3-comparison.json';
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({
  prompt:request.prompt, grammar:request.grammar, maxTokens:request.maxTokens,
  timeoutMs:request.timeoutMs, expected:3
})+'\n');

const pairs = [
  'Os filhos entram no céu.\nOs anjos cantam ao recebê-los.',
  'Deixei meu pai.\nArrependido, voltei para casa.\nEle me abraçou e me perdoou.',
  'O vento cessou no mar.\nO barco chegou à praia.',
  'Deus me consola na dor.\nSeu amor me dá forças.'
];

const reviewHymns = pairs.map((lyrics,i)=>({id:i+1,snippet:lyrics.split('\n')[i===1?1:0]}));
const stories = JSON.parse(fs.readFileSync('app/src/main/assets/semantic-stories.json','utf8'));
const narrative = stories.stories.find(story=>story.id==='filho_prodigo').review_focus;
const review = ai.prepareReview('Filho pródigo',new Map(pairs.map((lyrics,i)=>[i+1,lyrics])),reviewHymns,{
  context:{narrative}
});
if (!review) throw Error('A revisão automática precisa de quatro hinos.');
fs.writeFileSync('app/src/androidTest/assets/lfm3-review.json',JSON.stringify({
  requests:review.requests.map(({prompt,grammar,maxTokens})=>({prompt,grammar,maxTokens})),
  timeoutMs:review.timeoutMs
})+'\n');


const chatHymns=[
  {id:27,number:'027',title:'Vento no mar',snippet:'Cristo disse ao vento que se aquietasse.'},
  {id:38,number:'038',title:'Volta ao pai',snippet:'Deixei meu pai, me arrependi e voltei para casa.'},
  {id:49,number:'049',title:'Morar no céu',snippet:'Os filhos entram no céu e os anjos cantam.'}
];
const chatRequests=[
  ai.prepareChat({query:'Hinos para o culto',message:'Quero refinar, mas ainda estou em dúvida sobre o estilo.',shown:chatHymns.slice(0,2)}),
  ai.prepareChat({query:'Regresso ao Pai',message:'Retire o hino 027.',shown:chatHymns.slice(0,2),forced:{verb:'retirar',id:27}}),
  ai.prepareChat({query:'Regresso ao Pai',message:'Acrescente o hino 049.',shown:chatHymns.slice(1,2),found:chatHymns.slice(2),forced:{verb:'acrescentar',id:49}}),
  ai.prepareChat({query:'Hinos para o culto',message:'Pode retirar o da tempestade?',forced:{verb:'retirar',id:27},
    history:[{kind:'assistant',text:'Qual tema você quer enfatizar? Há algum tema que prefere evitar?'}],
    shown:[{id:27,number:'027',title:'Vento no mar',snippet:'Cristo acalmou a tempestade.'},
      {id:38,number:'038',title:'Volta ao pai',snippet:'Eu me arrependi e voltei para meu pai.'}]}),
  ai.prepareChat({message:'Solenes',answeringPreference:true,asked:['clima','ocasiao'],
    history:[{kind:'user',text:'Culto de velório. Hinos de consolo e encorajamento.'},
      {kind:'assistant',text:'Você prefere hinos mais alegres ou mais solenes?'}]}),
  ai.prepareRecommendation('Culto de velório. Hinos solenes, de consolo e encorajamento.',[
    {id:71,title:'Canto da colheita',snippet:'Vamos celebrar a colheita com danças e alegria.'},
    {id:82,title:'Consolo na dor',snippet:'Deus consola quem chora e sustenta o coração na dor.'}
  ])
];
fs.writeFileSync('app/src/androidTest/assets/lfm3-chat.json',JSON.stringify({
  requests:chatRequests.map(({prompt,grammar,maxTokens,timeoutMs})=>({prompt,grammar,maxTokens,timeoutMs}))
})+'\n');
