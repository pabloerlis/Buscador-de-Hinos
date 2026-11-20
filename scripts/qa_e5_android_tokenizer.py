#!/usr/bin/env python3
"""Compara tokens do modelo Hugging Face com o E5Tokenizer Java usado no Android.

Executa o código de produção (não uma reimplementação de teste) no JDK local
com stub mínimo do AssetManager. Um erro de tokenização impede compilar o APK.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import base64
import json
import subprocess

root = Path(__file__).resolve().parents[1]
gold = json.loads((root / "tests/e5-tokenizer-cases.json").read_text(encoding="utf-8"))
cases = gold.get("test_cases") or []
assert len(cases) >= 20, "Poucos casos reais de tokenização"
assert gold.get("tokenizer_type") == "Unigram", "Modelo tokenizer incorreto"
with TemporaryDirectory() as work:
    out = Path(work)
    golden = out / "golden.tsv"
    golden.write_text(
        "".join(base64.b64encode(case["text"].encode("utf-8")).decode() +
                "\t" + ",".join(map(str, case["ids"])) + "\n"
                for case in cases), encoding="utf-8")
    stub = root / "tests/java-stubs/android/content/res/AssetManager.java"
    code = root / "app/src/main/java/br/com/buscadordehinos/app/E5Tokenizer.java"
    test = root / "tests/java/br/com/buscadordehinos/app/E5TokenizerIntegration.java"
    subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(out),
                    str(stub), str(code), str(test)], check=True, timeout=60)
    subprocess.run(["java", "-Xmx512m", "-cp", str(out),
                    "br.com.buscadordehinos.app.E5TokenizerIntegration",
                    str(root / "app/src/main/assets"), str(golden)],
                   check=True, timeout=90)
print("AGENTE E5 — TOKENIZAÇÃO ANDROID APROVADA.")
