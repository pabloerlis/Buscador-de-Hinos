#!/usr/bin/env python3
"""Agente estático: valida invariantes da interface, build e empacotamento offline.

Executado ANTES do Gradle. Apenas stdlib, sem rede e sem IA generativa.
"""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
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
require("rrf-fusion.js" in page.js, "Motor RRF não carregado na interface")
require("event-frame-engine.js" in page.js, "Motor de acontecimentos não carregado")
require("event-toggle" in page.ids, "Controle de interpretação de acontecimentos ausente")
require("tests/qa_event_ranking.js" in (ROOT / ".github/workflows/android-apk.yml").read_text(encoding="utf-8"),
        "Falta benchmark comparativo com/sem ações bíblicas")
require("tests/qa_event_variant_matrix.js" in (ROOT / ".github/workflows/android-apk.yml").read_text(encoding="utf-8"),
        "Falta matriz reproduzível de variantes narrativa A/B antes do APK")
require("event-variant-matrix.json" in (ROOT / ".github/workflows/android-apk.yml").read_text(encoding="utf-8"),
        "Relatório de comparação A/B não é preservado no CI")
require("fusion-mode" in page.ids, "Opção de comparação RRF/legado ausente")
offline_api = (ASSETS / "offline-api.js").read_text(encoding="utf-8")
require("FusionRRF.rank" in offline_api and "fusionMode" in offline_api,
        "RRF não está integrado ao fluxo de pesquisa")
require("about-app" in page.ids, "Configurações sem seção Sobre")
for element in ("about-developer", "about-version", "about-code", "about-commit", "about-date"):
    require(element in page.ids, "Campo Sobre ausente: " + element)

gradle = (ROOT / "app/build.gradle").read_text(encoding="utf-8")
activity = (ROOT / "app/src/main/java/br/com/buscadordehinos/app/MainActivity.java").read_text(encoding="utf-8")
about = (ASSETS / "about.js").read_text(encoding="utf-8")
for field in ("SOURCE_REVISION", "BUILD_DATE_UTC"):
    require("buildConfigField 'String', '" + field + "'" in gradle, "Campo build ausente: " + field)
for field in ("VERSION_NAME", "VERSION_CODE", "SOURCE_REVISION", "BUILD_DATE_UTC"):
    require("BuildConfig." + field in activity, "Bridge sem metadado: " + field)
require("public String buildInfo()" in activity, "Ponte Android/Sobre ausente")
require("Pablo Erlis" in activity and "Pablo Erlis" in about, "Crédito do desenvolvedor ausente")
source_revision = "da8e75932982123301affce688e45b4152c9e06e"
for file in (ASSETS / "offline-api.js", ROOT / "scripts/build_e5_assets.py",
             ROOT / "app/src/main/java/br/com/buscadordehinos/app/MainActivity.java"):
    require(source_revision in file.read_text(encoding="utf-8"),
            "Origem de hinos não corresponde à revisão vetorial pinada: " + str(file))
require(re.search(r"\bversionCode\s+\d+\b", gradle), "versionCode inválido")
require(re.search(r"\bversionName\s+'[\d.]+(?:-[a-z0-9.]+)?'", gradle), "versionName inválido")

workflow = (ROOT / ".github/workflows/android-apk.yml").read_text(encoding="utf-8")
for gate in ("sources", "static", "regressions", "relevance", "embeddings", "semantic_search_qa", "semantic_crossversion_qa", "build_apk", "device_smoke", "audit_apk", "independent_review", "publish_apk"):
    require(re.search(r"^  " + gate + r":", workflow, re.M), "Agente ou etapa obrigatória ausente: " + gate)
require("needs: [sources, static, regressions, relevance, embeddings, semantic_search_qa, semantic_crossversion_qa, full_lyrics_qa]" in workflow,
        "Compilação não depende de todos os agentes de pré-build")
require("needs: [build_apk, device_smoke]" in workflow,
        "APK deve depender dos testes instrumentados Android antes da auditoria")

