#!/usr/bin/env node
/* Audita equivalência da tokenização pura em JavaScript contra Hugging Face
 * Rust tokenizers; sem modelo nem letras de hinos. Falha fechada.
 *
 * Usage:
 *   node tests/qa_telepatia_tokenizer_parity.mjs DIR_TOKENIZER JSON_REFERENCIA ARQUIVO_JS
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const [dir, reference, implementation] = process.argv.slice(2);
if(!dir||!reference||!implementation)throw Error("Usage: DIR JSON_REFERENCIA JS_LIBRARY");
const {Tokenizer}=await import(pathToFileURL(implementation).href);
const json=JSON.parse(fs.readFileSync(dir+"/tokenizer.json","utf8"));
const config=JSON.parse(fs.readFileSync(dir+"/tokenizer_config.json","utf8"));
const tests=JSON.parse(fs.readFileSync(reference,"utf8"));
const tok=new Tokenizer(json,config);
if(!Array.isArray(tests.samples)||tests.samples.length<25)throw Error("Insufficient tokenizer reference cases");
const failures=[];
for(const entry of tests.samples){
  const actual=tok.encode(entry.text,{add_special_tokens:false}).ids;
  if(JSON.stringify(actual)!==JSON.stringify(entry.ids))
    failures.push({index:entry.index,expectedLength:entry.ids.length,actualLength:actual.length,
      firstMismatch:actual.findIndex((x,i)=>entry.ids[i]!==x)});
}
for(const [key,expected] of Object.entries(tests.specials)){
  const got=tok.token_to_id(key);
  if(got!==expected)failures.push({special:key,expected,actual:got});
}
console.log("JS_TOKENIZER_PARITY",JSON.stringify({cases:tests.samples.length,
  mismatches:failures.length,firstErrors:failures.slice(0,8)}));
assert.equal(failures.length,0,"Tokenizer JS cannot be used with Telepatia; parity failed");
