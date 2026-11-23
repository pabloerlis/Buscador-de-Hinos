#!/usr/bin/env python3
"""Real Laya 1440-row supervised fine-tune; paired base/v1/v2 evaluations.

Frozen audit dataset: 1440 train examples from 120 authored pairs, 288 dev
examples from 24 *different* authored pairs. The historical 31 cases are only
evaluated after fine-tuning, with no tuning decisions based on their labels.
The previous 144-example experimental model was not exported; its immutable
historical predictions are fetched for comparison, NOT recomputed.

No model weights are embedded in the Android APK. Export is a separate model
folder; the workflow is the only official trainer.
"""
from __future__ import annotations
import argparse
import collections
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import statistics
import time

from qa_qwen3_reranker_real import build_cases, catalog_entries, metrics as counts
from qa_laya_real import MODEL, questions as historical_questions
from qa_laya_1440_generator import questions as corpus_questions

EPOCHS = 2
SEED = 20261123

def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]

def dmetrics(rows):
    n=len(rows)
    tp=sum(int(r["pred"]==1 and r["gold"]==1) for r in rows)
    tn=sum(int(r["pred"]==0 and r["gold"]==0) for r in rows)
    fp=sum(int(r["pred"]==1 and r["gold"]==0) for r in rows)
    fn=sum(int(r["pred"]==0 and r["gold"]==1) for r in rows)
    return {"n":n,"tp":tp,"fp":fp,"tn":tn,"fn":fn,
        "precision":round(tp/(tp+fp),4) if tp+fp else None,
        "recall":round(tp/(tp+fn),4) if tp+fn else None,
        "accuracy":round((tp+tn)/n,4) if n else None}

def get_probability(raw,key):
    answer=raw["answers"][key]["noul"]
    p=float(answer)
    if not 0<=p<=1:raise RuntimeError(f"invalid {key} {p}")
    return p

def infer(agent, state, questions, context):
    started=time.monotonic()
    result=agent.predict(state, questions, max_len=8192)
    if (result.get("usage") or {}).get("truncated"):
        raise RuntimeError("Truncated whole lyrics, invalid benchmark: "+context)
    pcentral=get_probability(result,"central")
    pdesfecho=get_probability(result,"desfecho")
    return {"pcentral":round(pcentral,6),"pdesfecho":round(pdesfecho,6),
        "pred":int(pcentral>=0.5 and pdesfecho>=0.5),
        "seconds":round(time.monotonic()-started,3)}

def evaluate_dev(agent,dev,audit):
    if len(dev)!=288 or len(audit)!=288:
        raise AssertionError("Dev: Expected 288 examples")
    rows=[]
    for i,(case,meta) in enumerate(zip(dev,audit)):
        if case["state"]["letra"]!=meta["text"]:
            raise AssertionError("Mismatched dev metadata")
        gold=int(case["expected"]["central"])
        if gold!=int(case["expected"]["desfecho"]) or gold!=meta["label"]:
            raise AssertionError("Contradictory label")
        prediction=infer(agent,case["state"],case["questions"],meta["id"])
        row={k:meta[k] for k in ("id","topic","scenario_id","label","foil_type","style")}
        row["gold"]=gold
        row.update(prediction)
        rows.append(row)
        if (i+1)%48==0:
            print(f"DEV {i+1}/{len(dev)} rows completed",flush=True)
    return rows

def group(rows):
    by=collections.defaultdict(list)
    for x in rows:
        by[(x["scenario_id"],x["gold"])].append(x)
    result=[]
    for (scene,label),items in sorted(by.items()):
        if len(items)!=6:raise AssertionError("Missing augmented variants for "+scene)
        p1=statistics.median(r["pcentral"] for r in items)
        p2=statistics.median(r["pdesfecho"] for r in items)
        result.append({"id":scene+("-positive" if label else "-negative"),"gold":label,
            "pred":int(p1>=0.5 and p2>=0.5),"pcentral":round(p1,6),
            "pdesfecho":round(p2,6)})
    if len(result)!=48:raise AssertionError("Expected 48 distinct dev cores")
    return result

def evaluate_historical(agent,items):
    rows=[]
    for i,item in enumerate(items):
        value=infer(agent,{"letra":item["lyrics"]},historical_questions(item["query"]),item["id"])
        value.update({k:item[k] for k in ("id","query","gold","kind","source")})
        rows.append(value)
        print(f"HOLDOUT {i+1}/{len(items)} {item['id']} expected={item['gold']} "
              f"pred={value['pred']} pcentral={value['pcentral']} "
              f"pdesfecho={value['pdesfecho']}",flush=True)
    return rows

