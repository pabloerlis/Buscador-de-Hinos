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


def audit_events():
    """Recalcula relatório A/B sobre os mesmos 14 casos/19 alvos."""
    matrix = load_json("event-variant-matrix.json")
    ranked = load_json("event-ranking.json")
    check(matrix.get("schema_version") == 1 and ranked.get("schema_version") == 1,
          "Relatório de eventos A/B com esquema inválido")
    check(matrix.get("catalog_count", 0) >= 1500 and matrix.get("cases", 0) >= 14,
          "Matriz A/B não cobre as consultas reais exigidas")
    check(ranked.get("positives", 0) >= 19 and ranked.get("cases", 0) >= 14,
          "Benchmark de eventos insuficiente")
    variants = {v.get("name"): v for v in matrix.get("variants", [])}
    required = ("rrf_2_6_3", "frames_2_6_4_off", "frames_2_6_4_on", "alignment_2_6_4_b")
    check(all(name in variants for name in required), "Matriz de variantes incompleta")
    metrics = {}
    for name in required:
        variant = variants.get(name, {})
        rows = variant.get("rows", [])
        check(len(rows) >= 14, "Matriz A/B incompleta: " + name)
        ranks = [hit.get("rank") for row in rows for hit in row.get("positives", [])]
        for idx, rank in enumerate(ranks):
            check(rank is None or (isinstance(rank, int) and not isinstance(rank, bool) and rank > 0),
                  f"Posição A/B inválida: {name}, alvo {idx}")
        size = len(ranks)
        check(size >= 19, "Matriz A/B tem menos de 19 alvos: " + name)
        observed = {
            "targets": size,
            "recall_at_10": metric_from_ranks(ranks, 10),
            "recall_at_20": metric_from_ranks(ranks, 20),
            "ndcg_at_5": sum(ndcg_for_one(rank) for rank in ranks) / size if size else 0
        }
        for key in ("recall_at_10", "recall_at_20", "ndcg_at_5"):
            reported = finite_score(variant.get("metrics", {}).get(key), f"{name}/{key}")
            check(abs(reported - observed[key]) <= 1e-7,
                  "Métrica A/B não corresponde aos casos: " + name + "/" + key)
            check(abs(reported - finite_score(
                matrix.get("summary", {}).get(name, {}).get(key), f"resumo {name}/{key}")) <= 1e-7,
                  "Resumo A/B inconsistente com as posições: " + name + "/" + key)
        check(variant.get("metrics", {}).get("targets") == size,
              "Alvos divergentes em " + name)
        reported_fp = variant.get("false_positive_top10", [])
        actual_fp = [hit for row in rows for hit in row.get("negatives", [])
                     if isinstance(hit.get("rank"), int) and 0 < hit["rank"] <= 10]
        check(len(reported_fp) == len(actual_fp),
              "Falsos positivos declarados não correspondem aos casos: " + name)
        metrics[name] = observed
    baseline = variants.get("rrf_2_6_3", {}).get("rows", [])
    disabled = variants.get("frames_2_6_4_off", {}).get("rows", [])
    check([row.get("positives") for row in baseline] ==
          [row.get("positives") for row in disabled],
          "Modo de eventos desligado não reproduz a versão RRF")
    base, selected = metrics.get("rrf_2_6_3", {}), metrics.get("frames_2_6_4_on", {})
    other = metrics.get("alignment_2_6_4_b", {})
    check(selected.get("recall_at_10", 0) + 1e-9 >= base.get("recall_at_10", 1),
          "Eventos perderam resultados no top10")
    check(selected.get("ndcg_at_5", 0) + .04 + 1e-9 >= base.get("ndcg_at_5", 1),
          "Regressão nDCG@5 versus base RRF")
    check(selected.get("ndcg_at_5", 0) + 1e-9 >= other.get("ndcg_at_5", 1),
          "Variante B supera a versão selecionada A")
    check(len(variants.get("frames_2_6_4_on", {}).get("false_positive_top10", [])) <=
          len(variants.get("rrf_2_6_3", {}).get("false_positive_top10", [])),
          "Falsos positivos no top10 aumentaram")
    # Conferir os números independentes do relatório de eventos A com a matriz completa.
    for key, variant_name in (("baseline", "rrf_2_6_3"),
                              ("current", "frames_2_6_4_on")):
        for metric_name in ("recall_at_10", "recall_at_20", "ndcg_at_5"):
            check(abs(finite_score(ranked.get(key, {}).get(metric_name),
                                   "event-ranking/" + key + "/" + metric_name) -
                      metrics.get(variant_name, {}).get(metric_name, 0)) < 1e-7,
                  "Relatórios de eventos não são reproduzíveis: " + key + "/" + metric_name)
    return {"cases": matrix.get("cases"), "targets": selected.get("targets"),
            "variants": {k: {f: round(float(v[f]), 6) for f in
                       ("recall_at_10", "recall_at_20", "ndcg_at_5")} for k,v in metrics.items()},
            "limitation": "14 buscas e 19 alvos rotulados, insuficientes para medir generalização."}


