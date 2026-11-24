'use strict';
/* Agente de regressao independente do runtime Android e de modelos ML.
 * Testa escores reais compilados, ordenacao deterministica e contrato visual.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../app/src/main/assets/semantic-tuner.js');
const asset=name=>fs.readFileSync(path.join(__dirname,'../app/src/main/assets',name),'utf8');
const A={id:1,title:'Tematico',relevance_percent:70,tuner_signals:{lexical:21,semantic:24,biblical:0,narrative:0,vector:85,actions:0,tier:0}};
const B={id:2,title:'Narrativo',relevance_percent:60,tuner_signals:{lexical:3,semantic:4,biblical:28,narrative:24,vector:72,actions:10,tier:2}};
const C={id:3,title:'Neutral',relevance_percent:40,tuner_signals:{lexical:0,semantic:0,biblical:0,narrative:0,vector:0,actions:0,tier:0}};
const snapshot=JSON.stringify([A,B,C]);
assert.equal(api.config({topic:700,narrative:-10,min:'nan'}).topic,100);
assert.equal(api.config({topic:700,narrative:-10,min:'nan'}).narrative,0);
assert.equal(api.config({topic:700,narrative:-10,min:'nan'}).min,0);
assert.equal(api.config({topic:null}).topic,70);
assert.equal(api.config({enabled:false}).enabled,false);
const broad=api.rank([A,B,C],api.presets.broad),narrative=api.rank([A,B,C],api.presets.narrative);
assert.equal(broad[0].id,1,'Busca temática deve favorecer candidato temático');
assert.equal(narrative[0].id,2,'Busca narrativa deve priorizar narrativa comprovada');
assert.notEqual(broad[0].id,narrative[0].id,'Sliders precisam alterar a ordem');
assert.equal(api.rank([A,B,C],{topic:0,narrative:0,events:0,min:0})[0].id,1);
assert.equal(api.rank([A,B,C],{...api.presets.balanced,min:101}).length,0,'Limite tem clamp em 100; todos podem ser filtrados');
assert.equal(api.rank([C,C],api.presets.balanced)[0].tuner_rank_baseline,0,'Empate estavel');
assert.equal(JSON.stringify([A,B,C]),snapshot,'Reordenacao nao modifica resultado original');
assert.equal(api.rank([],api.presets.balanced).length,0);
assert.equal(api.addHistory(['Outro','tema'], 'TEMA')[0],'TEMA');
assert.equal(api.addHistory(Array.from({length:35},(_,i)=>'busca '+i),'mais').length,20);
assert.equal(api.history(['A','a','B','B']).length,2,'Historico sem repeticoes case insensitive');
assert.equal(api.history([null,6,{},'Sim']).length,1,'Descartar elementos inseguros');
const html=asset('index.html'),js=asset('app.js'),offline=asset('offline-api.js'),css=asset('style.css');
const ids=['tuner-panel','tuner-enabled','tuner-topic','tuner-narrative','tuner-events','tuner-min',
  'tuner-reset','tuner-status','tuner-history-home-list','tuner-history-results-list'];
for(const id of ids)assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'ID ausente/duplicado: '+id);
assert.ok(html.indexOf('semantic-tuner.js')<html.indexOf('semantic-tuner-ui.js'));
assert.ok(html.indexOf('semantic-tuner-ui.js')<html.indexOf('app.js'));
assert.ok(js.includes('SearchTuner.accept(data)')&&js.includes('SearchTuner.accept(result)'),'E5 e busca textual devem atualizar o painel');
assert.ok(js.includes('tuner_pool:true'),'Candidatos recuperados apenas em consulta, nunca na movimentacao');
assert.ok(offline.includes('tuner_candidates:payload?.tuner_pool===true'),'Rota opt-in deve expor conjunto fixo');
assert.ok(css.includes('.semantic-tuner'),'Sem interface visual');
// Entrada do modelo deve estar disponível ANTES de executar uma busca.
assert.ok(html.indexOf('id="nli-home-card"')>html.indexOf('id="welcome-panel"'));
assert.ok(html.indexOf('id="nli-home-card"')<html.indexOf('id="results-panel"'),
  'O seletor deve aparecer na tela inicial; antes estava escondido nos resultados');
assert.ok(html.includes('id="nli-settings-card"')&&html.indexOf('id="nli-settings-card"')>html.indexOf('id="settings-panel-search"'),
  'O seletor deve existir em Configurações > Busca');
for(const id of ['nli-select-home','nli-select-settings','nli-select',
  'nli-load-home','nli-load-settings','nli-load',
  'nli-status-home','nli-status-settings','nli-status']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
    'Estado/controle Telepatia ausente ou duplicado: '+id);
}
assert.equal((html.match(/data-nli-select/g)||[]).length,3);
assert.equal((html.match(/data-nli-load/g)||[]).length,3);
const nliController=asset('telepatia-nli-client.js');
assert.ok(nliController.includes("document.querySelectorAll('[data-nli-select]')"),
  'Todos os botões devem abrir o seletor de ZIP');
assert.ok(nliController.includes("document.querySelectorAll('[data-nli-load]')"),
  'Todos os botões devem carregar o mesmo modelo');
assert.ok(nliController.includes("'nli-status-home','nli-status-settings','nli-status'"),
  'Status deve ser sincronizado nos três pontos de entrada');
assert.ok(css.includes('.nli-setup-card'),'Seletor na tela inicial precisa de layout próprio');
console.log('PASS semantic tuner: ranking, presets, limites, historico, integracao API/E5, HTML e CSS');
