#!/usr/bin/env python3
"""Agente independente de liberação do APK E5+Telepatia, SEM LFM3.

Inspeciona APK REAL, log instrumentado e modelo externo autenticado.
Não substitui teste físico ARM64. Reprova ausência de provas, não gera
"aprovação" sintética ou presume sucesso a partir de exit code.
"""
from __future__ import annotations
import hashlib, json, re, sys, zipfile
from pathlib import Path

APK=Path("app/build/outputs/apk/debug/app-debug.apk")
LOG=Path("qa-report/telepatia-android-device.log")
SHA=Path("qa-report/telepatia-apk.sha256")
PIN_GRAPH="f8f3c23687be7efdd137b5ea6557eef9235b218e6d86fe866fbe40191a1d55f7"
PIN_WEIGHTS="7dd89182a7a4f4100e98dc46f6ab4dd63699b9ab72219a1417d76578262d9e74"
PIN_TOKENIZER="609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f"


def require(test, message):
    if not test: raise RuntimeError(message)


def main():
    require(APK.is_file() and APK.stat().st_size>10_000_000,"APK ausente ou truncado")
    require(LOG.is_file() and LOG.stat().st_size>100,"Instrumentação Android real sem relatório")
    require(SHA.is_file(),"Checksum não gerado")
    expected=SHA.read_text().split()[0]
    with APK.open("rb") as stream:
        actual=hashlib.file_digest(stream,"sha256").hexdigest()
    require(expected==actual,"SHA256 do APK difere do build")

    with zipfile.ZipFile(APK) as apk:
        names=set(apk.namelist())
        js=[n for n in names if n.startswith("assets/") and n.endswith(".js")]
        forbidden=[n for n in names if any(t in n.lower()
             for t in (".gguf","hinosllm","libllama", "model.onnx.data","model.safetensors"))]
        require(not forbidden,"Pesos ou motor proibido dentro do APK: "+repr(forbidden[:10]))
        required=("assets/index.html","assets/app.js","assets/telepatia-nli-sequence.js",
                  "assets/telepatia-nli-client.js","assets/telepatia-tokenizers.mjs",
                  "assets/e5-model.onnx","assets/e5-index.json")
        require(all(n in names for n in required),"APK sem módulos necessários: "+
            str([n for n in required if n not in names]))
        html=apk.read("assets/index.html").decode("utf-8")
        require("nli-select" in html and "nli-status" in html and "tuner-narrative" in html,
                "A interface não contém seleção do Telepatia e controles contextuais")
        ui=apk.read("assets/telepatia-nli-client.js").decode("utf-8")
        require("NativeNLI" in ui and "TelepatiaSequence.sequence" in ui
                and "telepatia-tokenizers.mjs" in ui,
                "Aplicação não usa inferência real no Android")
        require(PIN_GRAPH in (Path("app/src/main/java/br/com/buscadordehinos/app/TelepatiaNliEngine.java")).read_text(),
                "Sem hash imutável do checkpoint Telepatia no loader")
        require(PIN_WEIGHTS in (Path("app/src/main/java/br/com/buscadordehinos/app/TelepatiaNliEngine.java")).read_text(),
                "Sem hash imutável dos pesos ONNX")
        require(PIN_TOKENIZER in (Path("app/src/main/java/br/com/buscadordehinos/app/TelepatiaNliEngine.java")).read_text(),
                "Sem hash imutável do tokenizador")

    data=LOG.read_text(encoding="utf-8",errors="replace")
    require(re.search(r"OK \(2 tests?\)",data),"Teste efetivo no emulador não aprovou ambos os métodos")
    require("INSTRUMENTATION_STATUS_CODE: 0" in data,"Instrumentation não confirmou sucesso")
    require("FAILURES!!!" not in data and "INSTRUMENTATION_STATUS_CODE: -2" not in data,
            "Instrumentação contém falha")
    packageinfo="app/build.gradle"
    gradle=Path(packageinfo).read_text()
    require("versionCode 54" in gradle and "versionName '2.6.35'" in gradle,
            "Versão Android da integração está divergente")
    report={"status":"approved_in_emulator_only","model":"telepatia-ai/laya-pt-es-nli",
            "apk_sha256":actual,"apk_bytes":APK.stat().st_size,"emulator":"x86_64",
            "version":"2.6.35","version_code":54,
            "weights_embedded":False,"legacy_gguf_present":False,
            "source":"GitHub Actions+real Android emulator",
            "limitations":[
                "Not tested on physical ARM64 smartphone.",
                "No performance or memory stability guarantees on target Android device.",
                "No human-reviewed 100-query accuracy evaluation yet.",
                "External FP32 model requires about 1.3 GB download and more RAM at runtime.",
            ]}
    out=Path("qa-report/telepatia-independent-review.json")
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print("INDEPENDENT_ANDROID_NLI_REVIEW_PASS",actual,flush=True)


if __name__=="__main__":
    try:main()
    except Exception as e:
        print("INDEPENDENT_ANDROID_NLI_REVIEW_FAIL:",str(e),file=sys.stderr)
        sys.exit(1)
