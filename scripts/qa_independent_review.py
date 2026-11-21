#!/usr/bin/env python3
"""Agente 8: testes independentes e análise quantitativa antes da entrega.

Sem IA externa, nem textos de hinos nos relatórios. Este job é obrigatório:
inspeciona o APK real, confronta o relatório de assinatura, reavalia as
métricas por alvo e exige evidência explícita do teste instrumentado Android.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "qa-report"
APK = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "apk-candidate/app-debug.apk"
ERRORS = []
WARNINGS = []


def check(value, message):
    if not value:
        ERRORS.append(message)


def load_json(filename):
    p = REPORT_DIR / filename
    check(p.is_file(), f"Relatório obrigatório ausente: {filename}")
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        ERRORS.append(f"Relatório inválido {filename}: {exc}")
        return {}


def finite_score(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        ERRORS.append(f"Não numérico: {label}")
        return 0.0
    if not math.isfinite(value) or not 0 <= value <= 1:
        ERRORS.append(f"Fora de [0,1]: {label}")
        return 0.0
    return float(value)


def metric_from_ranks(ranks, cutoff):
    good = [r for r in ranks if isinstance(r, int) and not isinstance(r, bool) and r > 0 and r <= cutoff]
    return len(good) / len(ranks) if ranks else 0


def ndcg_for_one(rank):
    if isinstance(rank, int) and not isinstance(rank, bool) and 0 < rank <= 5:
        return 1 / math.log2(rank + 1)
    return 0.0


def audit_metrics():
    source = load_json("metrics.json")
    baseline_path = ROOT / "qa/metrics-baseline.json"
    limits = json.loads(baseline_path.read_text(encoding="utf-8"))
    check(source.get("schema_version") == 1, "Schema inesperado das métricas de relevância")
    check(source.get("catalog_size", 0) >= 1500, "Métricas não cobrem a coletânea real")
    final = {}
    for suite in ("narrative", "biblical"):
        group = source.get("suites", {}).get(suite, {})
        rows = group.get("cases", [])
        check(len(rows) >= 5, f"Conjunto de relevância {suite} insuficiente")
        scores = {}
        for key, attr in (("macro_recall_at_10", "recall_at_10"),
                          ("macro_recall_at_20", "recall_at_20"),
                          ("macro_ndcg_at_5", "ndcg_at_5")):
            declared = finite_score(group.get("metrics", {}).get(key), f"{suite}/{key}")
            calculated = sum(finite_score(row.get(attr), f"{suite}/{attr}/caso") for row in rows) / len(rows) if rows else 0
            check(abs(calculated-declared) < 1e-7,
                  f"Métrica {suite}/{key} inconsistente com os casos individuais")
            limit = limits.get(suite, {}).get("min_" + key)
            check(limit is not None and declared + 1e-9 >= limit,
                  f"Regressão ou ausência do limite original: {suite}/{key}")
            scores[key] = round(declared, 6)
        final[suite] = {"cases": len(rows), "metrics": scores}
    return final


def audit_hybrid():
    source = load_json("e5-hybrid.json")
    check(source.get("schema_version") == 2, "Schema híbrido inesperado")
    rows = source.get("cases", [])
    check(len(rows) >= 7, "Amostra E5 inferior ao mínimo previamente aprovado")
    positions = (("baseline", "without_e5"), ("additive", "with_legacy_e5"), ("rrf", "with_e5"))
    computed = {}
    regressions = []
    for name, key in positions:
        scores = [row.get(key) for row in rows]
        for i, rank in enumerate(scores):
            check(rank is None or (isinstance(rank, int) and not isinstance(rank, bool) and rank > 0),
                  f"Posição inválida em {name}, consulta {i}")
        recall = metric_from_ranks(scores, 20)
        ndcg = sum(ndcg_for_one(rank) for rank in scores) / len(scores) if scores else 0
        declared = source.get(name, {})
        check(abs(recall - finite_score(declared.get("recall_at_20"), f"{name}/Recall@20")) < 1e-7,
              f"Recall@20 de {name} diverge das posições armazenadas")
        check(abs(ndcg - finite_score(declared.get("ndcg_at_5"), f"{name}/nDCG@5")) < 1e-7,
              f"nDCG@5 de {name} diverge das posições armazenadas")
        computed[name] = {"recall_at_20": round(recall, 6), "ndcg_at_5": round(ndcg, 6)}
    check(computed["rrf"]["recall_at_20"] + 1e-7 >=
          computed["additive"]["recall_at_20"] - 1 / max(1, len(rows)),
          "RRF perdeu mais que um alvo no top20 comparado ao E5 legado")
    check(computed["rrf"]["ndcg_at_5"] + 0.025 + 1e-7 >= computed["additive"]["ndcg_at_5"],
          "Regressão excessiva nDCG@5 versus E5 aditivo")
    check(computed["rrf"]["recall_at_20"] + 1e-7 >=
          computed["baseline"]["recall_at_20"] - 1 / max(1, len(rows)),
          "RRF perdeu mais que um alvo no top20 comparado ao modo sem E5")
    for row in rows:
        before, after = row.get("with_legacy_e5"), row.get("with_e5")
        if (before is not None and (after is None or after > before)):
            regressions.append({
                "query": row.get("query"),
                "target": row.get("target"),
                "rank_previous": before,
                "rank_current": after,
            })
    if regressions:
        WARNINGS.append(f"{len(regressions)} alvos pioraram de posição no RRF; ver casos no relatório")
    return {"cases": len(rows), "variants": computed, "worsened_cases": regressions,
            "limitation": "Amostra exploratória rotulada; não comprova desempenho global."}


def audit_apk_and_device():
    audit = load_json("apk-audit.json")
    log_file = REPORT_DIR / "android-device-evidence.log"
    check(log_file.is_file(), "Evidência da instrumentação Android ausente")
    if log_file.is_file():
        log = log_file.read_text(encoding="utf-8", errors="replace")
        check(re.search(r"OK \([1-9][0-9]* tests?\)", log) is not None,
              "Emulador não declarou nenhum teste aprovado")
        check("INSTRUMENTATION_STATUS_CODE: 0" in log,
              "Emulador não declarou código de instrumentação 0")
        check(not any(x in log for x in ("FAILURES!!!", "INSTRUMENTATION_STATUS_CODE: -2",
                                        "Error in webViewLoads")), "Emulador reportou falha")
    check(APK.is_file(), "APK candidato ausente")
    if not APK.is_file():
        return {}
    data = APK.read_bytes()
    actual_hash = hashlib.sha256(data).hexdigest()
    check(audit.get("passed") is True, "Auditoria do APK não aprovada")
    check(audit.get("signed") is True, "Assinatura do APK não validada")
    check(audit.get("sha256") == actual_hash, "SHA256 do APK diverge da auditoria")
    check(audit.get("bytes") == len(data), "Tamanho do APK diverge da auditoria")
    check(audit.get("local_e5_embedded") is True, "Modelo E5 ausente no APK esperado")
    expected_sha = os.environ.get("BUILD_SOURCE_SHA", "").strip()
    check(bool(expected_sha) and audit.get("source_sha") == expected_sha,
          "Commit da build ausente ou inconsistente")
    gradle = (ROOT / "app/build.gradle").read_text(encoding="utf-8")
    version = re.search(r"\bversionName\s+'([^']+)'", gradle)
    code = re.search(r"\bversionCode\s+(\d+)", gradle)
    check(bool(version) and audit.get("version_name") == version.group(1),
          "VersionName do APK incorreto")
    check(bool(code) and audit.get("version_code") == int(code.group(1)),
          "VersionCode do APK incorreto")
    with zipfile.ZipFile(APK) as archive:
        names = set(archive.namelist())
        for name in ("event-alignment.js", "story-engine.js", "rrf-fusion.js", "offline-api.js"):
            bundled = "assets/" + name
            check(bundled in names, "Motor obrigatório ausente no APK: " + bundled)
            if bundled in names:
                source = (ROOT / "app/src/main/assets" / name).read_bytes()
                check(hashlib.sha256(source).digest() == hashlib.sha256(archive.read(bundled)).digest(),
                      "Script no APK difere do código testado: " + name)
        check("assets/e5-model.onnx" in names, "Modelo ONNX não incorporado")
        check(not any(n.startswith(("assets/data/", "assets/colecao")) for n in names),
              "Arquivo de coletânea empacotado indevidamente")
    return {"version": audit.get("version_name"), "version_code": audit.get("version_code"),
            "commit": audit.get("source_sha"), "sha256": actual_hash,
            "bytes": len(data), "android_instrumentation": "approved"}


def main():
    rank = audit_metrics()
    hybrid = audit_hybrid()
    package = audit_apk_and_device()
    review = {"schema_version": 1, "agent": "8-independent-qa-review",
              "decision": "approved" if not ERRORS else "rejected",
              "apk": package, "ranking_suites": rank,
              "e5_hybrid": hybrid, "warnings": WARNINGS, "errors": ERRORS,
              "checked": ["regression_metrics_recomputed", "e5_case_ranks_recomputed",
                          "negative_event_and_rrf_tests", "android_instrumentation_evidence",
                          "signed_apk_report_crosschecked", "packaged_scripts_equal_tested_sources"]}
    REPORT_DIR.mkdir(exist_ok=True)
    output = REPORT_DIR / "independent-review.json"
    output.write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("AGENTE 8 —", review["decision"].upper(),
          f"; métricas conferidas, casos que pioraram={len(hybrid.get('worsened_cases', []))}")
    for error in ERRORS:
        print("REPROVADO:", error, file=sys.stderr)
    for warning in WARNINGS:
        print("ATENÇÃO:", warning)
    if ERRORS:
        sys.exit(1)


if __name__ == "__main__":
    main()
