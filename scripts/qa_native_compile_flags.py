#!/usr/bin/env python3
"""Garante flags Clang reais, inclusive para GGML/llama/JNI; sem inferências por CMakeLists.
Requer os compile_commands.json gerados pelo Gradle externalNativeBuild.
"""
import argparse
import json
import re
import shlex
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument("--mode", choices=("baseline","optimized"), required=True)
parser.add_argument("--root", default="app/.cxx")
parser.add_argument("--output", default=None)
args=parser.parse_args()
wanted="ON" if args.mode=="optimized" else "OFF"
report={"mode":args.mode,"abis":{},"errors":[],"passed":False}
required_targets=("ggml-base","ggml-cpu","llama","hinosllm")
files=sorted(Path(args.root).rglob("compile_commands.json"))
for f in files:
    cache=f.parent/"CMakeCache.txt"
    if not cache.is_file():
        continue
    match=re.search(r"^HINOS_OPTIMIZE_NATIVE:(?:BOOL|UNINITIALIZED)=(ON|OFF)$",cache.read_text(errors="replace"),re.M)
    if not match or match.group(1)!=wanted:
        continue
    abi=next((x for x in ("arm64-v8a","x86_64") if x in f.parts),None)
    if not abi:
        continue
    entries=json.loads(f.read_text())
    targets={}
    for target in required_targets:
        matching=[]
        for entry in entries:
            command=entry.get("command","")
            argv=entry.get("arguments") or shlex.split(command)
            if f"CMakeFiles/{target}.dir/" not in command and not any(f"CMakeFiles/{target}.dir/" in v for v in argv):
                continue
            # Somente a ULTIMA opção -O afeta o Clang/NDK.
            opts=[x for x in argv if re.fullmatch(r"-O(?:0|1|2|3|s|z|fast|g)",x)]
            matching.append({"file":Path(entry.get("file","")).name,
                             "optimization_flags":opts,
                             "effective":opts[-1] if opts else None,
                             "has_line_debug":"-gline-tables-only" in argv,
                             "frame_pointer":"-fno-omit-frame-pointer" in argv,
                             "kleidiai":"-DGGML_USE_CPU_KLEIDIAI" in argv,
                             "hinos_kleidiai":"-DHINOS_KLEIDIAI=1" in argv})
        if not matching:
            report["errors"].append(f"{abi}: alvo {target} sem comando C/C++ auditável")
        for m in matching:
            is_arm64 = abi=="arm64-v8a"
            if target=="ggml-cpu" and m["kleidiai"]!=is_arm64:
                report["errors"].append(f"{abi}/{target}/{m['file']}: KleidiAI compilado para ABI inesperada")
            if target=="hinosllm" and m["hinos_kleidiai"]!=is_arm64:
                report["errors"].append(f"{abi}/{target}: seleção de buffer KleidiAI divergente")
            if args.mode=="optimized":
                if m["effective"]!="-O3" or not m["has_line_debug"] or not m["frame_pointer"]:
                    report["errors"].append(f"{abi}/{target}/{m['file']}: flags não otimizadas {m['optimization_flags']}")
            elif m["effective"] in ("-O2","-O3","-Ofast"):
                report["errors"].append(f"{abi}/{target}/{m['file']}: baseline não representa Debug {m['effective']}")
        targets[target]=matching
    report["abis"][abi]={"compile_commands":str(f),"targets":targets}
for abi in ("arm64-v8a","x86_64"):
    if abi not in report["abis"]:
        report["errors"].append(f"Falta a ABI {abi} no modo {args.mode}")
report["passed"]=not report["errors"]
out=Path(args.output or f"qa-report/native-flags-{args.mode}.json")
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
for err in report["errors"]:
    print("ERRO:",err)
for abi,detail in report["abis"].items():
    for target, entries in detail["targets"].items():
        effective = sorted({entry["effective"] or "default" for entry in entries})
        print(f"{abi} {args.mode}: {target} ({len(entries)} arquivos), flags: {', '.join(effective)}")
assert report["passed"],f"Falha na verificação das flags {args.mode}"
print(f"PASS: flags efetivas registradas no arquivo {out}")
