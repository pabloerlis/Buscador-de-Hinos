#!/usr/bin/env python3
"""Build 1,440 Laya supervised examples from 120 authored scenario pairs.

12 narratives x 10 TRAIN paired seeds x 2 labels x 6 balanced, contextualized
renderings = 1440 train rows. Two *different authored pairs* per narrative
form a 288-row development set. Original 31-case benchmark is a third, untouched
evaluation set. Neither an APK nor model weights are written here.

Important: the 1,440 examples are 240 independent underlying scenes with six
renderings each. They are not claimed to be 1,440 independently written plots.
"""
from __future__ import annotations
import argparse,hashlib,json,random,re,unicodedata
from collections import Counter
from pathlib import Path

SOURCE=Path("tests/data/laya_curated_scenarios_v2.json")
SEED=20261123

INTRO=[
    "Em oração eu busco sabedoria,\npara ouvir com clareza e compaixão.",
    "Na sombra de tantas escolhas,\npeço ao Senhor direção para os passos.",
    "Quando a fé parece distante,\nlevanto meus olhos em busca de luz.",
    "Entre o silêncio e a esperança,\nmeu coração repousa nas mãos de Deus.",
    "Mesmo que os dias tragam perguntas,\nconfio na presença do Eterno.",
    "Que a verdade guie minha mente,\ne a humildade habite cada decisão.",
    "Nos caminhos de cada jornada,\na fé sustenta quem caminha.",
    "O tempo revela muitas escolhas,\ne Deus conhece a intenção do coração.",
    "Com reverência eu me aproximo,\nquerendo distinguir o justo do incerto.",
    "Nas noites longas da vida,\na esperança renova o meu olhar.",
    "Quando vejo as marcas do caminho,\nlembro do cuidado que vem do Alto.",
    "Que meu coração aprenda a ouvir,\npara compreender a verdade com mansidão.",
    "No amanhecer de cada dia,\nmeus pensamentos se voltam à fé.",
    "Entre a coragem e a prudência,\nprocuro conduzir meus passos.",
    "Deus, dá-me discernimento,\npara não confundir desejo e realidade.",
    "Na memória das experiências vividas,\nreconheço quanto preciso aprender.",
    "Um passo de cada vez,\natravesso o dia com confiança.",
    "Ergo uma prece silenciosa,\ne sigo observando a vida com atenção."
]
OUTRO=[
    "Que a paz sustente minhas escolhas,\ne a justiça acompanhe o meu caminhar.",
    "Sigo confiando no Senhor,\nmesmo diante do que não posso compreender.",
    "Que a verdade permaneça viva,\ne floresça a esperança dentro de mim.",
    "Com humildade eu prosseguirei,\nbuscando no Alto luz para os passos.",
    "Meu coração guarda essa lembrança,\nenquanto a fé me ensina a esperar.",
    "Que meus olhos encontrem clareza,\ne minhas ações expressem o bem.",
    "No repouso de uma oração,\nlembro que a fé pede discernimento.",
    "O Senhor conhece meus caminhos,\ne nele procuro repouso e sabedoria.",
    "Que a esperança seja firme,\nquando a jornada exigir coragem.",
    "Com serenidade eu sigo adiante,\npois o tempo revela novas possibilidades.",
    "Mesmo ao enfrentar perguntas,\nconservo minha confiança na providência.",
    "A fé ilumina o entendimento,\ne a prudência acompanha minhas decisões.",
    "Que meus passos sejam atentos,\ne minha consciência permaneça desperta.",
    "Deposito diante de Deus\nminhas dúvidas, minhas escolhas e meus desejos.",
    "Há consolo na presença divina,\nquando o pensamento busca direção.",
    "Reúno coragem para prosseguir,\nenquanto a luz da fé me acompanha.",
    "Na quietude encontro forças,\npara observar a vida e agir com cuidado.",
    "Oro por um coração sensível,\ncapaz de reconhecer a verdade sem pressa."
]

def normalize(value):
    x=unicodedata.normalize("NFKD",value.lower())
    return re.sub(r"\s+"," ","".join(c for c in x if not unicodedata.combining(c))).strip()

def fingerprint(text):
    return hashlib.sha256(normalize(text).encode()).hexdigest()

def questions(topic):
    return {
        "central":{"type":"noul","instructions":(
            "A mensagem PRINCIPAL desta letra corresponde à narrativa: "+topic["episode"]+
            " Responda SIM somente se os personagens, as ações e o desfecho aparecem como parte central; "
            "palavras isoladas não bastam."
        )},
        "desfecho":{"type":"noul","instructions":(
            "O DESFECHO CENTRAL desta letra corresponde à afirmação: "+topic["outcome"]+
            " Responda SIM somente se esse resultado realmente ocorre na letra."
        )}
    }

def verse(core):
    # Break at existing punctuation only: keep all narrated events unchanged.
    return re.sub(r"(?<=[,;:])\s+", "\n", core)

