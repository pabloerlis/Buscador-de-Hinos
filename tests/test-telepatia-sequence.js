'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const seq=require('../app/src/main/assets/telepatia-nli-sequence.js');

const mock={
  token_to_id(x){return ({'[CLS]':1,'[SEP]':2,'[MASK]':3})[x];},
  encode(text,opt={}){
    assert.equal(opt.add_special_tokens,false);
    const words=Array.from(text).map(x=>x.codePointAt(0)+100);
    return {ids:words};
  },
};
assert.deepEqual(seq.LABELS,['contradiction','entailment','neutral']);
assert.equal(seq.CRITERIA.entailment.includes('confirmar'),true);
assert.equal(seq.serializeState('Parábola'), '{"state": "Parábola"}');
const tokens=seq.sequence(mock,'O filho retornou ao pai.','O filho foi acolhido.');
assert.equal(tokens.length,1);
const first=tokens[0];
assert.equal(first.input_ids[0],1);
assert.equal(first.input_ids.at(-1),2);
assert.equal(first.qtype,0);
assert.equal(first.marker_pos.length,3);
assert.equal(first.marker_mask.every(Boolean),true);
assert.equal(first.marker_pos.every(i=>first.input_ids[i]===3),true);
assert.equal(first.input_ids.length<=512,true);
assert.equal(first.state_tokens>0,true);
assert.equal(tokens[0].state_tokens_used,tokens[0].state_tokens);
const windows=seq.sequence(mock,'a'.repeat(5000),'Uma história de retorno.',{maxWindows:80});
assert.ok(windows.length>=2);
assert.equal(windows.every(x=>x.input_ids.length<=512),true);
assert.equal(windows.every(x=>x.marker_pos.join(',')===windows[0].marker_pos.join(',')),true);
assert.equal(windows.every(x=>x.input_ids[x.marker_pos[0]]===3),true);
assert.ok(windows.at(-1).start_token+windows.at(-1).state_tokens_used>=windows.at(-1).state_tokens,'A última janela cobre a cauda');
assert.throws(()=>seq.sequence(mock,'a'.repeat(5000),'Hipótese',{maxWindows:2}),/cobertura máxima/);
assert.throws(()=>seq.sequence(mock,'','Hipótese'),/vazios/);
assert.throws(()=>seq.sequence(mock,'Estado',''),/vazios/);
assert.throws(()=>seq.sequence({...mock,token_to_id:()=>undefined},'Estado','Hipótese'),/Tokenizador incompatível/);
assert.throws(()=>seq.sequence(mock,'A'.repeat(12001),'Hipótese'),/excede/);
assert.throws(()=>seq.sequence(mock,'Estado','Hipótese',{maxLen:60}),/incompatível/);
const withoutOnnx=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/index.html'),'utf8');
assert.ok(!withoutOnnx.includes('Telepatia NLI carregado'),'Não alegar inferência sem resultados.');
console.log('PASS telepatia sequence: native format, masks, coverage, validation and no fake inference');
