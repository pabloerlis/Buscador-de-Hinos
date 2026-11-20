'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '../app/src/main');
const html = fs.readFileSync(path.join(base, 'assets/index.html'), 'utf8');
const ui = fs.readFileSync(path.join(base, 'assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(base, 'assets/style.css'), 'utf8');
const java = fs.readFileSync(path.join(base, 'java/br/com/buscadordehinos/app/MainActivity.java'), 'utf8');
const gradle = fs.readFileSync(path.join(__dirname, '../app/build.gradle'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/android-apk.yml'), 'utf8');
assert.match(html, /<details[^>]+id="about-app"/);
assert.match(html, /<summary>Sobre<\/summary>/);
assert.match(html, /<script src="about\.js" defer><\/script>/);
assert.match(ui, /BuildAbout\.render\(\)/);
assert.match(css, /\.about-app \.status-grid/);
assert.match(java, /@JavascriptInterface public String buildInfo\(\)/);
for(const field of ['VERSION_NAME','VERSION_CODE','BUILD_TYPE','SOURCE_REVISION','BUILD_DATE_UTC']){
  assert.ok(java.includes('BuildConfig.' + field), 'Ausente no bridge: ' + field);
}
for(const field of ['SOURCE_REVISION','BUILD_DATE_UTC']){
  assert.ok(gradle.includes("'"+field+"'"), 'Ausente na build: ' + field);
}
assert.match(gradle, /versionName '2\.6\.0'/);
assert.match(gradle, /versionCode 19/);
assert.match(workflow, /BUILD_SOURCE_SHA:/);
const context = vm.createContext({console, Date});
vm.runInContext(fs.readFileSync(path.join(base,'assets/about.js'),'utf8'),context);
const about = vm.runInContext('BuildAbout',context);
const ids = ['about-developer','about-version','about-code','about-type','about-commit','about-date'];
const elements = Object.fromEntries(ids.map(id=>[id,{textContent:''}]));
const doc = {getElementById:id=>elements[id]};
const fullSha = 'a'.repeat(40);
const installed = about.render(doc,{buildInfo:()=>JSON.stringify({
  developer:'Pablo Erlis',versionName:'2.6.0',versionCode:19,buildType:'debug',
  sourceRevision:fullSha,buildDateUtc:'2026-11-20T20:30:00Z'
})});
assert.equal(installed.versionCode,19);
assert.equal(elements['about-developer'].textContent,'Pablo Erlis');
assert.equal(elements['about-version'].textContent,'2.6.0');
assert.equal(elements['about-code'].textContent,'19');
assert.equal(elements['about-type'].textContent,'debug');
assert.equal(elements['about-commit'].textContent,'a'.repeat(12));
assert.match(elements['about-date'].textContent,/UTC$/);
assert.ok(!elements['about-date'].textContent.includes('Indisponível'));
assert.equal(about.render(doc, {buildInfo:()=>'{bad json'}),null);
assert.match(elements['about-version'].textContent,/Indisponível/);
assert.equal(about.render(doc,null),null);
assert.equal(elements['about-developer'].textContent,'Pablo Erlis');
assert.equal(about.render(doc,{buildInfo:()=>JSON.stringify({versionName:'unknown',versionCode:'abc'})}),null);
console.log('Sobre: versão/código, build, commit, data UTC, desenvolvedor e fallback aprovados.');