def audit_expanded():
    """Confere novamente as 50 posições e categorias sem confiar nos totais JS."""
    source = load_json("relevance-50.json")
    check(source.get("schema_version") == 2, "Schema inválido da avaliação 50")
    coverage = source.get("e5_coverage", {})
    check(coverage.get("semantic_paraphrase_queries") == 12 and
          coverage.get("semantic_paraphrase_vectors") == 12 and
          coverage.get("semantic_legacy_vectors") == 7 and
          coverage.get("source_kind") == "actual_e5_onnx_inference" and
          coverage.get("model_sha256") == "ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1",
          "Paráfrases foram avaliadas sem inferência E5 real integral")
    vectors=load_json("e5-paraphrase-vectors.json")
    check(vectors.get("schema_version") == 1 and
          vectors.get("source_kind") == "actual_e5_onnx_inference" and
          vectors.get("human_review_status") == "pending" and
          vectors.get("model_sha256") == coverage.get("model_sha256") and
          len(vectors.get("queries", [])) == 12,
          "Artefato E5 das 12 paráfrases ausente ou incompatível")
    for row in vectors.get("queries", []):
        values=row.get("vector", [])
        check(len(values) == 384 and all(isinstance(v,(int,float)) and
              math.isfinite(v) for v in values) and
              .97 < math.sqrt(sum(v*v for v in values)) < 1.03,
              "Vetor de paráfrase com dimensão/norma inválida")

    check(source.get("case_count") == 50, "Avaliação ampliada não contém 50 consultas")
    check(source.get("catalog_count", 0) >= 1500, "Avaliação ampliada não importou o catálogo real")
    expected_counts = {"semantic_legacy": 14, "semantic_paraphrase": 12,
                       "exact_title": 16, "exact_number": 8}
    check(source.get("category_counts") == expected_counts,
          "Grupos de avaliação de 50 consultas divergentes")
    check(source.get("human_review_status") == "pending",
          "Paráfrases não podem ser declaradas revisadas automaticamente")
    collected = {}
    for name in ("baseline", "current"):
        variant = source.get(name, {})
        rows = variant.get("rows", [])
        check(len(rows) == 50, "Relatório de " + name + " sem 50 casos")
        check(len({row.get("query") for row in rows}) >= 47,
              "Consultas insuficientemente diversas: " + name)
        paraphrase_rows = [r for r in rows if r.get("category") == "semantic_paraphrase"]
        check(len(paraphrase_rows) == 12 and all(r.get("e5_used") is True for r in paraphrase_rows),
              "Alguma paráfrase não recebeu E5 real em " + name)
        check([r.get("query") for r in paraphrase_rows] ==
              [x.get("query") for x in vectors.get("queries", [])],
              "Paráfrases comparadas não são os vetores gerados em " + name)
        grades = [hit.get("rank") for row in rows for hit in row.get("positives", [])]
        for rank in grades:
            check(rank is None or (isinstance(rank, int) and not isinstance(rank, bool) and rank > 0),
                  "Posição de avaliação 50 inválida: " + name)
        rr10 = metric_from_ranks(grades, 10)
        rr20 = metric_from_ranks(grades, 20)
        ndcg = sum(ndcg_for_one(rank) for rank in grades) / len(grades) if grades else 0
        expected = variant.get("metrics", {})
        for key, calc in (("recall_at_10", rr10), ("recall_at_20", rr20), ("ndcg_at_5", ndcg)):
            check(abs(finite_score(expected.get(key), name+"/"+key)-calc) < 1e-7,
                  "Métrica ampliada adulterada: " + name + "/" + key)
        check(expected.get("queries") == 50 and expected.get("targets") == len(grades),
              "Contagens ampliadas inválidas: " + name)
        bycategory = {}
        for category, count in expected_counts.items():
            subset = [r for r in rows if r.get("category") == category]
            check(len(subset) == count, "Grupo de 50 casos inválido: " + category)
            cat_ranks = [hit.get("rank") for row in subset for hit in row.get("positives", [])]
            wanted = variant.get("categories", {}).get(category, {})
            check(wanted.get("queries") == count and wanted.get("targets") == len(cat_ranks),
                  "Grupo de categorias não confere: " + category)
            for key, observed in (("recall_at_10", metric_from_ranks(cat_ranks, 10)),
                                  ("recall_at_20", metric_from_ranks(cat_ranks, 20)),
                                  ("ndcg_at_5", sum(ndcg_for_one(x) for x in cat_ranks) / len(cat_ranks))):
                check(abs(finite_score(wanted.get(key), category+"/"+key)-observed) < 1e-7,
                      "Métrica de categoria inválida: " + category + "/" + key)
            bycategory[category] = {"queries": count, "recall_at_10": round(metric_from_ranks(cat_ranks, 10), 6)}
        collected[name] = {"recall_at_10": round(rr10, 6), "recall_at_20": round(rr20, 6),
                           "ndcg_at_5": round(ndcg, 6), "categories": bycategory}
    before, after = source.get("baseline", {}).get("rows", []), source.get("current", {}).get("rows", [])
    if len(before) == len(after) == 50:
        for a, b in zip(before, after):
            check(a.get("query") == b.get("query") and a.get("category") == b.get("category")
                  and [(h.get("collection"), h.get("number"), h.get("title")) for h in a.get("positives", [])] ==
                  [(h.get("collection"), h.get("number"), h.get("title")) for h in b.get("positives", [])],
                  "Alvos diferentes entre as versões comparadas")
    legacy = load_json("event-variant-matrix.json")
    maps = {x.get("name"): x for x in legacy.get("variants", [])}
    for key, label in (("baseline", "rrf_2_6_3"), ("current", "frames_2_6_4_on")):
        expanded_rows = source.get(key, {}).get("rows", [])[:14]
        original_rows = maps.get(label, {}).get("rows", [])
        if len(expanded_rows) == 14 and len(original_rows) == 14:
            for a, b in zip(expanded_rows, original_rows):
                check(a.get("query") == b.get("query") and
                      [p.get("rank") for p in a.get("positives", [])] ==
                      [p.get("rank") for p in b.get("positives", [])],
                      "Matriz antiga não reproduzida em 50 casos: " + label)
        else:
            check(False, "Casos legados ausentes em 50: " + label)
    if collected.get("current", {}).get("categories", {}).get("exact_title", {}).get("recall_at_10", 0) < .90:
        WARNINGS.append("Controle de título abaixo de 90% no top10")
    if collected.get("current", {}).get("categories", {}).get("exact_number", {}).get("recall_at_10", 0) < .90:
        WARNINGS.append("Controle de número abaixo de 90% no top10")
    return {"queries": 50, "group_metrics": collected,
            "review_status": "pending_human_semantic_review",
            "note": "26 consultas narrativas/bíblicas (12 novas paráfrases com E5 real) e 24 controles exatos; sem alegar 50 juízos humanos independentes"}