require(re.search(r"^  independent_review:", workflow, re.M),
        "Agente 8 de teste e análise independente não está no workflow")
require(re.search(r"^  publish_apk:", workflow, re.M),
        "Job de entrega condicionada não está no workflow")
require("needs: [audit_apk, device_smoke, relevance, embeddings, semantic_search_qa, semantic_crossversion_qa]" in workflow,
        "Agente 8 deve esperar relatórios de relevância, E5, Android e auditoria")
require("needs: [audit_apk, independent_review]" in workflow,
        "O APK final deve depender da aprovação do agente 8")
require("scripts/qa_independent_review.py" in workflow,
        "Não há script do agente 8 para testar e analisar o APK")
require("android-device-evidence-qa" in workflow and "independent-review-qa" in workflow,
        "Evidência do Android e relatório do agente 8 devem ser preservados")
require(workflow.index("  independent_review:") < workflow.index("  publish_apk:"),
        "A análise independente deve preceder a publicação")

require("scripts/qa_android_emulator.sh" in workflow,
        "Workflow sem executor de teste Android nativo")
runner_script = (ROOT / "scripts/qa_android_emulator.sh").read_text(encoding="utf-8")
require("E5DeviceSmokeTest" in runner_script and "FAILURES!!!" in runner_script and
        "INSTRUMENTATION_STATUS_CODE: 0" in runner_script,
        "Testes Android não verificam explicitamente o resultado da instrumentação")
require("node tests/qa-metrics.js" in workflow, "Avaliação quantitativa não está no CI")
require("tests/qa_relevance_50.js" in workflow and "qa-report/relevance-50.json" in workflow,
        "Matriz de 50 consultas deve executar no pré-build e ser preservada")
require("scripts/qa_independent_review.py" in workflow,
        "Agente 8 de revisão independente obrigatório")
require("scripts/qa_e5.py" in workflow, "Agente de embeddings E5 ausente")
golden=ROOT/"qa/e5-index-golden.json"
reference=json.loads((ROOT/"qa/e5-stability-reference.json").read_text(encoding="utf-8"))
require(reference.get("status")=="locked" and golden.is_file(),
        "Índice E5 de referência não foi fixado no repositório")
if golden.is_file():
    require(hashlib.sha256(golden.read_bytes()).hexdigest() ==
            reference.get("fingerprint",{}).get("index_sha256"),
            "Índice E5 do pacote não corresponde ao SHA congelado")
require("scripts/qa_e5_stability.py" in workflow and "qa-report/e5-stability.json" in workflow and
        "tests/qa_e5_crossbuild_agent.js" in workflow,
        "Agentes 5/9 sem prova cross-build do E5")
require("actions/cache/restore@v4" not in workflow,
        "Índice E5 pode ser reaproveitado sem provar estabilidade entre compilações")
require("tests/qa_semantic_search_agent.js" in workflow and "semantic-search-agent-qa" in workflow,
        "Agente 9 sem testes reais ou sem relatório")
require(workflow.index("  semantic_search_qa:") < workflow.index("  semantic_crossversion_qa:") < workflow.index("  build_apk:"),
        "Testes semânticos devem bloquear a compilação")
require("scripts/qa_paraphrase_e5.py" in workflow and "qa-report/e5-paraphrase-vectors.json" in workflow,
        "Paráfrases sem inferência E5 real ou evidência no artefato")
require((ROOT/"qa/semantic-paraphrase-queries.json").is_file(),
        "Lista auditável de consultas de paráfrase ausente")
require("tests/qa_semantic_crossversion_agent.js" in workflow and
        "tests/test-semantic-crossversion-gate.js" in workflow and
        "semantic-crossversion-agent-qa" in workflow,
        "Agente 10 sem teste negativo, parecer ou gate")
cross_baseline = json.loads((ROOT / "qa/semantic-crossversion-baseline.json").read_text(encoding="utf-8"))
require(cross_baseline.get("status")=="locked" and len(cross_baseline.get("rows",[]))==12,
        "Baseline cross-version ausente ou nao travada")
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
