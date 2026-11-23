#!/usr/bin/env python3
"""Independent data-quality reviewer for the Laya training corpus.

DOES NOT import the generator; uses its own parsing and checks. It has no access
to the intended answers when computing lexical leakage measures. Fail-closed CI
errors: exact duplicate, sibling leakage, old holdout overlap, wrongly-balanced
labels, label-only frame, short/garbled text, and trivial label shortcuts.
It is a deterministic audit agent, NOT an LLM judge of theological correctness.
"""
from __future__ import annotations
import argparse,ast,collections,hashlib,json,re,statistics,sys,unicodedata
from pathlib import Path

STOP=set("""a o as os de da do das dos um uma uns umas em para por com no na nos nas que e ao aos à às 
se seu sua seus suas ele ela eles elas este esta isto foi está era mas entre depois mais até já então""".split())
NEGATION=re.compile(r"\b(?:não|nunca|jamais|sem|nenhum|nenhuma|tampouco)\b",flags=re.I)
SIGNALS={
    "contrast":re.compile(r"\b(?:mas|porém|contudo|entretanto|em vez|enquanto|antes)\b",re.I),
    "counterfactual":re.compile(r"\b(?:teria|poderia|planejou|pensou em|prometeu|pretendeu)\b",re.I),
    "denial":NEGATION,
}
TOPICS_EXPECTED=12
TRAIN_EXPECTED=1440
DEV_EXPECTED=288

def words(s):
    return re.findall(r"[a-zà-ÿ]+",unicodedata.normalize("NFC",s.lower()),re.I)

def norm(s):
    return " ".join(words(s))

def key(s):
    return hashlib.sha256(norm(s).encode()).hexdigest()

def grams(s,n=8):
    tokens=words(s)
    return set(zip(*(tokens[i:] for i in range(n)))) if len(tokens)>=n else set()

def read_jsonl(path):
    with open(path,encoding="utf-8") as h:
        return [json.loads(x) for x in h if x.strip()]

def authored_controls(path):
    text=Path(path).read_text(encoding="utf-8")
    root=ast.parse(text)
    constants={}
    for node in root.body:
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in ("SYNTHETIC","REAL"):
            constants[node.targets[0].id]=ast.literal_eval(node.value)
    if "SYNTHETIC" not in constants or "REAL" not in constants:
        raise RuntimeError("Historical holdout declarations not found")
    return constants["SYNTHETIC"],constants["REAL"]

