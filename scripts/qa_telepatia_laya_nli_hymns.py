#!/usr/bin/env python3
"""REAL telepatia-ai/laya-pt-es-nli CPU evaluation on 31 historic hymn cases.

This is an inference-only experiment. No training, changing model weights, APK
changes, or prefilled scores. Comparison IDs, held-out lyrics and their fixed
labels match the historical Qwen/MiniLM/Laya benchmark. Includes 48 separate
authored development scenarios as exploratory domain-shift controls.

NLI is not inherently 'main meaning' classification. Two prompts are tested:
- literal events: entailment for both event and outcome, using only factual text;
- central meaning: entailment for both descriptions that include 'main message'.
No threshold tuning and no hymn-specific rescue logic. Neutral/contradiction are
both treated as rejection, but raw three-way labels are preserved.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.metadata
import json
import os
import statistics
import time
from pathlib import Path

from qa_qwen3_reranker_real import build_cases, catalog_entries
from qa_minilm_nli_real import HYPOTHESES

MODEL="telepatia-ai/laya-pt-es-nli"
LABELS=("contradiction","entailment","neutral")
EXPECTED_HIST=31
EVAL_MODES=("literal","central")

def read_jsonl(path):
    with Path(path).open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def metrics(rows,field):
    n=len(rows)
    tp=sum(r["gold"]==1 and r[field]==1 for r in rows)
    tn=sum(r["gold"]==0 and r[field]==0 for r in rows)
    fp=sum(r["gold"]==0 and r[field]==1 for r in rows)
    fn=sum(r["gold"]==1 and r[field]==0 for r in rows)
    return {"n":n,"tp":tp,"fp":fp,"tn":tn,"fn":fn,
        "precision":round(tp/(tp+fp),4) if tp+fp else None,
        "recall":round(tp/(tp+fn),4) if tp+fn else None,
        "accuracy":round((tp+tn)/n,4) if n else None}

def choices(hypothesis):
    return {
        "type":"choice",
        "instructions":"Leia integralmente o texto e avalie a relacao logica com esta hipotese: "+hypothesis,
        "criteria":{
            "contradiction":"O texto fornece evidencias de que a hipotese e falsa.",
            "entailment":"O texto fornece evidencias suficientes que tornam a hipotese verdadeira.",
            "neutral":"O texto nao fornece evidencias suficientes para confirmar ou contradizer a hipotese."
        }
    }

def parse_choice(answer,case_id,key):
    if isinstance(answer,str):
        label=answer
    elif isinstance(answer,dict):
        label=answer.get("choice")
    else:
        label=None
    if label not in LABELS:
        raise RuntimeError(f"Unexpected choice {case_id} {key}: {str(answer)[:500]}")
    return label

def evaluate(agent,item,statements):
    # "literal" drops the 'the song mainly narrates' meta framing.
    # "central" is the historic fixed NLI hypothesis (as in MiniLM benchmark).
    prompts={}
    for mode in EVAL_MODES:
        phrases=statements[mode]
        for field in ("episode","outcome"):
            prompts[f"{mode}_{field}"]=choices(phrases[field])
    tic=time.monotonic()
    answer=agent.predict({"state":item["lyrics"]},prompts,max_len=8192)
    duration=round(time.monotonic()-tic,3)
    if (answer.get("usage") or {}).get("truncated"):
        raise RuntimeError("NLI truncated the full text "+item["id"])
    labels={key:parse_choice(answer["answers"][key],item["id"],key) for key in prompts}
    variants={}
    for mode in EVAL_MODES:
        episode=labels[f"{mode}_episode"]
        outcome=labels[f"{mode}_outcome"]
        variants[mode]={
            "episode":episode,"outcome":outcome,
            "episode_pred":int(episode=="entailment"),
            "both_pred":int(episode=="entailment" and outcome=="entailment"),
        }
    return variants,duration

def hypotheses_from_event(episode,outcome):
    return {
        "literal":{
            "episode":episode,
            "outcome":outcome
        },
        "central":{
            "episode":"A mensagem principal do texto apresenta este acontecimento: "+episode,
            "outcome":"O desfecho central narrado no texto e: "+outcome,
        }
    }

def get_historical_statements(topic):
    h=HYPOTHESES[topic]
    a=h["episode"]
    b=h["outcome"]
    # Existing episode statement already includes "A letra narra principalmente",
    # which is useful to compare with earlier NLI tests. Strip only this standard
    # fixed prefix for the literal-event variant. Never customize to a hymn ID.
    prefix="A letra narra principalmente "
    alt=a[len(prefix):] if a.startswith(prefix) else a
    if alt.startswith("a historia de "):
        alt=""+alt
    return {"literal":{"episode":alt,"outcome":b},
            "central":{"episode":a,"outcome":"O desfecho central da letra consiste em: "+b}}

def dev_subset(dev_path,meta_path,curated_path):
    dev=read_jsonl(dev_path)
    meta=read_jsonl(meta_path)
    if len(dev)!=288 or len(meta)!=288:
        raise AssertionError("Expected independent 288-row development set")
    topics=json.loads(Path(curated_path).read_text(encoding="utf-8"))["scenarios"]
    if len(topics)!=12:
        raise AssertionError("Expected 12 development topics")
    chosen=[]
    for record,info in zip(dev,meta):
        if record["state"]["letra"]!=info["text"]:
            raise AssertionError("Metadata misaligned")
        if info["style"]!=0:
            continue
        if info["label"]!=int(record["expected"]["central"]):
            raise AssertionError("Metadata label inconsistent")
        topic=topics[info["topic"]]
        chosen.append({
            "id":info["id"],"topic":info["topic"],"lyrics":record["state"]["letra"],
            "gold":info["label"],"kind":"dev",
            "statements":hypotheses_from_event(topic["episode"],topic["outcome"])
        })
    if len(chosen)!=48 or len({r["id"] for r in chosen})!=48:
        raise AssertionError("Expected exactly 48 different development scene+label cores")
    if set(x["gold"] for x in chosen)!={0,1}:
        raise AssertionError("Development label balancing broken")
    return chosen

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--catalog",required=True)
    a.add_argument("--baseline",required=True)
    a.add_argument("--old-trained",required=True)
    a.add_argument("--dev",required=True)
    a.add_argument("--dev-meta",required=True)
    a.add_argument("--curated",default="tests/data/laya_curated_scenarios_v2.json")
    a.add_argument("--output",default="qa-report/telepatia-laya-pt-es-nli.json")
    a.add_argument("--limit",type=int,default=0)
    args=a.parse_args()

    import torch
    import laya
    from huggingface_hub import model_info
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    past=json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    trained=json.loads(Path(args.old_trained).read_text(encoding="utf-8"))
    if past["model"]!="convaiinnovations/laya-multilingual":
        raise AssertionError("Original baseline mismatch")

    historic=build_cases(catalog_entries(args.catalog))
    if len(historic)!=EXPECTED_HIST or len([x for x in historic if x["kind"]=="real"])!=5:
        raise AssertionError("31 benchmark cases, 5 real hymns required")
    origin={r["id"]:r for r in past["outcomes"]}
    oldfine={r["id"]:r for r in trained["historical_predictions"]}
    if set(origin)!={r["id"] for r in historic} or set(oldfine)!=set(origin):
        raise AssertionError("Historical case identity mismatch")
    if len([x for x in historic if x["id"]=="real-retorno-264"])!=1:
        raise AssertionError("Reference case missing")
    dev=dev_subset(args.dev,args.dev_meta,args.curated)
    source=[{
        "id":item["id"],"lyrics":item["lyrics"],"gold":item["gold"],
        "topic":item["query"],"kind":item["kind"],
        "statements":get_historical_statements(item["query"])
    } for item in historic]
    if args.limit:
        source=source[:args.limit]
        dev=[]

    revision=model_info(MODEL).sha
    print("MODEL",MODEL,"REVISION",revision,"Laya",importlib.metadata.version("laya"),flush=True)
    print("TEST SETS historic",len(source),"dev",len(dev),flush=True)
    started=time.monotonic()
    agent=laya.load(MODEL,device="cpu")
    print("MODEL LOADED in seconds",round(time.monotonic()-started,1),flush=True)
    # Sanity check that this model produces the expected NLI taxonomy.
    sanity=agent.predict({"state":"Um gato dorme no sofa."},
        {"relation":choices("O animal esta dormindo.")},max_len=512)
    label=parse_choice(sanity["answers"]["relation"],"sanity","relation")
    print("MODEL SANITY NLI LABEL",label,flush=True)

    rows=[];sums=collections.defaultdict(list)
    for i,item in enumerate(source+dev):
        results,seconds=evaluate(agent,item,item["statements"])
        row={k:item[k] for k in ("id","topic","gold","kind")}
        row["literal"]=results["literal"]
        row["central"]=results["central"]
        row["elapsed_seconds"]=seconds
        if item["kind"]!="dev":
            row["original_laya"]=int(origin[item["id"]]["laya_both"])
            row["old_finetune_1440"]=int(oldfine[item["id"]]["pred"])
            row["qwen3_reranker"]=int(origin[item["id"]]["qwen_contextual"])
        for mode in EVAL_MODES:
            row[mode+"_pred"]=row[mode]["both_pred"]
            if item["kind"]!="dev":
                row[f"qwen_and_{mode}"]=int(row["qwen3_reranker"] and row[mode+"_pred"])
        rows.append(row)
        sums[item["kind"]].append(row)
        print(f"{i+1}/{len(source)+len(dev)} {item['id']}: gold={item['gold']} "
              f"literal={row['literal_pred']}({row['literal']['episode']}/{row['literal']['outcome']}) "
              f"central={row['central_pred']}({row['central']['episode']}/{row['central']['outcome']}) "
              f"seconds={seconds}",flush=True)

    histrows=[r for r in rows if r["kind"]!="dev"]
    drows=sums["dev"]
    histmetrics={
        model:{"all":metrics(histrows,model),
               "synthetic":metrics([r for r in histrows if r["kind"]=="synthetic"],model),
               "real":metrics([r for r in histrows if r["kind"]=="real"],model)}
        for model in ("original_laya","old_finetune_1440","qwen3_reranker",
                      "literal_pred","central_pred","qwen_and_literal","qwen_and_central")
    }
    devmetrics={field:metrics(drows,field) for field in ("literal_pred","central_pred")}
    target=next((r for r in histrows if r["id"]=="real-retorno-264"),None)
    decisions={"literal":0,"central":0}
    for r in histrows:
        for mode in EVAL_MODES:
            if r[mode+"_pred"]!=r["original_laya"]:
                decisions[mode]+=1
    out={
        "status":"real_inference_complete","model":MODEL,"revision":revision,
        "laya_version":importlib.metadata.version("laya"),
        "hardware":"GitHub Actions hosted CPU, 4 vCPU","benchmark_type":"historic 31 + 48 independent authored scenes",
        "prompt_policy":"predeclared independent literal and central NLI hypotheses; entailment only",
        "sanity_label":label,
        "base_comparison":"Laya original, head-only adjusted 1440, Qwen3 reranker from sealed previous run artifacts",
        "historical_metrics":histmetrics,"dev_metrics":devmetrics,
        "hymn_264":target,
        "historical_changes_vs_original_laya":decisions,
        "outcomes":rows,
        "median_inference_seconds":round(statistics.median([r["elapsed_seconds"] for r in rows]),3),
        "total_seconds":round(time.monotonic()-started,2),
        "limitations":[
            "31 historical labels were already used in previous exploratory development; no fresh blind evaluation.",
            "Only 5 complete real hymns in historic benchmark; 48 dev cases are authored synthetic scenes.",
            "NLI entailment is not a calibrated hymn-centrality score; no claim of superiority from a single small benchmark.",
            "The literal and central variants are prespecified and both reported; threshold or labels not tuned to hymn 264.",
            "No weights bundled into Android and no Android latency measured."
        ],
    }
    path=Path(args.output)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("SUMMARY HIST",json.dumps(histmetrics,ensure_ascii=False),flush=True)
    print("SUMMARY DEV",json.dumps(devmetrics,ensure_ascii=False),flush=True)
    print("CASE 264",json.dumps(target,ensure_ascii=False),flush=True)
    print("REPORT",path,flush=True)

if __name__=="__main__":
    main()
