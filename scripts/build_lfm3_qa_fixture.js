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


// P4: chamar no Android a MESMA gramática e prompt do chat instalado no APK.
const chatSource=fs.readFileSync('app/src/main/assets/local-hymn-chat.js','utf8');
const chat=vm.runInNewContext(chatSource+'\nHymnChatTools');
const chatRequest=chat.planPrompt('Procure hinos sobre o retorno arrependido do filho pródigo.',{
  topic:'Retorno do filho pródigo',preferences:[],turns:[],candidates:[]
});
const chatTarget='app/src/androidTest/assets/lfm3-chat-decision.json';
fs.writeFileSync(chatTarget,JSON.stringify({
  prompt:chatRequest.prompt,grammar:chatRequest.grammar,
  maxTokens:chatRequest.maxTokens,timeoutMs:60000,
  expected:'BUSCAR'
})+'\n');
