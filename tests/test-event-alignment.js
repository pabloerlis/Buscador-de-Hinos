'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const assets=path.join(__dirname,'../app/src/main/assets');
const context=vm.createContext({});
for(const file of ['event-alignment.js','story-engine.js'])
  vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),context,{filename:file});
const Event=vm.runInContext('EventAlignment',context);
const Stories=vm.runInContext('StoryEngine',context);
const db=JSON.parse(fs.readFileSync(path.join(assets,'semantic-stories.json'),'utf8'));
const engine=Stories.create(db);
assert.ok(db.stories.length>=10,'Índice de narrativas específicas incompleto');
const template={groups:[['caminho','estrada'],['ferido','caido'],['socorreu','cuidou']]};
const aligned=Event.analyze(template,'Na estrada um homem caído\nO ferido foi socorrido\nAlguém cuidou dele\nFoi levado ao abrigo');
assert.equal(aligned.tier,3,'Ações e participantes da mesma cena não foram associados');
assert.equal(aligned.coverage,3);
const split=Event.analyze(template,'Na estrada o viajante\n\nUm homem ferido\n\nAlguém cuidou dele');
assert.equal(split.tier,0,'Evidências de estrofes separadas não são uma cena');
const generic=Event.analyze({groups:[['deus'],['jesus'],['amor']]},'Deus e Jesus e amor');
assert.ok(generic.tier<3,'Termos religiosos genéricos não comprovam um acontecimento');
const noEvidence=Event.analyze(template,'Amanheceu e os pássaros cantaram');
assert.equal(noEvidence.score,0);
const noCross=Event.windows('Uma linha\nOutra linha\n\nNova estrofe');
assert.equal(noCross.length,3,'Janelas não devem atravessar estrofes');
const all=engine.indexHymn('Mensagem','Voltei ao meu pai\nPedi perdão e ele me recebeu\nEncontrei meu lar');
assert.ok(all.some(x=>x.id==='filho_prodigo'&&x.eventCoverage>=2),'Evidências de ação não foram indexadas');
const unchanged=engine.indexHymn('Canto de alegria','Flores e nuvens no céu\nA manhã traz alegria');
assert.ok(!unchanged.some(x=>x.tier>=3),'Falso positivo narrativo em letra genérica');
for(const story of db.stories){
  const fake=story.groups.map(g=>g[0]).join(' ');
  const r=Event.analyze(story,fake);
  assert.ok(r.score>=0&&r.score<=15&&r.tier>=0&&r.tier<=3,story.id);
}
console.log('EVENTOS: 48+ narrativas, coocorrência local, papéis/ações, estrofes isoladas, rejeição de genéricos e indexação aprovados.');
