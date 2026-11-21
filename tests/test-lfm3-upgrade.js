'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cmake=read('app/src/main/cpp/CMakeLists.txt');
const cpp=read('app/src/main/cpp/hinos_jni.cpp');
const gradle=read('app/build.gradle');
const workflow=read('.github/workflows/android-apk.yml');
const java=read('app/src/androidTest/java/br/com/buscadordehinos/app/Lfm3DeviceSmokeTest.java');
const script=read('scripts/qa_lfm3_android_emulator.sh');
const audit=read('scripts/qa_apk.py');
assert.match(cmake,/GIT_TAG b12088\b/);
assert.doesNotMatch(cmake,/GIT_TAG b8201\b/);
assert.match(cpp,/params\.load_mode=LLAMA_LOAD_MODE_MMAP/);
assert.doesNotMatch(cpp,/params\.use_(?:mmap|mlock|direct_io)\b/);
for(const required of ['llama_model_load_from_file','llama_sampler_init_grammar','llama_decode','llama_sampler_sample','llama_token_to_piece']){
  assert.ok(cpp.includes(required),'Ponte JNI perdeu '+required);
}
assert.match(gradle,/versionCode 31/);
assert.match(gradle,/versionName '2\.6\.12'/);
assert.match(workflow,/lfm3_model_qa:/);
assert.match(workflow,/needs: \[audit_apk, device_smoke, lfm3_model_qa,/);
assert.match(workflow,/name: lfm3-android-evidence-qa/);
assert.match(workflow,/qa_lfm3_android_emulator\.sh/);
assert.match(workflow,/sha256sum --check/);
assert.match(workflow,/43a7d09a0e9cba91b63eb7052488b9564569bddfd65754d2e426465e572a7452/);
assert.match(script,/adb shell run-as/);
assert.match(script,/svc wifi disable/);
assert.match(script,/svc data disable/);
assert.match(script,/INSTRUMENTATION_STATUS_CODE: 0/);
assert.match(java,/nativeLoad/);
assert.match(java,/nativeGenerate/);
assert.match(java,/root ::= \\"OK\\"/);
assert.match(java,/assertEquals\("Saída incompatível com gramática GBNF"/);
assert.match(audit,/lib\/arm64-v8a\/libhinosllm\.so/);
for(const required of ['-PenableLocalEmbeddings=true -PenableLocalModels=true','semantic_search_qa','full_lyrics_qa','independent_review']){
  assert.ok(workflow.includes(required),'Agente de LFM3 suprimiu '+required);
}
console.log('PASS: atualização LFM3, API mmap, prova Android real e preservação dos gates E5/RRF/eventos.');
