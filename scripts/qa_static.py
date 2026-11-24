#!/usr/bin/env python3
"""Agente estático: valida invariantes da interface, build e empacotamento offline.

Executado ANTES do Gradle. Apenas stdlib, sem rede e sem IA generativa.
"""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
ERRORS = []


def require(condition, message):
    if not condition:
        ERRORS.append(message)


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.js = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            element_id = values["id"]
            require(element_id not in self.ids, "ID HTML duplicado: " + element_id)
            self.ids.add(element_id)
        if tag == "script" and values.get("src"):
            self.js.append(values["src"])


html = (ASSETS / "index.html").read_text(encoding="utf-8")
page = Page()
page.feed(html)
require(bool(page.ids), "index.html não contém elementos identificados")
for src in page.js:
    require(not src.startswith(("http:", "https:", "//")), "Script remoto na interface offline: " + src)
    require((ASSETS / src).is_file(), "Script HTML ausente: " + src)
require("about.js" in page.js, "Tela Sobre sem script de metadados")
require("about-app" in page.ids, "Configurações sem seção Sobre")
for element in ("about-developer", "about-version", "about-code", "about-commit", "about-date"):
    require(element in page.ids, "Campo Sobre ausente: " + element)

for element in ("term-filters-panel", "term-filter-template", "term-filter-rows", "term-filter-add", "view-synonyms"):
    require(element in page.ids, "Filtro de palavras ausente: " + element)
for field in ("kind", "term", "synonyms", "field", "lexical"):
    require('data-field="' + field + '"' in html, "Controle ausente: " + field)
require("lexical-pt.js" in page.js, "Motor lexical ausente da interface")
require('href="polished-ui.css"' in html and (ASSETS/"polished-ui.css").is_file(), "Camada visual ausente")
require('.live-filters:not([open]){display:block}' in (ASSETS / "style.css").read_text(), "Acesso direto aos filtros ausente")

gradle = (ROOT / "app/build.gradle").read_text(encoding="utf-8")
activity = (ROOT / "app/src/main/java/br/com/buscadordehinos/app/MainActivity.java").read_text(encoding="utf-8")
about = (ASSETS / "about.js").read_text(encoding="utf-8")
for field in ("SOURCE_REVISION", "BUILD_DATE_UTC"):
    require("buildConfigField 'String', '" + field + "'" in gradle, "Campo build ausente: " + field)
for field in ("VERSION_NAME", "VERSION_CODE", "SOURCE_REVISION", "BUILD_DATE_UTC"):
    require("BuildConfig." + field in activity, "Bridge sem metadado: " + field)
require("public String buildInfo()" in activity, "Ponte Android/Sobre ausente")
require("Pablo Erlis" in activity and "Pablo Erlis" in about, "Crédito do desenvolvedor ausente")
require(re.search(r"\bversionCode\s+\d+\b", gradle), "versionCode inválido")
require(re.search(r"\bversionName\s+'[\d.]+(?:-[a-z0-9.]+)?'", gradle), "versionName inválido")

workflow = (ROOT / ".github/workflows/android-apk.yml").read_text(encoding="utf-8")
for gate in ("sources", "static", "regressions", "relevance", "build_apk", "audit_apk"):
    require(re.search(r"^  " + gate + r":", workflow, re.M), "Agente ou etapa obrigatória ausente: " + gate)
require("needs: [sources, static, regressions, relevance]" in workflow,
        "Compilação não depende de todos os agentes de pré-build")
require("needs: build_apk" in workflow, "APK sem auditoria pós-build")
require("node tests/qa-metrics.js" in workflow, "Avaliação quantitativa não está no CI")
require("continue-on-error: true" not in workflow, "Um dos agentes ignora falhas")
require("retention-days: 1" in workflow, "Artefatos intermediários sem prazo curto")

for forbidden in ("data/data.json", "colecao.json", "e5-model.onnx", "e5-vocab.bin"):
    require(not (ASSETS / forbidden).is_file(), "Arquivo proibido no APK padrão: " + forbidden)
if ERRORS:
    print("AGENTE ESTÁTICO — REPROVADO")
    for error in ERRORS:
        print("  -", error)
    sys.exit(1)
print(f"AGENTE ESTÁTICO — APROVADO ({len(page.ids)} IDs HTML, {len(page.js)} scripts locais).")