def catalog_holdout(path,real_controls):
    raw=json.loads(Path(path).read_text(encoding="utf-8"))
    groups=raw if isinstance(raw,list) else raw.get("collections",raw.get("coletaneas",raw.get("data",[raw])))
    resolved=[]
    for _,collection,number,_,_ in real_controls:
        matches=[]
        for group in groups:
            name=norm(str(group.get("name","")))
            target=("principal" if ("coletanea" in name and "2018" in name) or name=="principal"
                    else "avulsos" if "avuls" in name else "cia" if re.search(r"\bcia\b",name) else "")
            if collection!=target:continue
            for song in group.get("songs",[]):
                title=str(song.get("title",song.get("titulo","")))
                m=re.match(r"^\s*(?:hino\s*)?(\d{1,4})\s*[-–—.:)]\s*(.*)",title,re.I)
                no=str(song.get("number",song.get("numero",m.group(1) if m else ""))).zfill(3)
                if no==str(number).zfill(3):
                    lyric=re.sub(r"<br\s*/?>","\n",str(song.get("content",song.get("letra",""))),flags=re.I)
                    lyric=re.sub(r"<[^>]+>"," ",lyric)
                    matches.append(lyric)
        if len(matches)!=1:
            raise RuntimeError(f"Failed to uniquely locate a historical heldout hymn {collection}/{number}: {len(matches)}")
        resolved.append(matches[0])
    return resolved

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",required=True)
    ap.add_argument("--historical-script",default="scripts/qa_qwen3_reranker_real.py")
    ap.add_argument("--historical-catalog",required=True)
    ap.add_argument("--report",default="qa-report/laya-1440/audit.json")
    ap.add_argument("--strict",action="store_true")
    args=ap.parse_args()
    base=Path(args.data)
    errors=[];warnings=[];checks={}; samples={}
    def issue(kind,check,message,examples=()):
        entry={"check":check,"message":message,"examples":list(examples)[:6]}
        (errors if kind=="error" else warnings).append(entry)
    datasets={}
    for split in ("train","dev"):
        meta=read_jsonl(base/f"{split}.audit.jsonl")
        model=read_jsonl(base/f"{split}.jsonl")
        datasets[split]=(meta,model)
        checks[split+"_count"]=len(meta)
        checks[split+"_model_count"]=len(model)
        expected=TRAIN_EXPECTED if split=="train" else DEV_EXPECTED
        if len(meta)!=expected or len(model)!=expected:
            issue("error","size",f"{split}: expected {expected} meta/model rows; got {len(meta)}/{len(model)}")
        if len(meta)!=len(model):
            continue
        paired_mismatch=[a["id"] for a,b in zip(meta,model) if a["text"]!=b["state"]["letra"] or
                         b["expected"]["central"]!=bool(a["label"]) or
                         b["expected"]["desfecho"]!=bool(a["label"])]
        if paired_mismatch:issue("error","schema_vs_metadata","Model rows diverge from audit rows",paired_mismatch)
        if any(not re.match(r"^(.+)-\d{2}-(pos|neg)-v\d$",a["id"]) for a in meta):
            issue("error","ids","At least one row ID is malformed")
    allmeta=[a for meta,_ in datasets.values() for a in meta]
    ids=[r["id"] for r in allmeta]
    if len(set(ids))!=len(ids):issue("error","duplicated_id","Duplicate IDs")
    exact=[key(r["text"]) for r in allmeta]
    checks["normalized_unique_texts"]=len(set(exact))
    if len(set(exact))!=len(exact):issue("error","exact_duplicates","Normalized duplicate texts across dataset")
    bysplit={split:set(r["scenario_id"] for r in data[0]) for split,data in datasets.items()}
    checks["train_scenario_families"]=len(bysplit["train"])
    checks["dev_scenario_families"]=len(bysplit["dev"])
    if bysplit["train"]&bysplit["dev"]:
        issue("error","family_leakage","Shared authored scenario pair between train and dev",sorted(bysplit["train"]&bysplit["dev"]))
    bytopic=collections.defaultdict(lambda:collections.Counter())
    byfamily=collections.defaultdict(lambda:collections.defaultdict(list))
    for r in allmeta:
        bytopic[r["topic"]][(r["split"],r["label"])]+=1
        byfamily[r["scenario_id"]][r["label"]].append(r)
        if len(words(r["text"]))<28:issue("error","too_short","Too few words", [r["id"]])
        if len(r["text"])>1500:issue("error","too_long","Potentially excessive token budget",[r["id"]])
        if any(x in norm(r["text"]) for x in ("hino 264","hino 286","hino 259","hino 310","hino 704")):
            issue("error","holdout_id_in_text","Historical test hymn number appears in corpus",[r["id"]])
    checks["themes"]=len(bytopic)
    checks["rows_by_topic"]={k:{
        "train_pos":c[("train",1)],"train_neg":c[("train",0)],
        "dev_pos":c[("dev",1)],"dev_neg":c[("dev",0)]}
        for k,c in sorted(bytopic.items())}
    if len(bytopic)!=TOPICS_EXPECTED:issue("error","topic_coverage","12 narrative topics required")
    for topic,c in bytopic.items():
        if any(c[(s,l)]!=(60 if s=="train" else 12) for s in ("train","dev") for l in (0,1)):
            issue("error","label_balance",f"Imbalanced topic {topic}: {dict(c)}")
    badfamily=[];badframe=[];lowcore=[]
    lexical=[]
    for family,labels in byfamily.items():
        if any(len(labels[l])!=6 or {x["style"] for x in labels[l]}!=set(range(6)) for l in (0,1)):
            badfamily.append(family);continue
        core0={r["core"] for r in labels[0]};core1={r["core"] for r in labels[1]}
        if len(core0)!=1 or len(core1)!=1 or core0==core1:
            lowcore.append(family)
        for positive,negative in zip(sorted(labels[1],key=lambda r:r["style"]),sorted(labels[0],key=lambda r:r["style"])):
            # Same exact surrounding text: if style includes label-specific hints, fails.
            if positive["text"].replace(positive["core"],"<EVENT>") != negative["text"].replace(negative["core"],"<EVENT>"):
                badframe.append(family)
        p=set(words(next(iter(core1))))
        n=set(words(next(iter(core0))))
        p-=STOP;n-=STOP
        lexical.append(len(p&n)/max(1,len(p|n)))
    if badfamily:issue("error","incomplete_pairs","Missing label or variants in paired scenes",badfamily)
    if badframe:issue("error","label_dependent_frames","Positive and negative received different wrapper text",badframe)
    if lowcore:issue("error","duplicate_core","Same or multiple core texts in a family",lowcore)
    checks["authored_pairs"]=len(byfamily)
    checks["distinct_authored_cores"]=len({r["core"] for r in allmeta})
    checks["median_paired_core_jaccard"]=round(statistics.median(lexical),4)
    checks["hard_negative_lexical_overlap_15pct"]=round(sum(x>=0.15 for x in lexical)/len(lexical),4)
    if sum(x>=0.15 for x in lexical)/len(lexical)<0.5:
        issue("warning","weak_hard_negatives","Below 50% of authored negative scenarios have 0.15+ core lexical overlap")
    # Check negative/positive shortcut frequencies both in AUTHORED cores and in expanded texts.
    for field in ("core","text"):
        rates={}
        for label in (0,1):
            group=[r for r in allmeta if r["label"]==label]
            rates["positive" if label else "negative"]=round(sum(bool(NEGATION.search(r[field])) for r in group)/len(group),4)
        checks["negation_rates_"+field]=rates
        delta=rates["negative"]-rates["positive"]
        if delta>0.35:
            issue("error","negation_label_shortcut_"+field,f"Overt negation predicts the negative label (gap {delta:.3f})")
        elif delta>0.20:
            issue("warning","negation_imbalance_"+field,f"Negation usage differs by {delta:.3f}; risk of shortcut learning")
    # Sentence family overlap is expected, but unrelated scenario cores shouldn't be almost identical.
    cores={fam:{label:next(iter(set(r["core"] for r in rs)))
                for label,rs in labs.items()} for fam,labs in byfamily.items() if 0 in labs and 1 in labs}
    copies=[]
    allcores=[(f,l,txt) for f,labels in cores.items() for l,txt in labels.items()]
    for i,(f,l,txt) in enumerate(allcores):
        a=grams(txt,5)
        if not a:continue
        for f2,l2,other in allcores[i+1:]:
            if f==f2:continue
            b=grams(other,5)
            similarity=len(a&b)/max(1,len(a|b))
            if similarity>=0.74:
                copies.append((f,f2,round(similarity,3)))
    checks["near_duplicate_authored_core_pairs"]=len(copies)
    if copies:issue("error","near_duplicate_authored_plots","Too-similar authored plots detected",[f"{a}/{b}/{s}" for a,b,s in copies])
    # Independent historical heldout overlap, without exposing full historical lyrics.
    synthetic,real=authored_controls(args.historical_script)
    real_lyrics=catalog_holdout(args.historical_catalog,real)
    holdouts=[text for _,_,text in synthetic]+real_lyrics
    checks["historical_holdouts_verified"]=len(holdouts)
    if len(holdouts)!=31 or len(real_lyrics)!=5:
        issue("error","historical_coverage","Expected precisely 26 synthetic + 5 real evaluation items")
    oldhash={key(s) for s in holdouts}
    collisions=[r["id"] for r in allmeta if key(r["core"]) in oldhash or key(r["text"]) in oldhash]
    if collisions:issue("error","historical_text_duplicate","Reused exact historical text",collisions)
    # Long ngrams; compare AUTHORED CORES to heldout lyrics, not generic scaffolding.
    historical_ngrams=set()
    for s in holdouts:historical_ngrams.update(grams(s,9))
    overlap=[f"{fam}/{lbl}" for fam,labels in cores.items() for lbl,text in labels.items()
             if grams(text,9)&historical_ngrams]
    checks["historic_ninegram_violations"]=len(overlap)
    if overlap:issue("error","historical_ninegram_contamination","Core overlaps heldout on nine consecutive words",overlap)
    # Honest diversity reporting, not an unsupported claim of 1440 independent stories.
    checks["augmentation_factor"]=len(allmeta)/max(1,checks["distinct_authored_cores"])
    checks["generation_provenance"]="12 themes x 12 authored contrast pairs x two labels x six balanced renderings"
    if checks["distinct_authored_cores"]<280:
        issue("warning","low_authored_diversity","Less than 280 distinct core scenes; volume can overstate diversity.")
    # Report samples with original synthetic texts only.
    samples["blinded_scenario_examples"]=[
       {"id":r["id"],"topic":r["topic"],"text":r["text"],"label":r["label"],"foil_type":r["foil_type"]}
       for r in sorted(allmeta,key=lambda x:x["id"]) if r["style"]==0 and r["scenario_id"].endswith(("00","10"))
    ][:36]
    report={
        "agent":"independent_laya_dataset_reviewer",
        "agent_kind":"deterministic independent code + explicit contamination checks; not a semantic LLM or expert theologian",
        "passed":not errors,
        "error_count":len(errors),"warning_count":len(warnings),
        "errors":errors[:80],"warnings":warnings[:80],"checks":checks,
        "sample_review":samples,
        "limitations":[
            "1440 training rows are derived from 240 authored training scenes with six contextualized renderings each.",
            "Heuristic checks do not prove that each label is semantically correct; independent human labeling is still needed.",
            "Original real hymn texts are held out and used solely to check contamination.",
            "No model weights or APK changes are produced by this audit."
        ]
    }
    output=Path(args.report);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:report[k] for k in ("agent","passed","error_count","warning_count","errors","warnings","checks")},
                     ensure_ascii=False,indent=2),flush=True)
    if args.strict and errors:raise SystemExit(2)

if __name__=="__main__":
    main()
