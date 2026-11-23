#!/usr/bin/env python3
"""Real Qwen3-Reranker-0.6B CPU benchmark; lyrics remain only in CI ephemeral storage.

This script does not modify recommendation logic, train the model, or blacklist any hymn.
All predictions come from the real pretrained model's yes/no logits.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import time
from pathlib import Path

import torch
from huggingface_hub import model_info
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-Reranker-0.6B"
MODEL_MAX_TOKENS = 4096
SYSTEM = (
    "<|im_start|>system\n"
    "Judge whether the Document meets the requirements based on the Query and the Instruct provided. "
    'Note that the answer can only be "yes" or "no".<|im_end|>\n'
    "<|im_start|>user\n"
)
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
INSTRUCTIONS = {
    "generic": "Given a web search query, retrieve relevant passages that answer the query.",
    "central_meaning": (
        "Assess whether the central meaning of a complete Portuguese hymn is genuinely appropriate "
        "for the requested biblical narrative. Evaluate who acts, what happens and the outcome. "
        "Shared keywords, incidental mentions, or generic religious imagery alone are not enough. "
        "A contradiction or unrelated main message is not a match."
    ),
}
QUERIES = {
    "retorno": "Filho Pródigo: afastamento, arrependimento, retorno à casa do pai e acolhimento",
    "cura": "Mulher com fluxo de sangue: busca por Jesus, toque na roupa e cura",
    "ovelha": "Ovelha perdida: pastor procura, encontra e traz a ovelha perdida",
    "tempestade": "Tempestade no mar: discípulos temem as ondas, Jesus repreende o vento e acalma a tempestade",
    "lazaro": "Ressurreição de Lázaro: amigo morto e sepultado retorna à vida pelo chamado de Jesus",
}
# All synthetic cases are independent of hymn numbers and from new original text.
SYNTHETIC = [
    ("retorno", 1, "Afastado de casa eu perdi meu caminho. Reconheci meu erro, voltei arrependido ao pai e fui acolhido com perdão."),
    ("retorno", 1, "Eu abandonei o lar e segui longe do pai. Depois me arrependi, regressei e fui recebido com misericórdia."),
    ("retorno", 0, "O pai e o filho cantam belos hinos no céu, onde há festa e coros de alegria eterna."),
    ("retorno", 0, "Um pai observa o filho feliz na casa onde ambos sempre viveram, e juntos celebram a paz."),
    ("retorno", 0, "O filho partiu de casa e nunca retornou; o pai permaneceu esperando, sem reconciliação."),
    ("retorno", 0, "Um filho entrou na glória celeste e foi recebido entre os anjos; a letra celebra a eternidade no céu."),
    ("cura", 1, "Uma mulher sofria havia anos, aproximou-se de Jesus, tocou seu manto e naquele instante ficou curada."),
    ("cura", 1, "Enferma por muito tempo, ela alcançou as vestes do Mestre pela fé e recebeu a cura."),
    ("cura", 0, "Uma mulher tocou a roupa do Mestre, mas a história afirma que não houve cura e seu sofrimento continuou."),
    ("cura", 0, "O homem agradeceu a Deus pela roupa nova, e uma mulher cantava ao lado da multidão."),
    ("cura", 0, "Uma mulher viu Jesus passar e falou de suas dores, mas o texto aborda apenas a despedida."),
    ("ovelha", 1, "Uma ovelha se perdeu nas montanhas; o bom pastor saiu a procurá-la, achou-a e trouxe-a de volta."),
    ("ovelha", 1, "Longe do redil, uma ovelhinha vagava. O pastor a encontrou e a resgatou com amor."),
    ("ovelha", 0, "O pastor e suas ovelhas estavam seguros no redil; ninguém se perdeu e não houve procura."),
    ("ovelha", 0, "O pastor encontrou um pasto verde e levou todas as ovelhas para descansar."),
    ("ovelha", 0, "Uma ovelha fugiu para longe; o pastor não foi buscá-la, e ela jamais regressou."),
    ("tempestade", 1, "Os discípulos temiam as ondas e o vento na embarcação. Jesus mandou cessar a tormenta, e o mar ficou calmo."),
    ("tempestade", 1, "No barco, todos tiveram medo da tempestade; o Senhor ordenou ao vento que se aquietasse, e veio a bonança."),
    ("tempestade", 0, "O vento agitou o mar. Os discípulos enfrentaram a tempestade, mas ninguém a acalmou."),
    ("tempestade", 0, "O Senhor conduziu os viajantes pelas águas claras sem tempestade nem medo."),
    ("tempestade", 0, "O vento e a tempestade são citados como metáforas da vida, mas a mensagem é apenas sobre gratidão pela colheita."),
    ("lazaro", 1, "Lázaro estava morto no sepulcro. Jesus o chamou pelo nome, e ele saiu vivo da tumba."),
    ("lazaro", 1, "O Mestre foi até o túmulo do amigo sepultado, ordenou que viesse para fora e o amigo ressuscitou."),
    ("lazaro", 0, "O amigo de Jesus morreu e foi sepultado; todos lamentaram sua partida, e ele não voltou à vida."),
    ("lazaro", 0, "Um amigo ficou doente e precisou descansar em casa, mas depois melhorou com o passar dos dias."),
    ("lazaro", 0, "Os discípulos cantaram ao lado de um sepulcro e recordaram um amigo falecido."),
]
# Human-curated historical positives/negative controls only for EVALUATION, never used as runtime rules.
REAL = [
    ("retorno", "principal", "264", 0, "falha_relatada_usuario"),
    ("retorno", "principal", "286", 1, "qa_historico_lucas_15"),
    ("ovelha", "principal", "259", 1, "qa_historico_lucas_15"),
    ("tempestade", "principal", "310", 1, "qa_historico_marcos_4"),
    ("lazaro", "principal", "704", 1, "qa_historico_joao_11"),
]
def norm(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", str(s).lower())
                   if not unicodedata.combining(c)).strip()

def catalog_entries(path):
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    groups = raw if isinstance(raw, list) else raw.get("collections", raw.get("coletaneas", raw.get("data", [raw])))
    songs = []
    for group in groups:
        name = norm(group.get("name", ""))
        col = ("principal" if ("coletanea" in name and "2018" in name) or name=="principal"
               else "avulsos" if "avuls" in name else "cia" if re.search(r"\bcia\b", name) else None)
        if not col:
            continue
        for x in group.get("songs", []):
            title = str(x.get("title", x.get("titulo", "")))
            text = re.sub(r"<br\s*/?>", "\n", str(x.get("content", x.get("letra",""))), flags=re.I)
            text = re.sub(r"<[^>]+>", " ", text).strip()
            m = re.match(r"^\s*(?:hino\s*)?(\d{1,4})\s*[-–—.:)]\s*(.*)", title, flags=re.I)
            number = str(x.get("number", x.get("numero", m.group(1) if m else ""))).zfill(3)
            if text:
                songs.append({"collection": col, "number": number, "title": m.group(2) if m else title, "lyrics": text})
    return songs

def build_cases(catalog):
    items = [{"id":f"synthetic-{i:02}", "query":q, "gold":y, "kind":"synthetic",
              "source":"original_synthetic", "title":"", "lyrics":lyrics}
             for i,(q,y,lyrics) in enumerate(SYNTHETIC)]
    for q,col,num,gold,origin in REAL:
        matches = [song for song in catalog if song["collection"]==col and song["number"]==num]
        if len(matches)!=1:
            raise RuntimeError(f"Catalog reference unresolved or nonunique: {col} {num}: {len(matches)}")
        h = matches[0]
        items.append({"id":f"real-{q}-{num}", "query":q, "gold":gold, "kind":"real",
                      "source":origin,"title":h["title"],"lyrics":h["lyrics"]})
    return items

def score_case(model, tokenizer, case, instruction):
    payload = f"<Instruct>: {instruction}\n<Query>: {QUERIES[case['query']]}\n<Document>: "
    payload += ("Hino " + case["title"] + "\n" if case["title"] else "") + case["lyrics"]
    seq = tokenizer.encode(SYSTEM + payload + SUFFIX, add_special_tokens=False)
    if len(seq)>MODEL_MAX_TOKENS:
        return {"status":"oversize","input_tokens":len(seq)}
    tokens=torch.tensor([seq])
    start=time.monotonic()
    with torch.inference_mode():
        output=model(input_ids=tokens, use_cache=False)
        logits=output.logits[0,-1,:]
        y=logits[tokenizer.convert_tokens_to_ids("yes")].item()
        n=logits[tokenizer.convert_tokens_to_ids("no")].item()
    import math
    probability=1.0/(1.0+math.exp(max(-80,min(80,n-y))))
    return {"status":"scored","input_tokens":len(seq),
            "yes_score":round(probability,6),"prediction":int(probability>=0.5),
            "elapsed_s":round(time.monotonic()-start,3)}

def metrics(rows):
    valid=[r for r in rows if r["status"]=="scored"]
    tp=sum(r["prediction"]==1 and r["gold"]==1 for r in valid)
    fp=sum(r["prediction"]==1 and r["gold"]==0 for r in valid)
    tn=sum(r["prediction"]==0 and r["gold"]==0 for r in valid)
    fn=sum(r["prediction"]==0 and r["gold"]==1 for r in valid)
    return {"n":len(valid),"tp":tp,"fp":fp,"tn":tn,"fn":fn,
            "precision":round(tp/(tp+fp),4) if tp+fp else None,
            "recall":round(tp/(tp+fn),4) if tp+fn else None,
            "accuracy":round((tp+tn)/len(valid),4) if valid else None,
            "median_seconds":round(statistics.median([r["elapsed_s"] for r in valid]),3) if valid else None}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("catalog")
    ap.add_argument("--output",default="qa-report/qwen3-reranker-real.json")
    ap.add_argument("--model",default=MODEL)
    ap.add_argument("--limit",type=int,default=0)
    args=ap.parse_args()
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    items=build_cases(catalog_entries(args.catalog))
    if args.limit:
        items=items[:args.limit]
    print(f"Cases: {len(items)}, real: {sum(i['kind']=='real' for i in items)}",flush=True)
    commit=model_info(args.model).sha
    print(f"Loading real model {args.model}@{commit}",flush=True)
    start=time.monotonic()
    tokenizer=AutoTokenizer.from_pretrained(args.model,revision=commit)
    model=AutoModelForCausalLM.from_pretrained(args.model,revision=commit,torch_dtype=torch.float32,
                                               attn_implementation="eager",low_cpu_mem_usage=True).eval()
    print(f"Loaded after {time.monotonic()-start:.1f}s",flush=True)
    rows=[]
    for instruction_name,instruction in INSTRUCTIONS.items():
        for j,item in enumerate(items):
            value=score_case(model,tokenizer,item,instruction)
            result={k:item[k] for k in ("id","query","gold","kind","source")}
            # Only disclose title/number for controls already published as reference cases.
            result.update(value)
            result["instruction"]=instruction_name
            rows.append(result)
            print(f"{instruction_name} {j+1}/{len(items)} {item['id']} score={value.get('yes_score')} "
                  f"tokens={value['input_tokens']} t={value.get('elapsed_s')}s",flush=True)
    report={"model":args.model,"revision":commit,"framework":"transformers_CPU_FP32",
            "model_context_tokens_max":MODEL_MAX_TOKENS,
            "case_counts":{"synthetic":len(SYNTHETIC),"real":len(REAL)},
            "instructions":INSTRUCTIONS,"metrics":{},
            "outcomes":rows,"total_elapsed_s":round(time.monotonic()-start,2),
            "warning":"Exploratory controls; labels from prior QA and synthetic scripts, not a full blind human benchmark."}
    for name in INSTRUCTIONS:
        part=[r for r in rows if r["instruction"]==name]
        report["metrics"][name]={"all":metrics(part),
          "synthetic":metrics([r for r in part if r["kind"]=="synthetic"]),
          "real":metrics([r for r in part if r["kind"]=="real"])}
    destination=Path(args.output);destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report["metrics"],ensure_ascii=False,indent=2),flush=True)
    for name in INSTRUCTIONS:
        row=next(r for r in rows if r["id"]=="real-retorno-264" and r["instruction"]==name)
        print(f"CONTROL_264 {name}: score={row.get('yes_score')} pred={row.get('prediction')} expected=0",flush=True)

if __name__=="__main__":
    main()
