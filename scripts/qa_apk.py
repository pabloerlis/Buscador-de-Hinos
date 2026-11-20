#!/usr/bin/env python3
"""Agente pós-build: confere artefato real (conteúdo, proveniência e assinatura).

Os agentes de código, fontes, regressões e relevância devem ter passado
ANTES de existir um candidato a APK. Este agente é a última barreira.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APK = Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/"app/build/outputs/apk/debug/app-debug.apk"
errors = []


def check(test, reason):
    if not test:
        errors.append(reason)


check(APK.is_file(), "APK inexistente")
if not APK.is_file():
    raise SystemExit("\n".join(errors))
gradle = (ROOT/"app/build.gradle").read_text(encoding="utf-8")
version_name = re.search(r"\bversionName\s+'([^']+)'",gradle)[1]
version_code = re.search(r"\bversionCode\s+(\d+)",gradle)[1]
expected_sha = os.environ.get("BUILD_SOURCE_SHA", "").strip()
check(len(expected_sha)==40 and re.fullmatch(r"[0-9a-f]{40}",expected_sha),
      "SHA do commit de origem ausente ou inválido")

with zipfile.ZipFile(APK) as archive:
    corrupt = archive.testzip()
    check(corrupt is None, "Entrada ZIP corrompida: "+str(corrupt))
    files = set(archive.namelist())
    for required in ("assets/index.html","assets/app.js","assets/about.js",
                     "assets/offline-api.js","assets/story-engine.js",
                     "assets/scripture-pt.json","assets/bible-graph.json",
                     "assets/bible-narratives.json","AndroidManifest.xml"):
        check(required in files,"Asset essencial ausente: "+required)
    for name in files:
        lowered = name.lower()
        check(not (lowered.endswith((".gguf",".onnx",".tflite")) or
                   re.search(r"/lib(?:onnxruntime|hinosllm)[^/]*\.so$",lowered)),
              "Modelo de IA não autorizado no APK padrão: "+name)
        check(name not in ("assets/colecao.json","assets/data/data.json",
                           "assets/hinos-avaliacao.json"),
              "Catálogo de letras incorporado indevidamente: "+name)
    dex = b"".join(archive.read(name) for name in files if re.fullmatch(r"classes\d*\.dex",name))
    check(bool(dex),"APK sem classes Android DEX")
    check(b"Pablo Erlis" in dex,"Crédito do desenvolvedor ausente do código nativo")
    check(version_name.encode() in dex,"Versão exibida no Sobre não incorporada no DEX")
    if expected_sha:
        check(expected_sha.encode() in dex,"Commit da build não corresponde ao commit de origem")
    if "assets/scripture-pt.json" in files:
        bib=json.loads(archive.read("assets/scripture-pt.json"))
        check(bib.get("verse_count")==31102,"Bíblia do APK incompleta")
    if "assets/bible-graph.json" in files:
        graph=json.loads(archive.read("assets/bible-graph.json"))
        check(len(graph.get("narratives",[]))>=48,"Grafo bíblico do APK incompleto")

tools = Path(os.environ.get("ANDROID_HOME",""))/"build-tools"/"35.0.0"
aapt = tools/"aapt"
apksigner = tools/"apksigner"
check(aapt.is_file(),"aapt do Android SDK indisponível")
check(apksigner.is_file(),"apksigner do Android SDK indisponível")
if aapt.is_file():
    result = subprocess.run([str(aapt),"dump","badging",str(APK)],text=True,
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    check(result.returncode==0,"AndroidManifest inválido: "+result.stderr.strip())
    manifest=result.stdout
    check("name='br.com.buscadordehinos.app'" in manifest,"applicationId inesperado")
    check("versionCode='"+version_code+"'" in manifest,"versionCode incompatível")
    check("versionName='"+version_name+"'" in manifest,"versionName incompatível")
if apksigner.is_file():
    result=subprocess.run([str(apksigner),"verify","--verbose",str(APK)],
                          text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    check(result.returncode==0,"Assinatura Android inválida: "+result.stderr.strip())

sha=hashlib.sha256(APK.read_bytes()).hexdigest()
report={"apk":APK.name,"version_name":version_name,"version_code":int(version_code),
        "source_sha":expected_sha,"sha256":sha,"bytes":APK.stat().st_size,
        "signed":apksigner.is_file() and not any("Assinatura" in e for e in errors),
        "passed":not errors}
output=ROOT/"qa-report/apk-audit.json"
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
if errors:
    for reason in errors:
        print("AGENTE APK — FALHA:",reason)
    sys.exit(1)
print(f"AGENTE APK — APROVADO: {version_name} ({version_code}), "
      f"{APK.stat().st_size} bytes, SHA256 {sha}")