def compare(rows0,rows1):
    a={r["id"]:r for r in rows0}
    b={r["id"]:r for r in rows1}
    if set(a)!=set(b):raise AssertionError("Paired comparison mismatch")
    for k in a:
        if a[k]["gold"]!=b[k]["gold"]:raise AssertionError("Gold change")
    return {"recovered_errors":sum(a[k]["pred"]!=a[k]["gold"] and b[k]["pred"]==b[k]["gold"] for k in a),
            "introduced_errors":sum(a[k]["pred"]==a[k]["gold"] and b[k]["pred"]!=b[k]["gold"] for k in a),
            "changed":sum(a[k]["pred"]!=b[k]["pred"] for k in a)}

def safe_training_summary(r):
    if not isinstance(r,dict):return {"type":str(type(r))}
    return {k:v for k,v in r.items() if k in (
        "train_items","calibration_items","skipped","epoch_loss",
        "calibration","evaluation","eval_mode","is_held_out","note")}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--train",required=True)
    ap.add_argument("--dev",required=True)
    ap.add_argument("--dev-meta",required=True)
    ap.add_argument("--manifest",required=True)
    ap.add_argument("--catalog",required=True)
    ap.add_argument("--baseline",required=True)
    ap.add_argument("--previous-small",required=True)
    ap.add_argument("--checkpoint",default=".tmp/laya-1440/checkpoint")
    ap.add_argument("--output",default="qa-report/laya-1440-finetune-result.json")
    args=ap.parse_args()
    import torch
    import laya
    from laya.train import TrainConfig,finetune
    from huggingface_hub import model_info
    torch.set_num_threads(min(os.cpu_count() or 2,4))
    manifest=json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    dev=read_jsonl(args.dev);audit=read_jsonl(args.dev_meta)
    train=read_jsonl(args.train)
    items=build_cases(catalog_entries(args.catalog))
    baseline_historical=json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    prev_small=json.loads(Path(args.previous_small).read_text(encoding="utf-8"))
    if len(items)!=31 or len(train)!=1440 or len(dev)!=288:
        raise AssertionError("Frozen corpus size mismatch")
    if manifest["train_sha256"]!=hashlib.sha256(Path(args.train).read_bytes()).hexdigest():
        raise AssertionError("Train dataset hash changed after successful audit")
    if manifest["dev_sha256"]!=hashlib.sha256(Path(args.dev).read_bytes()).hexdigest():
        raise AssertionError("Dev dataset hash changed")
    orig={r["id"]:r for r in baseline_historical["outcomes"]}
    older={r["id"]:r for r in prev_small["outcomes"]}
    if set(orig)!=set(older) or set(orig)!={r["id"] for r in items}:
        raise AssertionError("Historical baselines do not match 31 cases")
    revision=model_info(MODEL).sha
    print("Frozen official model",MODEL,revision,flush=True)
    print("Runtime",importlib.metadata.version("laya"),flush=True)
    print("Train",len(train),"dev",len(dev),"historical",len(items),flush=True)
    start=time.monotonic()
    print("BASE: load original model and score development cases",flush=True)
    base=laya.load(MODEL,device="cpu")
    dev_orig=evaluate_dev(base,dev,audit)
    print("BASE DEV groups",dmetrics(group(dev_orig)),flush=True)
    del base
    gc.collect()

    # Never show historical holdout to the trainer or calibrator.
    # The training API calibrates on 10% of its *training examples*; record
    # that this is not independent calibration because sibling variants exist.
    cfg=TrainConfig(
        epochs=EPOCHS,
        micro_batch=4,grad_accum=4,
        freeze_encoder=True,
        loss="soft-ce",head_lr=1.5e-4,
        encoder_lr=2.5e-5,
        max_len=1024,head_max_len=256,
        seed=SEED,calib_frac=0.10,log_every=60,
    )
    print(f"TRAINING actual full corpus: {len(train)} rows, {EPOCHS} epoch(s), head-only",flush=True)
    train_started=time.monotonic()
    train_summary=finetune(args.train,"multilingual",args.checkpoint,cfg,device="cpu")
    trained_s=time.monotonic()-train_started
    if manifest["train_sha256"]!=hashlib.sha256(Path(args.train).read_bytes()).hexdigest():
        raise AssertionError("Training modified dataset")
    print("TRAINING DONE seconds",round(trained_s,1),flush=True)

    agent=laya.load(args.checkpoint,device="cpu")
    print("FINETUNED: evaluate development set",flush=True)
    dev_new=evaluate_dev(agent,dev,audit)
    print("DEV groups",dmetrics(group(dev_new)),flush=True)
    print("FINETUNED: evaluate historical cases (only now)",flush=True)
    historical_new=evaluate_historical(agent,items)
    del agent
    gc.collect()

    # Historical baseline is an immutable artifact from the prior runs, with
    # the same 31 fixed examples and exact historical question instructions.
    old31=[{**{k:v for k,v in o.items() if k in ("id","gold","kind","query")},
        "pred":int(orig[o["id"]]["laya_both"]),
        "pcentral":orig[o["id"]].get("p_central"),
        "pdesfecho":orig[o["id"]].get("p_desfecho")}
        for o in historical_new]
    small31=[{**{k:v for k,v in o.items() if k in ("id","gold","kind","query")},
        "pred":int(older[o["id"]]["trained_both"])}
        for o in historical_new]
    mdev={"original_rows":dmetrics(dev_orig),"new_rows":dmetrics(dev_new),
        "original_scenarios":dmetrics(group(dev_orig)),
        "new_scenarios":dmetrics(group(dev_new)),
        "paired_scenarios":compare(group(dev_orig),group(dev_new))}
    mhist={"original":dmetrics(old31),"fine_tune_144":dmetrics(small31),
        "fine_tune_1440":dmetrics(historical_new),
        "paired_original_vs_1440":compare(old31,historical_new),
        "paired_144_vs_1440":compare(small31,historical_new)}
    # FIXED pre-analysis criterion: fewer false positives on independent
    # scenario groups with no lost TPs; and the same for historical holdout.
    # Historical results are not available to the optimizer or trial selection.
    dg0=mdev["original_scenarios"];dg1=mdev["new_scenarios"]
    h0=mhist["original"];h1=mhist["fine_tune_1440"]
    approved=bool(dg1["fp"]<dg0["fp"] and dg1["tp"]>=dg0["tp"] and
        h1["fp"]<h0["fp"] and h1["tp"]>=h0["tp"])
    output={
        "status":"measured","base_model":MODEL,
        "base_revision":revision,"training_engine":"laya "+importlib.metadata.version("laya"),
        "training":{"rows":len(train),"epoch_count":EPOCHS,
            "train_time_seconds":round(trained_s,2),
            "configuration":{"freeze_encoder":True,"loss":"soft-ce","head_lr":1.5e-4,
                "micro_batch":4,"grad_accum":4,"calib_frac":0.10,"seed":SEED},
            "summary":safe_training_summary(train_summary),
            "calibration_limitation":"Laya internally calibrates on 10% of augmented train rows; family variants may overlap the 90% training remainder. Distinct dev scenario groups and all historical items remain outside calibration."},
        "dataset_manifest":manifest,
        "development_metrics":mdev,
        "historical_31_metrics":mhist,
        "gate":{"approved":approved,
            "criteria":"Strictly fewer FP without losing TP on both 48 unseen dev scenario cores and historical 31 cases."},
        "specific_case":{"reported_hymn_264":next(({
            "expected":r["gold"],"new_prediction":r["pred"],
            "new_pcentral":r["pcentral"],"new_pdesfecho":r["pdesfecho"],
            "original_prediction":orig[r["id"]]["laya_both"],
            "old_small_prediction":older[r["id"]]["trained_both"]}
             for r in historical_new if r["id"]=="real-retorno-264"),None)},
        "historical_predictions":historical_new,
        "development_scenario_scores":{"original":group(dev_orig),"fine_tuned":group(dev_new)},
        "limitations":[
            "1440 rows reflect 240 hand-authored training scenes, six renderings each.",
            "Only 48 development scene-label pairs from 24 unseen authored pairs; they share story topics and generic devotional frames with training.",
            "31 historical cases have been used in earlier research decisions and are not a fresh blind benchmark.",
            "Previous 144-example model not exported; historical comparison is via frozen output file.",
            "Head-only adaptation, no encoder fine-tuning; model not converted to Android LiteRT or ONNX.",
            "No APK changes, model checkpoint stays an external file if approved."],
        "total_elapsed_seconds":round(time.monotonic()-start,2)
    }
    path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(output,ensure_ascii=False,indent=2,default=str)+"\n",encoding="utf-8")
    (path.parent/"laya-1440-approval.txt").write_text("approved\n" if approved else "research_only\n")
    print("RESULT_DEV",json.dumps(mdev,ensure_ascii=False),flush=True)
    print("RESULT_HISTORICAL",json.dumps(mhist,ensure_ascii=False),flush=True)
    print("CASE_264",json.dumps(output["specific_case"],ensure_ascii=False),flush=True)
    print("CHECKPOINT_APPROVED",approved,flush=True)

if __name__=="__main__":main()
