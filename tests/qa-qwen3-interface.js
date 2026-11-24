'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('app/src/main/assets/index.html'),css=read('app/src/main/assets/style.css'),js=read('app/src/main/assets/app.js'),java=read('app/src/main/java/br/com/buscadordehinos/app/MainActivity.java');
assert.doesNotMatch(html,/Telepatia|Laya|Selecionar ZIP|Escolher ZIP|data-nli-select|telepatia-nli-client/i);
for(const id of ['gguf-home-card','gguf-select-home','gguf-load-home','gguf-select','gguf-load','settings-tab-ai','settings-panel-ai','gguf-compare-model','gguf-home-status']){
 assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,'missing/duplicate '+id);
}
assert.doesNotMatch(css,/html\.semantic-direct-mode[^{}]*(?:data-gguf-ui|settings-panel-ai|\.gguf-box|\.ai-buttons)[^{}]*\{[^}]*display:\s*none/i);
assert.match(java,/if\s*\(BuildConfig\.ENABLE_LOCAL_EMBEDDINGS\s*&&\s*!BuildConfig\.ENABLE_LOCAL_MODELS\)\s*\{\s*nliEngine=/);
assert.match(js,/\$\('gguf-select-home'\)\.addEventListener\('click',\(\)=>\$\('gguf-select'\)\.click\(\)\)/);
assert.match(js,/\$\('gguf-compare-model'\)\.addEventListener\('click',curate\)/);
assert.match(js,/if\(initial\.available&&initial\.selected&&!initial\.loaded&&!initial\.busy\)native\(\)\.loadModel\(\)/);
assert.doesNotMatch(js,/TelepatiaUI/);
console.log('QWEN3_INTERFACE_STATIC_OK: GGUF home/settings/search controls, no NLI bridge in GGUF build, no direct-mode hiding, autoload.');
