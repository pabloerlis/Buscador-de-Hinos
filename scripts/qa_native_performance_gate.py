#!/usr/bin/env python3
"""Agente independente: avalia o mesmo GGUF oficial sem e com -O3.
Um timeout comprovado da comparação baseline é dado negativo; otimizado deve concluir.
"""
import json
import re
import sys
from pathlib import Path

log=Path("qa-report/lfm3-device-evidence.log").read_text()
errors=[]
result={
 "baseline":{},"optimized":{},
 "hardware":"Android emulator x86_64 (not ARM64 physical)",
 "errors":errors,"passed":False,
 "limits":{"per_generation_ms":180000}
}
pattern=r"BENCHMARK_RESULT case={case} total_ms=(\d+) setup_ms=(\d+) prefill_ms=(\d+) first_token_ms=(-?\d+) generated=(\d+)"
for mode in ("baseline","optimized"):
    section=log.split(f"=== TESTE LFM3 {mode} ===")
    if len(section)!=2:
        errors.append(f"Falta uma execução identificável de {mode}")
        continue
    block=section[-1].split("=== TESTE LFM3 ")[0]
    normal="OK (1 test)" in block and "INSTRUMENTATION_STATUS_CODE: 0" in block
    expected_timeout=(mode=="baseline"
        and "EXPECTED_BASELINE_TIMEOUT case=compare-five budget_ms=180000" in block
        and "Caused by: java.lang.IllegalStateException: Tempo limite de geração atingido." in block
        and "INSTRUMENTATION_STATUS_CODE: -2" in block
        and "BENCHMARK_RESULT case=compare-five " not in block)
    if not normal and not expected_timeout:
        errors.append(f"Android não aprovou inferência {mode} e não há timeout baseline legítimo")
    for case in ("simple","compare-five"):
        found=re.findall(pattern.format(case=re.escape(case)),block)
        if not found:
            if mode=="baseline" and case=="compare-five" and expected_timeout:
                result[mode][case]={"timed_out":True,"lower_bound_ms":180000}
                continue
            errors.append(f"{mode}: {case} não tem medição")
            continue
        if len(found)!=1:
            errors.append(f"{mode}: {case} possui {len(found)} medições, esperado 1")
            continue
        total,setup,prefill,first,generated=map(int,found[0])
        if min(total,setup,prefill,generated)<=0 or first<0:
            errors.append(f"{mode}: {case} métrica inconsistente")
        result[mode][case]={
            "total_ms":total,"setup_ms":setup,"prefill_ms":prefill,
            "first_token_ms":first,"generated":generated,"timed_out":False
        }
for mode in ("baseline","optimized"):
    file=Path(f"qa-report/native-flags-{mode}.json")
    if not file.exists() or not json.loads(file.read_text()).get("passed"):
        errors.append(f"Auditoria Clang não aprovada: {mode}")
if not errors:
    for case in ("simple","compare-five"):
        a=result["baseline"][case]
        b=result["optimized"][case]
        bt=b["total_ms"]
        if case=="compare-five" and b["first_token_ms"]>=20000:
            errors.append("O primeiro token da comparação otimizada excedeu 20 segundos")
        if a.get("timed_out"):
            result.setdefault("speedups",{})[case]={"lower_bound_x":round(a["lower_bound_ms"]/bt,3)}
        else:
            at=a["total_ms"]
            result.setdefault("speedups",{})[case]={"ratio_x":round(at/bt,3)}
            if case=="compare-five":
                prefill_ratio=a["prefill_ms"]/b["prefill_ms"]
                result["speedups"][case]["prefill_ratio_x"]=round(prefill_ratio,3)
                if prefill_ratio<1.1:
                    errors.append(f"Prefill otimizado sem ganho mínimo de 10%: {prefill_ratio:.3f}x")
            if bt>at*1.25:
                errors.append(f"Regressão >25% em {case}: {at}ms -> {bt}ms")
result["passed"]=not errors
out=Path("qa-report/lfm3-native-benchmark.json")
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(result,ensure_ascii=False,indent=2))
if not result["passed"]:
    sys.exit(1)
