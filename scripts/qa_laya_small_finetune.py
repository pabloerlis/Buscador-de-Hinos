#!/usr/bin/env python3
"""Real single-run small fine-tune of Laya-Multilingual (external checkpoint only).

Model sees ONLY original synthetic 144 training lyrics (4 narratives). The 31
pre-existing QA cases, including any real hymn, are never training or calibration
inputs. Baseline decisions are imported from prior fixed Actions artifact.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import statistics
import time
from pathlib import Path

from qa_laya_real import MODEL,questions
from qa_qwen3_reranker_real import build_cases,catalog_entries,metrics

def summarize_cases(rows,field):
    prepared=[{**r,"status":"scored","prediction":int(r[field])} for r in rows]
    return {
        "all":metrics(prepared),
        "synthetic":metrics([r for r in prepared if r["kind"]=="synthetic"]),
        "real":metrics([r for r in prepared if r["kind"]=="real"])
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("catalog")
    p.add_argument("--train",required=True)
    p.add_argument("--eval-data",required=True)
    p.add_argument("--baseline",required=True)
    p.add_argument("--checkpoint",default=".tmp/laya-ft/checkpoint")
    p.add_argument("--output",default="qa-report/laya-small-finetune.json")
    args=p.parse_args()
    import torch
    import laya
    from laya.train import TrainConfig,finetune
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    source=json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    assert source["model"]==MODEL
    cases=build_cases(catalog_entries(args.catalog))
    previous={row["id"]:row for row in source["outcomes"]}
    assert len(cases)==31 and set(previous)=={c["id"] for c in cases}
    assert len([c for c in cases if c["kind"]=="real"])==5
    before_sha=hashlib.sha256(Path(args.train).read_bytes()).hexdigest()
    cfg=TrainConfig(
        epochs=5, micro_batch=4, grad_accum=4,
        freeze_encoder=True, loss="soft-ce",
        encoder_lr=2.5e-5,head_lr=2.0e-4,
        max_len=1024,head_max_len=256,seed=20261123,
        calib_frac=0.10,eval_data=args.eval_data,
        log_every=10
    )
    print("Starting official Laya supervised fine-tune, head-only, no real lyrics",
          "source",MODEL,flush=True)
    started=time.monotonic()
    report_train=finetune(args.train,"multilingual",args.checkpoint,cfg,device="cpu")
    train_elapsed=time.monotonic()-started
    assert hashlib.sha256(Path(args.train).read_bytes()).hexdigest()==before_sha
    print("Training finished",round(train_elapsed,2),"seconds",flush=True)
    # Evaluation happens only AFTER model fitting, with labels stored separately.
    trained=laya.load(args.checkpoint,device="cpu")
    rows=[]
    for index,item in enumerate(cases):
        tic=time.monotonic()
        answer=trained.predict({"letra":item["lyrics"]},questions(item["query"]),max_len=8192)
        usage=answer.get("usage") or {}
        if usage.get("truncated"):
            raise RuntimeError(f"Unexpected truncated held-out lyric: {item['id']}")
        pcentral=float(answer["answers"]["central"]["noul"])
        poutcome=float(answer["answers"]["desfecho"]["noul"])
        row={k:item[k] for k in ("id","query","gold","kind","source")}
        row.update({
            "status":"scored",
            "p_central":round(pcentral,6),
            "p_desfecho":round(poutcome,6),
            "trained_central":int(pcentral>=0.5),
            "trained_both":int(pcentral>=0.5 and poutcome>=0.5),
            "base_central":int(previous[item["id"]]["laya_central"]),
            "base_both":int(previous[item["id"]]["laya_both"]),
            "elapsed_s":round(time.monotonic()-tic,3),
            "truncated":False,
        })
        row["changed"]=row["trained_both"]!=row["base_both"]
        rows.append(row)
        print(f"{index+1:02}/{len(cases)} {item['id']}: expected={item['gold']}; "
              f"base={row['base_both']}, trained={row['trained_both']}, "
              f"p={pcentral:.3f}/{poutcome:.3f}; t={row['elapsed_s']}s",flush=True)
    base=summarize_cases(rows,"base_both")
    trained_metrics=summarize_cases(rows,"trained_both")
    metrics_by_model={"base":base,"fine_tuned":trained_metrics}
    deltas={
        "new_correct":sum(r["base_both"]!=r["gold"] and r["trained_both"]==r["gold"] for r in rows),
        "regressions":sum(r["base_both"]==r["gold"] and r["trained_both"]!=r["gold"] for r in rows)
    }
    # Predefined overall criterion, not tuned on one specific hymn.
    candidate=trained_metrics["all"]
    b=base["all"]
    passed=(candidate["fp"]<b["fp"] and candidate["tp"]>=b["tp"] and
            candidate["accuracy"]>=b["accuracy"])
    output={
        "status":"completed","model":MODEL,"method":"head-only supervised Laya fine-tune",
        "train_source":"144 manually-structured original Portuguese examples (0 real hymns)",
        "train_sha256":before_sha,"calibration_source":"reserved 10% training examples",
        "holdout":"31 fixed examples (26 synthetic + 5 actual hymns), not used for training",
        "unseen_narrative":"lazaro",
        "training_config":{
            "epochs":5,"micro_batch":4,"grad_accum":4,"freeze_encoder":True,
            "loss":"soft-ce","head_lr":2.0e-4,"max_len":1024,
            "head_max_len":256,"seed":20261123},
        "fit_time_s":round(train_elapsed,2),
        "training_summary":{
            k:val for k,val in report_train.items()
            if k in ("train_items","calibration_items","skipped","epoch_loss","calibration","evaluation","eval_mode","is_held_out","note")},
        "baseline_run":45247089241,
        "metrics":metrics_by_model,
        "paired_deltas":deltas,
        "gate_for_external_checkpoint":{"passed":bool(passed),
            "criteria":"Fewer false positives, no positive recall loss, and no accuracy loss across all 31 heldout cases"},
        "outcomes":rows,
        "limitations":[
            "Small synthetic training set and limited independent evaluation: do not claim deployment-ready.",
            "Training only decision head can be less effective than adapting encoder weights.",
            "No fixed hymn-specific rule or label was input to inference.",
            "This run does not alter the APK; all weights remain external."
        ],
    }
    path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(output,ensure_ascii=False,indent=2,default=str)+"\n",encoding="utf-8")
    print("SUMMARY",json.dumps(metrics_by_model,ensure_ascii=False),flush=True)
    print("PAIRED",json.dumps(deltas),flush=True)
    print("GATE",bool(passed),flush=True)
    control=next(x for x in rows if x["id"]=="real-retorno-264")
    print("HOLDOUT_REPORTED_264",json.dumps(control),flush=True)
    # This marker allows artifact upload without claiming the checkpoint passed.
    (path.parent/"checkpoint-decision.txt").write_text("approved" if passed else "research_only")

if __name__=="__main__":
    main()
