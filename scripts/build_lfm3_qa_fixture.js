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
const reviewHymns = pairs.map((lyrics,i)=>({id:i+1,snippet:lyrics.split('\n')[0]}));
const review = ai.prepareReview('Filho pródigo',new Map(pairs.map((lyrics,i)=>[i+1,lyrics])),reviewHymns);
if (!review) throw Error('A revisão automática precisa de quatro hinos.');
fs.writeFileSync('app/src/androidTest/assets/lfm3-review.json',JSON.stringify({
  prompt:review.prompt, grammar:review.grammar, maxTokens:review.maxTokens, timeoutMs:review.timeoutMs
})+'\n');
