#!/usr/bin/env python3
"""Garante flags Clang reais, inclusive para GGML/llama/JNI; sem inferências por CMakeLists.
Requer os compile_commands.json gerados pelo Gradle externalNativeBuild.
"""
import argparse
import os
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
expect_kleidiai=os.environ.get("HINOS_EXPECT_KLEIDIAI","false").lower() in ("1","true","yes")
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
    if expect_kleidiai:
        cache_text=cache.read_text(errors="replace")
        desired="ON" if abi=="arm64-v8a" else "OFF"
        for flag,expected in (("HINOS_ENABLE_KLEIDIAI","ON"),("GGML_CPU_KLEIDIAI",desired)):
            match_flag=re.search(rf"^{flag}:(?:BOOL|UNINITIALIZED)=(ON|OFF)$",cache_text,re.M)
            if not match_flag or match_flag.group(1)!=expected:
                report["errors"].append(f"{abi}: {flag} deveria ser {expected} no CMakeCache")
    entries=json.loads(f.read_text())
    if expect_kleidiai:
        sources=[entry.get("file","").replace(chr(92),"/") for entry in entries]
        compiled=any("/ggml-cpu/kleidiai/kleidiai.cpp" in source for source in sources)
        if compiled!=(abi=="arm64-v8a"):
            report["errors"].append(f"{abi}: KleidiAI compilado na ABI incorreta")
        for entry in entries:
            argv=entry.get("arguments") or shlex.split(entry.get("command",""))
            flags=[v for v in argv if v.startswith(("-march=","-mcpu="))]
            required_isa=any(re.search(r"(?:\+|,)(?:i8mm|dotprod)",v) for v in flags)
            source=entry.get("file","").replace(chr(92),"/")
            # KleidiAI compila microkernels especializados com -march próprio.
            # São chamados somente quando o despacho em runtime detecta a ISA.
            # A proibição continua absoluta em ggml/llama/JNI e código genérico.
            specialized=("/_deps/kleidiai-src/" in source and
                         "/kai/ukernels/" in source)
            if required_isa and not specialized:
                report["errors"].append(f"{abi}: ISA obrigatória fora de microkernel com dispatch: {source} {flags}")
                break
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
                             "frame_pointer":"-fno-omit-frame-pointer" in argv})
        if not matching:
            report["errors"].append(f"{abi}: alvo {target} sem comando C/C++ auditável")
        for m in matching:
            if args.mode=="optimized":
                if m["effective"]!="-O3" or not m["has_line_debug"] or not m["frame_pointer"]:
                    report["errors"].append(f"{abi}/{target}/{m['file']}: flags não otimizadas {m['optimization_flags']}")
            elif m["effective"] in ("-O2","-O3","-Ofast"):
                report["errors"].append(f"{abi}/{target}/{m['file']}: baseline não representa Debug {m['effective']}")
        targets[target]=matching
    report["abis"][abi]={"compile_commands":str(f),"targets":targets,
                         "kleidiai_expected":expect_kleidiai and abi=="arm64-v8a"}
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
    print(f"{abi} {args.mode}: "+", ".join(f"{t}={len(v)}" for t,v in detail["targets"].items()))
assert report["passed"],f"Falha na verificação das flags {args.mode}"
print(f"PASS: flags efetivas registradas no arquivo {out}")
