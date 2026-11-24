'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assets=path.join(__dirname,'..','app','src','main','assets');
const engine=vm.runInNewContext(fs.readFileSync(path.join(assets,'lexical-pt.js'),'utf8')+'\nLexicalPT');
const example=engine.create({schema_version:1,source:'OpenWordnet-PT 1.0.0',groups:[['paz','serenidade'],['serenidade','calma']]});
assert.deepEqual(Array.from(example.synonyms('PÁZ')),['serenidade']);
assert.deepEqual(Array.from(example.synonyms('serenidade')),['calma','paz']);
assert.deepEqual(Array.from(example.synonyms('inexistente')),[]);
const data=JSON.parse(fs.readFileSync(path.join(assets,'lexical-pt.json'),'utf8'));
const full=engine.create(data);
assert.ok(full.terms>=10000);
assert.ok(full.groups>=5000);
assert.equal(full.terms,data.stats.terms);
assert.equal(full.groups,data.stats.groups);
let verified=0;
for(const group of data.groups.slice(0,100)){
  assert.ok(full.synonyms(group[0]).includes(group[1]));
  assert.ok(full.synonyms(group[1]).includes(group[0]));
  verified+=2;
}
console.log('Base lexical real:',full.terms,'termos;',full.groups,'grupos;',verified,'equivalências verificadas.');
