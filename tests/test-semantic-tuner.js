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
assert.deepEqual(api.rank([A,B,C],api.presets.balanced),[A,B,C]);
assert.deepEqual(api.rank([C,B,A],{...api.presets.balanced,min:50}),[B,A]);
assert.deepEqual(api.rank([{...A,nli_label:'contradiction'},B],{}).map(row=>row.id),[1,2]);
assert.equal(JSON.stringify([A,B,C]),snapshot,'Reordenacao nao modifica resultado original');
assert.equal(api.rank([],api.presets.balanced).length,0);
assert.equal(api.addHistory(['Outro','tema'], 'TEMA')[0],'TEMA');
assert.equal(api.addHistory(Array.from({length:35},(_,i)=>'busca '+i),'mais').length,20);
assert.equal(api.history(['A','a','B','B']).length,2,'Historico sem repeticoes case insensitive');
assert.equal(api.history([null,6,{},'Sim']).length,1,'Descartar elementos inseguros');
// A neutral decision must be invisible to scoring, including the pool-wide
// availability check, threshold filtering and stable order among ties.
for(const pool of [[A,B,C],[C,{...C,id:4}]]){
  for(const preset of Object.values(api.presets)){
    const config={...preset,min:0};
    const positions=items=>api.rank(items,config).map(row=>[row.id,row.tuner_score]);
    for(const candidate of pool){
      const labeled=pool.map(row=>row.id===candidate.id?{...row,nli_label:'neutral'}:row);
      assert.deepEqual(positions(labeled),positions(pool));
      assert.deepEqual(api.signals({...candidate,nli_label:'neutral'}),api.signals(candidate));
    }
  }
}
const sample={id:5,relevance_percent:65,tuner_signals:{lexical:12}};
const scoreOf=(item)=>api.score(item,api.presets.balanced,{narrative:true,events:false});
assert.equal(scoreOf(sample),21);
assert.equal(scoreOf({...sample,nli_label:'neutral'}),21);
assert.deepEqual(api.rank([{...sample,nli_label:'neutral'},B],{...api.presets.balanced,min:40})
  .map(row=>row.id),api.rank([sample,B],{...api.presets.balanced,min:40}).map(row=>row.id));
assert.ok(scoreOf({...sample,nli_label:'entailment'})>scoreOf(sample));
assert.ok(scoreOf({...B,nli_label:'contradiction'})<scoreOf(B));
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
// A entrada GGUF fica visível antes da busca e na aba exclusiva de IA.
assert.ok(html.indexOf('id="gguf-home-card"')>html.indexOf('id="welcome-panel"'));
assert.ok(html.indexOf('id="gguf-home-card"')<html.indexOf('id="results-panel"'));
assert.ok(html.indexOf('id="gguf-select"')>html.indexOf('id="settings-panel-ai"'));
assert.ok(html.indexOf('id="gguf-load"')>html.indexOf('id="settings-panel-ai"'));
assert.ok(css.includes('.nli-setup-card'),'Seletor na tela inicial precisa de layout próprio');
require('./qa-qwen3-interface.js');
console.log('PASS semantic tuner: ranking, presets, limites, historico, integracao API/E5, HTML e CSS');
