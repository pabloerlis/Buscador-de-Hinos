#!/usr/bin/env python3
"""Agente independente: analisa duas execuções LFM3 oficiais no mesmo emulador Android."""
import json
import re
import sys
from pathlib import Path
log=Path("qa-report/lfm3-device-evidence.log").read_text()
errors=[]
result={"baseline":{},"optimized":{},"hardware":"Android emulator x86_64 (not ARM64 physical)","errors":errors,"passed":False}
for mode in ("baseline","optimized"):
    section=log.split(f"=== TESTE LFM3 {mode} ===")
    if len(section)<2:
        errors.append(f"Falta execução real {mode}")
        continue
    block=section[-1].split("=== TESTE LFM3 ")[0]
    if "OK (1 test)" not in block or "INSTRUMENTATION_STATUS_CODE: 0" not in block:
        errors.append(f"Instrumentação falhou {mode}")
    for case in ("simple","compare-five"):
        found=re.findall(r"BENCHMARK_RESULT case="+re.escape(case)+r" total_ms=(\d+) setup_ms=(\d+) prefill_ms=(\d+) first_token_ms=(-?\d+) generated=(\d+)",block)
        if len(found)!=1:
            errors.append(f"{mode}: {case} não tem 1 medição")
            continue
        total,setup,prefill,first,generated=map(int,found[0])
        if min(total,setup,prefill,generated)<=0 or first<0:
            errors.append(f"{mode}: {case} métrica inconsistente")
        result[mode][case]={"total_ms":total,"setup_ms":setup,"prefill_ms":prefill,"first_token_ms":first,"generated":generated}
for mode in ("baseline","optimized"):
    file=Path(f"qa-report/native-flags-{mode}.json")
    if not file.exists() or not json.loads(file.read_text()).get("passed"):
        errors.append(f"Auditoria Clang não aprovada: {mode}")
if not errors:
    for case in ("simple","compare-five"):
        a=result["baseline"][case]["total_ms"]
        b=result["optimized"][case]["total_ms"]
        result.setdefault("speedups",{})[case]=round(a/b,3)
        if b>a*1.25:
            errors.append(f"Regressão >25% em {case}: {a}ms -> {b}ms")
result["passed"]=not errors
out=Path("qa-report/lfm3-native-benchmark.json")
out.write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps(result,indent=2))
if not result["passed"]:
    sys.exit(1)
