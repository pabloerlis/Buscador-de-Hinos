#!/usr/bin/env python3
"""Build a pinned, external Harrier index; no text or model weights in the output."""
import argparse
import base64
import hashlib
import json
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

from validate_harrier import REPO, REV, FILES, PROMPT, sha, encode

CATALOG_REV = "da8e75932982123301affce688e45b4152c9e06e"
CATALOG_URL = "https://raw.githubusercontent.com/italozaina/projection-html5-icm/"+CATALOG_REV+"/data/data.json"
VARIANT = "q4f16"
DIM = 1024
MAX_TOKENS = 192
MODEL_FILES = {
    **{k:v for k,v in FILES.items() if "q4f16" in k},
    "tokenizer.json": (9117473,"2320ebaed2032c36f5c539cb8531d0642a10024e164f1d81ebbe163b259e3ba5"),
    "tokenizer_config.json": (4650,"e1c8a5341a350885510d652a3a303beabf3a76ef745af6c6b4c3f0d815ccfb5c"),
    "config.json": (1530,"c55e075ac57223f7442ef1755051e9bd212e0d4ff2ed68694037f5a21dba7eeb")
}
COLLECTIONS = {"Coletânea 2018":"principal","Avulsos 2018":"avulsos","CIA 2018":"cia"}
SCHEMA = "harrier-hymn-index-v1"
# Match VectorIndex fingerprint: normalized title, separator and original lyrics.
def norm(value):
    s=unicodedata.normalize("NFKD",value)
    s=re.sub(r"[\u0300-\u036f]","",s)
    return " ".join(s.split()).lower()
def fingerprint(title,lyrics):
    return hashlib.sha256(norm(title+"|"+lyrics).encode("utf-8")).hexdigest()[:24]

