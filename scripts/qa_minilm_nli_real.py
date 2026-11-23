#!/usr/bin/env python3
"""Run REAL multilingual MiniLM NLI inference on the SAME cases as the Qwen3 benchmark.

Never uses hymn numbers, titles, or labels as inference features. No weights/lyrics
are committed or packed into an APK. Inference is in a disposable GitHub runner.
Qwen3 baseline is a separate immutable GitHub Actions artifact.
"""
from __future__ import annotations
import argparse, hashlib, json, os, statistics, time
from pathlib import Path

import torch
from huggingface_hub import model_info
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from qa_qwen3_reranker_real import build_cases, catalog_entries, metrics as measure

MODEL = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli"
# Hypotheses are defined for narrative categories; NEVER for individual hymns.
HYPOTHESES = {
    "retorno": {
        "episode": "A letra narra principalmente a história de uma pessoa que se afastou de seu pai, se arrependeu, voltou e foi acolhida.",
        "outcome": "A pessoa que tinha saído voltou arrependida e foi recebida com perdão pelo pai.",
    },
    "cura": {
        "episode": "A letra narra principalmente uma mulher que sofria de uma enfermidade, tocou nas vestes de Jesus e foi curada.",
        "outcome": "Uma mulher doente tocou nas roupas de Jesus e recebeu a cura.",
    },
    "ovelha": {
        "episode": "A letra narra principalmente um pastor que procura uma ovelha perdida, encontra-a e a traz de volta.",
        "outcome": "A ovelha perdida foi encontrada pelo pastor e resgatada.",
    },
    "tempestade": {
        "episode": "A letra narra principalmente discípulos que temiam uma tempestade no barco, até Jesus mandar o vento e as ondas se acalmarem.",
        "outcome": "Jesus ordenou que o vento e as ondas parassem, e a tempestade terminou.",
    },
    "lazaro": {
        "episode": "A letra narra principalmente a história de um amigo de Jesus que estava morto e foi chamado para fora do túmulo, ressuscitando.",
        "outcome": "O homem morto no sepulcro voltou à vida quando Jesus o chamou.",
    },
}
WINDOW_SIZE = 350  # Wordpiece tokens, not characters. Entire lyric is covered in overlapping windows.
WINDOW_STRIDE = 270
MAX_PAIR_TOKENS = 512

def nontruncated_windows(tokenizer, lyrics):
    token_ids = tokenizer.encode(lyrics, add_special_tokens=False)
    if not token_ids:
        return [],0
    windows=[]
    for start in range(0,len(token_ids),WINDOW_STRIDE):
        piece = token_ids[start:start+WINDOW_SIZE]
        windows.append(tokenizer.decode(piece,skip_special_tokens=True))
        if start+WINDOW_SIZE >= len(token_ids):
            break
    return windows,len(token_ids)

def classify_pair(model,tokenizer,premise,hypothesis,indices):
    encoded=tokenizer(premise,hypothesis,truncation=False,return_tensors="pt")
    length=int(encoded["input_ids"].shape[-1])
    if length>MAX_PAIR_TOKENS:
        # Reserve 162 tokens for hypothesis + special tokens. Never silently discard.
        raise ValueError(f"Premise+hypothesis exceeded {MAX_PAIR_TOKENS} tokens: {length}")
    start=time.perf_counter()
    with torch.inference_mode():
        logits=model(**encoded).logits[0]
        probs=torch.softmax(logits,dim=-1)
        p={name:float(probs[idx]) for name,idx in indices.items()}
    return p,time.perf_counter()-start

def summarize(values):
    # A single matching stanza is not sufficient to prove the central meaning.
    # Report both maximum entailment across all windows and full-coverage mean,
    # plus strongest detected contradiction; never hide this design decision.
    ent=[p["entailment"] for p in values]
    contr=[p["contradiction"] for p in values]
    return {
        "max_entailment":round(max(ent),6),
        "mean_entailment":round(statistics.mean(ent),6),
        "max_contradiction":round(max(contr),6),
        "positive":int(statistics.mean(ent)>=0.5 and max(contr)<0.80),
        "any_window_positive":int(max(ent)>=0.5),
        "latency_s":round(sum(p["_seconds"] for p in values),3),
    }

def eval_case(model,tokenizer,case,indices):
    windows,token_count=nontruncated_windows(tokenizer,case["lyrics"])
    if not windows:raise ValueError("Empty lyric: "+case["id"])
    statements={}
    for key,hypothesis in HYPOTHESES[case["query"]].items():
        outputs=[]
        for window in windows:
            probs,elapsed=classify_pair(model,tokenizer,window,hypothesis,indices)
            outputs.append({**probs,"_seconds":elapsed})
        statements[key]=summarize(outputs)
    # Compare two predeclared decisions, NOT thresholds fitted to hymn 264:
    #  (a) episode alone, (b) episode AND outcome
    overall=int(statements["episode"]["positive"] and statements["outcome"]["positive"])
    return {
        "status":"scored","input_tokens":token_count,"windows":len(windows),
        "episode":statements["episode"],"outcome":statements["outcome"],
        "nli_episode":statements["episode"]["positive"],
        "nli_both":overall,
        "elapsed_s":round(statements["episode"]["latency_s"]+statements["outcome"]["latency_s"],3),
    }