def render(core,topic,pair_index,style):
    # Positive and negative retain IDENTICAL devotional surroundings for each
    # authored scenario pair. Short narrative itself carries the contrast.
    k=(topic*37+pair_index*11+style*7)%len(INTRO)
    j=(topic*19+pair_index*13+style*5)%len(OUTRO)
    a,b=INTRO[k],OUTRO[j]
    event=verse(core)
    if style==0:return a+"\n\n"+event+"\n\n"+b
    if style==1:return event+"\n\n"+b+"\n"+INTRO[(k+11)%len(INTRO)]
    if style==2:return a+"\n"+event+"\n"+b
    if style==3:return event+"\n"+b+"\n"+INTRO[(k+4)%len(INTRO)]
    if style==4:return INTRO[(k+8)%len(INTRO)]+"\n\n"+event+"\n\n"+OUTRO[(j+4)%len(OUTRO)]
    if style==5:return b+"\n"+event+"\n"+a
    raise ValueError(style)

def serialize(record):
    return json.dumps(record,ensure_ascii=False,sort_keys=True)+"\n"

def build(out_dir,source=SOURCE):
    data=json.loads(Path(source).read_text(encoding="utf-8"))
    topics=data["scenarios"]
    if len(topics)!=12:raise AssertionError("Exactly 12 narratives required")
    rng=random.Random(SEED)
    rows={"train":[],"dev":[]}
    audit={"train":[],"dev":[]}
    for topic_index,(key,topic) in enumerate(sorted(topics.items())):
        if len(topic["cases"])!=12:raise AssertionError(f"{key}: need 12 pairs; got {len(topic['cases'])}")
        q=questions(topic)
        for i,(positive,negative,foil) in enumerate(topic["cases"]):
            if not positive or not negative or not foil:raise AssertionError("Incomplete scenario: "+key)
            split="train" if i<10 else "dev"
            for label,core in ((True,positive),(False,negative)):
                for style in range(6):
                    lyric=render(core,topic_index,i,style)
                    record={
                        "state":{"letra":lyric},
                        "questions":q,
                        "expected":{"central":label,"desfecho":label}
                    }
                    rows[split].append(record)
                    audit[split].append({
                        "id":f"{key}-{i:02}-{'pos' if label else 'neg'}-v{style}",
                        "scenario_id":f"{key}-{i:02}",
                        "topic":key,"label":int(label),"style":style,
                        "foil_type":foil,
                        "core":core,"text":lyric,
                        "rendering":"compositional_balanced",
                        "split":split,
                    })
    for split in rows:
        indices=list(range(len(rows[split])))
        rng.shuffle(indices)
        rows[split]=[rows[split][i] for i in indices]
        audit[split]=[audit[split][i] for i in indices]
    if len(rows["train"])!=1440 or len(rows["dev"])!=288:raise AssertionError("Target size missed")
    out=Path(out_dir);out.mkdir(parents=True,exist_ok=True)
    for split in ("train","dev"):
        (out/f"{split}.jsonl").write_text("".join(map(serialize,rows[split])),encoding="utf-8")
        (out/f"{split}.audit.jsonl").write_text("".join(map(serialize,audit[split])),encoding="utf-8")
    scenario_hashes={split:{r["scenario_id"] for r in audit[split]} for split in audit}
    assert not scenario_hashes["train"]&scenario_hashes["dev"],"Pair-family leakage!"
    hashes=[fingerprint(r["text"]) for split in audit for r in audit[split]]
    assert len(set(hashes))==len(hashes)
    manifest={
        "source_version":data["schema_version"],"seed":SEED,
        "narratives":sorted(topics),
        "total_examples":len(hashes),"train_examples":len(rows["train"]),
        "dev_examples":len(rows["dev"]),
        "authored_contrast_pairs":sum(len(t["cases"]) for t in topics.values()),
        "authored_base_scenes":2*sum(len(t["cases"]) for t in topics.values()),
        "training_pairs":len(scenario_hashes["train"]),"dev_pairs":len(scenario_hashes["dev"]),
        "renderings_per_core":6,
        "train_class_balance":dict(Counter("positive" if r["label"] else "negative" for r in audit["train"])),
        "dev_class_balance":dict(Counter("positive" if r["label"] else "negative" for r in audit["dev"])),
        "dev_split":"entire authored scenario pairs 10 & 11 of each theme; no shared core scenes",
        "original_31_holdout":"never included in the training or development datasets",
        "lazarus":"unseen topic in previous holdout, absent from all training and development data",
        "runtime_model_weights":"none",
        "train_sha256":hashlib.sha256((out/"train.jsonl").read_bytes()).hexdigest(),
        "dev_sha256":hashlib.sha256((out/"dev.jsonl").read_bytes()).hexdigest(),
        "original_scenarios_sha256":hashlib.sha256(Path(source).read_bytes()).hexdigest()
    }
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(manifest,ensure_ascii=False,indent=2),flush=True)
    return manifest

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--scenarios",default=str(SOURCE))
    ap.add_argument("--out",default="qa-report/laya-1440")
    args=ap.parse_args()
    build(args.out,args.scenarios)
