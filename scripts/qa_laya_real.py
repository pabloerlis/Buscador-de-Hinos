#!/usr/bin/env python3
"""Measure actual Laya Multilingual typed decisions on the SAME 31 Qwen3/MiniLM cases.

All model decisions receive only lyric + fixed narrative definition, never ids,
titles, expected labels or the reference model's prediction. Zero APK changes.
"""
from __future__ import annotations
import argparse,json,time,os,statistics,importlib.metadata
from pathlib import Path
from huggingface_hub import model_info
from qa_qwen3_reranker_real import build_cases,catalog_entries,metrics as measure
from qa_minilm_nli_real import HYPOTHESES

MODEL="convaiinnovations/laya-multilingual"
MAX_LEN=8192

def load_baselines(qwen_path,minilm_path,cases):
    qwen=json.loads(Path(qwen_path).read_text(encoding="utf-8"))
    minilm=json.loads(Path(minilm_path).read_text(encoding="utf-8"))
    qr={row["id"]:row for row in qwen["outcomes"] if row["instruction"]=="central_meaning"}
    nr={row["id"]:row for row in minilm["outcomes"]}
    expected=set(c["id"] for c in cases)
    if set(qr)!=expected or set(nr)!=expected:
        raise RuntimeError("Baseline cases differ; comparison is not paired.")
    return qwen,minilm,qr,nr

def questions(query):
    expected=HYPOTHESES[query]
    # Fixed schemas across all hymns. No prompt is derived from a hymn title or ID.
    return {
        "central": {
            "type":"noul",
            "instructions": (
                "A mensagem PRINCIPAL desta letra corresponde à narrativa: "+expected["episode"]+
                " Responda SIM somente se o enredo e o desfecho aparecem como parte central; "
                "palavras isoladas não bastam."
            )
        },
        "desfecho": {
            "type":"noul",
            "instructions": (
                "O desfecho CENTRAL desta letra corresponde à afirmação: "+expected["outcome"]+
                " Responda SIM somente se esse acontecimento realmente ocorre na letra."
            )
        },
        "comparacao": {
            "type":"choice",
            "instructions": (
                "Compare o sentido central da letra com esta narrativa solicitada: "+
                expected["episode"]+" Escolha A somente quando a história inteira e o desfecho "
                "correspondam. Caso contrário, escolha B."
            ),
            "criteria":{
                "A":"O hino apresenta esta mesma narrativa central, incluindo o desfecho.",
                "B":"O hino tem outra mensagem, palavras coincidentes ou um desfecho diferente."
            }
        }
    }

def metrics(rows,key):
    prepared=[{**r,"status":"scored","prediction":int(r[key])} for r in rows]
    return measure(prepared)

def grouped_metrics(rows):
    result={}
    for key in ("laya_central","laya_both","laya_choice","qwen_contextual","nli_both",
                "qwen_and_laya","nli_and_laya"):
        result[key]={
            "all":metrics(rows,key),
            "synthetic":metrics([r for r in rows if r["kind"]=="synthetic"],key),
            "real":metrics([r for r in rows if r["kind"]=="real"],key),
        }
    return result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("catalog")
    parser.add_argument("--qwen",required=True)
    parser.add_argument("--minilm",required=True)
    parser.add_argument("--output",default="qa-report/laya-multilingual-real.json")
    args=parser.parse_args()
    cases=build_cases(catalog_entries(args.catalog))
    qwen,minilm,qr,nr=load_baselines(args.qwen,args.minilm,cases)
    import torch
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    import laya
    revision=model_info(MODEL).sha
    print("Loading REAL Laya multilingual",MODEL,revision,flush=True)
    t0=time.perf_counter()
    agent=laya.load(MODEL,device="cpu")
    print("Laya loaded",round(time.perf_counter()-t0,2),"s",flush=True)
    rows=[]
    for i,case in enumerate(cases):
        t=time.perf_counter()
        res=agent.predict({"letra":case["lyrics"]},questions(case["query"]),max_len=MAX_LEN)
        seconds=time.perf_counter()-t
        answers=res["answers"]
        central=float(answers["central"]["noul"])
        outcome=float(answers["desfecho"]["noul"])
        choice=answers["comparacao"]["choice"]
        if not (0<=central<=1 and 0<=outcome<=1 and choice in ("A","B")):
            raise RuntimeError("Invalid typed answer: "+str(answers))
        usage=res.get("usage") or {}
        if usage.get("truncated"):
            raise RuntimeError("Long context truncated silently; invalid experiment at "+case["id"])
        row={key:case[key] for key in ("id","query","gold","kind","source")}
        row.update({
            "status":"scored","elapsed_s":round(seconds,3),
            "p_central":round(central,6),"p_desfecho":round(outcome,6),
            "selected_choice":choice,"usage_truncated":usage.get("truncated",False),
            "laya_central":int(central>=0.5),
            "laya_both":int(central>=0.5 and outcome>=0.5),
            "laya_choice":int(choice=="A"),
            "qwen_contextual":int(qr[case["id"]]["prediction"]),
            "nli_both":int(nr[case["id"]]["nli_both"]),
        })
        row["qwen_and_laya"]=int(row["qwen_contextual"] and row["laya_choice"])
        row["nli_and_laya"]=int(row["nli_both"] and row["laya_choice"])
        rows.append(row)
        print(f"{i+1}/{len(cases)} {case['id']}: gold={case['gold']} "
              f"central={central:.3f} outcome={outcome:.3f} choice={choice} "
              f"qwen={row['qwen_contextual']} nli={row['nli_both']} "
              f"time={seconds:.3f}s",flush=True)
    report={
        "model":MODEL,"revision":revision,"runtime":"laya "+importlib.metadata.version("laya"),
        "device":"CPU","max_len_requested":MAX_LEN,
        "schema":{"noul_threshold":0.5,"choice_positive":"A","desfecho_required_for_both":True},
        "baselines":{"qwen_run":45244039769,"minilm_run":45245900882,
                     "qwen_revision":qwen["revision"],"minilm_revision":minilm["revision"]},
        "metrics":grouped_metrics(rows),"outcomes":rows,
        "warnings":[
          "Small, exploratory 31-case benchmark; no full blind human annotation.",
          "Laya probabilities are not calibrated for church-hymn relevance.",
          "Labels are used only for evaluation, never as model input.",
          "No model incorporated into Android APK; latency applies to cloud-runner CPU only."
        ]
    }
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("METRICS",json.dumps(report["metrics"],ensure_ascii=False),flush=True)
    print("CONTROL_264",json.dumps(next(r for r in rows if r["id"]=="real-retorno-264")),flush=True)

if __name__=="__main__":main()