def audit_semantic_search_agent():
    """Recalcula independentemente as métricas de 12 pesquisas do Agente 9."""
    data=load_json("semantic-search-agent.json")
    ref=load_json("relevance-50.json")
    check(data.get("schema_version")==1 and data.get("agent")=="9-independent-semantic-search" and
          data.get("status")=="approved" and data.get("review_status")=="pending",
          "Agente 9 não aprovou testes da busca semântica")
    stability=load_json("e5-stability.json")
    check(stability.get("schema_version")==1 and stability.get("status")=="approved" and
          stability.get("baseline_matched") is True and
          stability.get("same_session_equal") is True and
          stability.get("fresh_session_equal") is True and
          stability.get("recomputed_index_passages_equal",0)>=64,
          "Estabilidade E5 entre builds não comprovada pelos agentes 5/9")
    check(data.get("catalog_sha256")==ref.get("catalog_sha256") and
          data.get("model_sha256")==ref.get("e5_coverage",{}).get("model_sha256"),
          "Agente 9 usou catálogo ou modelo diferente")
    rows=data.get("rows",[])
    expected=[r for r in ref.get("current",{}).get("rows",[])
              if r.get("category")=="semantic_paraphrase"]
    check(len(rows)==12 and len(expected)==12 and data.get("cases")==12,
          "Agente 9 não testou as 12 paráfrases")
    for idx,(r,e) in enumerate(zip(rows,expected)):
        t=e.get("positives",[{}])[0]
        check(r.get("query")==e.get("query") and
              r.get("collection")==t.get("collection") and
              r.get("number")==t.get("number") and
              r.get("rank_with_e5")==t.get("rank"),
              "Ranking real do agente 9 divergiu na consulta "+str(idx))
    measured={}
    for name,key in (("without_e5","rank_without_e5"),("with_e5","rank_with_e5")):
        ranks=[r.get(key) for r in rows]
        for rank in ranks:
            check(rank is None or (type(rank)==int and rank>0),
                  "Rank inválido do agente 9")
        n=len(ranks)
        summary={"recall_at_10":metric_from_ranks(ranks,10),
                 "recall_at_20":metric_from_ranks(ranks,20),
                 "ndcg_at_5":sum(ndcg_for_one(r) for r in ranks)/n if n else 0,
                 "mrr_at_20":sum(1/r for r in ranks if type(r)==int and 0<r<=20)/n if n else 0}
        for metric,value in summary.items():
            check(abs(finite_score(data.get(name,{}).get(metric),name+"/"+metric)-value)<1e-7,
                  "Métrica semântica não reproduzível: "+name+"/"+metric)
        measured[name]=summary
    check(measured["with_e5"]["recall_at_10"]+1e-9>=measured["without_e5"]["recall_at_10"] and
          measured["with_e5"]["recall_at_20"]+1e-9>=measured["without_e5"]["recall_at_20"],
          "Perda no top10/top20 com E5 no agente 9")
    check(data.get("changed_positions",0)>0 and data.get("recovered_top20",0)>0,
          "Agente 9 não demonstrou recuperação vetorial")
    check(data.get("negative_control_rank") is None or
          data.get("negative_control_rank")>10, "Falso positivo narrativo top10")
    check(data.get("number_exact_rank")==1, "Prioridade de número regrediu")
    return {"cases":12,"ablation":measured,"decision":"approved",
            "limitation":"Rótulos provisórios; não equivale à revisão humana de relevância."}


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
        for name in ("event-frame-engine.js", "story-engine.js", "rrf-fusion.js", "offline-api.js"):
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
    events = audit_events()
    extended = audit_expanded()
    semantic_test = audit_semantic_search_agent()
    package = audit_apk_and_device()
    review = {"schema_version": 1, "agent": "8-independent-qa-review",
              "decision": "approved" if not ERRORS else "rejected",
              "apk": package, "ranking_suites": rank,
              "e5_hybrid": hybrid, "event_variants": events, "relevance_50": extended, "semantic_agent_9": semantic_test, "warnings": WARNINGS, "errors": ERRORS,
              "checked": ["regression_metrics_recomputed", "e5_case_ranks_recomputed",
                          "negative_event_and_rrf_tests", "event_AB_metrics_recomputed", "expanded_50_metrics_recomputed", "android_instrumentation_evidence",
                          "signed_apk_report_crosschecked", "packaged_scripts_equal_tested_sources", "semantic_agent_9_metrics_recomputed"]}
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