class Plain(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts=[]
    def handle_data(self,data): self.parts.append(data)
    def handle_starttag(self,tag,attrs):
        if tag=="br": self.parts.append("\n")
    def handle_endtag(self,tag):
        if tag in {"p","div","li","section","h1","h2","h3","h4","h5","h6"}:
            self.parts.append("\n")
def plain(value):
    parser=Plain()
    parser.feed(str(value or "").replace("\\n","\n"))
    parser.close()
    s="".join(parser.parts).replace("\r\n","\n").replace("\r","\n").replace("\xa0"," ")
    return re.sub(r"\n{4,}","\n\n\n",re.sub(r"[ \t]+$","",s,flags=re.M)).strip()

def title_of(raw):
    title=plain(raw).replace("\n"," ").strip()
    match=re.match(r"^\s*(?:(?:hino|louvor)\s+)?(\d{1,4})\s*(?:[-–—.:)]\s*|\s+)(.+)$",title,re.I)
    return match[2].strip() if match else title

def records_from_catalog(data):
    groups=data if isinstance(data,list) else data.get("collections",data.get("coletaneas",data.get("data",[data])))
    if not isinstance(groups,list): raise ValueError("Invalid source collections")
    selected=[g for g in groups if isinstance(g,dict) and g.get("name") in COLLECTIONS and isinstance(g.get("songs"),list)]
    if len(selected)!=3 or set(g["name"] for g in selected)!=set(COLLECTIONS):
        raise ValueError("Three expected collections not present")
    records={}
    counts={}
    for group in selected:
        name=COLLECTIONS[group["name"]]
        counts[name]=0
        for raw in group["songs"]:
            if not isinstance(raw,dict): continue
            title=title_of(raw.get("title") or raw.get("titulo"))
            lyrics=plain(raw.get("content") or raw.get("letra"))
            if not title or not lyrics:continue
            counts[name]+=1
            key=fingerprint(title,lyrics)
            if key not in records:
                records[key]=(title,lyrics)
    return records,counts

def passages(title, lyrics):
    # Same bounded strategy as the E5 pipeline; not tuned on evaluation examples.
    lines=[x.strip() for x in lyrics.splitlines() if x.strip()]
    if not lines:return []
    first=title+". "+" ".join(lines[:12])[:800]
    last=title+". "+" ".join(lines[-12:])[:800]
    return list(dict.fromkeys([first,last]))

def quantize(v):
    import numpy as np
    v=np.asarray(v,dtype=np.float32)
    if v.shape!=(DIM,) or not np.isfinite(v).all() or not .99<=np.linalg.norm(v)<=1.01:
        raise ValueError("Invalid normalized vector")
    b=np.clip(np.rint(v*127),-127,127).astype(np.int8)
    if not np.any(b):raise ValueError("Quantized vector is zero")
    deq=b.astype(np.float32)
    cosine=float(np.dot(v,deq)/np.linalg.norm(deq))
    return base64.b64encode(b.tobytes()).decode("ascii"),cosine

def write_json(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")

def audit(out):
    index=json.loads((out/"index.json").read_text())
    manifest=json.loads((out/"manifest.json").read_text())
    if index["schema"]!=SCHEMA or index["dimension"]!=DIM or index["revision"]!=REV or index["variant"]!=VARIANT:
        raise ValueError("Wrong index model or schema")
    if len(index["records"])!=index["count"] or len(index["records"])<1400:
        raise ValueError("Incomplete index")
    if set(index)!= {"schema","model","revision","variant","dimension","quantization","catalog_revision","catalog_sha256","count","records"}:
        raise ValueError("Unexpected index fields")
    seen=set()
    segments=0
    for record in index["records"]:
        if set(record)!={"f","v"} or not re.fullmatch("[0-9a-f]{24}",record["f"]) or record["f"] in seen:
            raise ValueError("Invalid or duplicate fingerprint")
        seen.add(record["f"])
        if not 1<=len(record["v"])<=2:raise ValueError("Wrong number of segments")
        for vector in record["v"]:
            raw=base64.b64decode(vector,validate=True)
            if len(raw)!=DIM or not any(raw):raise ValueError("Invalid vector bytes")
            segments+=1
    if manifest["index"]["sha256"]!=sha(out/"index.json") or manifest["index"]["bytes"]!=(out/"index.json").stat().st_size or manifest["index"]["segments"]!=segments or manifest["index"]["count"]!=len(seen):
        raise ValueError("Index manifest mismatch")
    if manifest["catalog"]["sha256"]!=index["catalog_sha256"]:raise ValueError("Catalog mismatch")
    if manifest["model"]["files"] != [{"path":name,"bytes":size,"sha256":digest} for name,(size,digest) in MODEL_FILES.items()]:
        raise ValueError("Model manifest mismatch")
    print("INDEX AUDIT OK:",json.dumps({"records":len(seen),"segments":segments,"bytes":manifest["index"]["bytes"],"sha256":manifest["index"]["sha256"]}),flush=True)
    return manifest

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--model-dir",type=Path,default=Path("/tmp/harrier"))
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--audit-only",action="store_true")
    args=parser.parse_args()
    if args.audit_only:audit(args.out);return
    import numpy as np
    import requests
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from tokenizers import Tokenizer
    args.out.mkdir(parents=True,exist_ok=True)
    for name,(size,digest) in MODEL_FILES.items():
        path=Path(hf_hub_download(REPO,name,revision=REV,local_dir=args.model_dir))
        if (path.stat().st_size,sha(path))!=(size,digest):
            raise RuntimeError("Model integrity check failed: "+name)
    source=requests.get(CATALOG_URL,timeout=120)
    source.raise_for_status()
    catalog_hash=hashlib.sha256(source.content).hexdigest()
    records,counts=records_from_catalog(source.json())
    if len(records)<1400:raise ValueError("Catalog incomplete")
    print("Source",catalog_hash,"collections",counts,"fingerprints",len(records),flush=True)
    tok=Tokenizer.from_file(str(args.model_dir/"tokenizer.json"))
    tok.enable_truncation(max_length=MAX_TOKENS)
    opts=ort.SessionOptions()
    opts.intra_op_num_threads=3
    opts.inter_op_num_threads=1
    session=ort.InferenceSession(str(args.model_dir/"onnx/model_q4f16.onnx"),sess_options=opts,providers=["CPUExecutionProvider"])
    if ort.__version__!="1.31.1":raise ValueError("Runtime mismatch")
    indexed=[]
    cosines=[]
    for i,(key,(title,lyrics)) in enumerate(sorted(records.items())):
        vectors,_,_=encode(session,tok,passages(title,lyrics),DIM)
        quantized=[quantize(x) for x in vectors]
        cosines.extend(c for _,c in quantized)
        indexed.append({"f":key,"v":[s for s,_ in quantized]})
        if (i+1)%100==0:print("Embedded",i+1,"/",len(records),flush=True)
    if min(cosines)<.95:raise ValueError("Quantization cosine below gate")
    index={"schema":SCHEMA,"model":REPO,"revision":REV,"variant":VARIANT,"dimension":DIM,
        "quantization":"symmetric-int8-l2-renormalize","catalog_revision":CATALOG_REV,
        "catalog_sha256":catalog_hash,"count":len(indexed),"records":indexed}
    write_json(args.out/"index.json",index)
    index_path=args.out/"index.json"
    manifest={"schema":SCHEMA,"model":{"repo":REPO,"revision":REV,"variant":VARIANT,"runtime":"1.31.1","dimension":DIM,
        "max_tokens":MAX_TOKENS,"query_prefix":PROMPT,"pooling":"sentence_embedding","normalization":"L2",
        "license":"MIT","files":[{"path":name,"bytes":size,"sha256":digest} for name,(size,digest) in MODEL_FILES.items()]},
        "catalog":{"url":CATALOG_URL,"revision":CATALOG_REV,"sha256":catalog_hash,"collection_records":counts},
        "index":{"path":"index.json","bytes":index_path.stat().st_size,"sha256":sha(index_path),"count":len(indexed),
            "segments":len(cosines),"min_quantization_cosine":min(cosines),"mean_quantization_cosine":float(np.mean(cosines))},
        "fingerprint":"sha256(NFKD strip U+0300-036F, trim/collapse whitespace, lowercase(title+'|'+lyrics))[:24]",
        "segmentation":"title + first/last 12 nonempty lines, max 800 characters per segment; deduplicated identical segments"}
    write_json(args.out/"manifest.json",manifest)
    audit(args.out)

if __name__=="__main__": main()
