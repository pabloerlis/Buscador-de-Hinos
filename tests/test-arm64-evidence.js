'use strict';
// Agent 3 runs the independent ARM64 evidence agent's tamper/negative tests.
// These fixtures never assert that a physical phone has been tested.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const p=spawnSync('python3',[path.resolve(__dirname,'../scripts/qa_arm64_evidence_agent.py'),'--selftest'],{encoding:'utf8'});
if(p.status!==0)throw Error('Agent 11 synthetic regression gate failed: '+p.stdout+'\n'+p.stderr);
if(!p.stdout.includes('1 positive + 7 negative fixtures PASS'))throw Error('Unexpected agent 11 coverage');
console.log(p.stdout.trim());