def read_baseline(path,items):
    source=json.loads(Path(path).read_text(encoding="utf-8"))
    if source["model"]!="Qwen/Qwen3-Reranker-0.6B":
        raise AssertionError("Different baseline model")
    rows=[x for x in source["outcomes"] if x["instruction"]=="central_meaning"]
    by_id={r["id"]:r for r in rows}
    if set(by_id)!=set(item["id"] for item in items):
        raise AssertionError("Different candidate set; fair comparison impossible")
    return source,by_id

def row_metrics(rows,key):
    return measure([{**row,"status":"scored","prediction":row[key]} for row in rows])

def results(items,rows,baseline):
    report={}
    for variant in ("nli_episode","nli_both","qwen_contextual","qwen_and_nli"):
        report[variant] = {
            "all":row_metrics(rows,variant),
            "synthetic":row_metrics([r for r in rows if r["kind"]=="synthetic"],variant),
            "real":row_metrics([r for r in rows if r["kind"]=="real"],variant),
        }
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("catalog")
    p.add_argument("--baseline",required=True)
    p.add_argument("--output",default="qa-report/minilm-nli-real.json")
    p.add_argument("--model",default=MODEL)
    args=p.parse_args()
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    cases=build_cases(catalog_entries(args.catalog))
    base,by_id=read_baseline(args.baseline,cases)
    revision=model_info(args.model).sha
    print("Loading real multilingual MiniLM NLI",args.model,revision,flush=True)
    load_start=time.perf_counter()
    tokenizer=AutoTokenizer.from_pretrained(args.model,revision=revision)
    model=AutoModelForSequenceClassification.from_pretrained(args.model,revision=revision).eval()
    indices={v.lower():int(k) for k,v in model.config.id2label.items()}
    if set(indices)!={"entailment","neutral","contradiction"}:
        raise AssertionError("Unrecognized NLI label order: "+str(indices))
    print("Model loaded",round(time.perf_counter()-load_start,2),"seconds; labels",indices,flush=True)
    rows=[]
    for i,case in enumerate(cases):
        result=eval_case(model,tokenizer,case,indices)
        ref=by_id[case["id"]]
        row={key:case[key] for key in ("id","query","gold","kind","source")}
        row.update(result)
        row["qwen_contextual"]=int(ref["prediction"])
        row["qwen_contextual_score"]=ref["yes_score"]
        row["qwen_and_nli"]=int(row["qwen_contextual"] and row["nli_both"])
        rows.append(row)
        print(f"{i+1}/{len(cases)} {case['id']}: gold={case['gold']} "
              f"episode={row['episode']['mean_entailment']:.3f} "
              f"outcome={row['outcome']['mean_entailment']:.3f} "
              f"nli={row['nli_both']} qwen={row['qwen_contextual']} "
              f"combined={row['qwen_and_nli']} time={row['elapsed_s']}s windows={row['windows']}",flush=True)
    report={"model":args.model,"revision":revision,"framework":"transformers_CPU_FP32",
            "baseline":{"model":base["model"],"revision":base["revision"],
                        "run":"45244039769","instruction":"central_meaning"},
            "thresholds_fixed_before_run":{"entailment_mean_min":0.5,"contradiction_max_lt":0.8},
            "label_order":model.config.id2label,
            "tokenization":{"window_tokens":WINDOW_SIZE,"stride_tokens":WINDOW_STRIDE,
                            "max_pair_tokens":MAX_PAIR_TOKENS,"silent_truncation":False},
            "metrics":results(cases,rows,by_id),"outcomes":rows,
            "limitations":[
                "Synthetic cases and historical nonblinded positives; small real set.",
                "NLI inference is not a trained central-message classifier.",
                "NLI covers full lyrics in overlapping windows; cross-window episode chains can be lost.",
                "No model bundled into an APK; no Android latency benchmark.",
            ]}
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("SUMMARY",json.dumps(report["metrics"],ensure_ascii=False),flush=True)
    target=next(r for r in rows if r["id"]=="real-retorno-264")
    print("CONTROL_RETORNO_264",json.dumps({
        "nli_episode":target["nli_episode"],
        "nli_both":target["nli_both"],
        "qwen":target["qwen_contextual"],
        "combined":target["qwen_and_nli"],
        "episode_entailment":target["episode"]["mean_entailment"],
        "outcome_entailment":target["outcome"]["mean_entailment"],
        "expected":0
    }),flush=True)

if __name__=="__main__":main()
