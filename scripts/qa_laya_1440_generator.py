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
    "Entre dúvidas, escolhas e lembranças, a comunidade acompanha com atenção um acontecimento contado à luz da fé.",
    "Quando a assembleia se reúne para meditar, os detalhes do episódio ajudam a distinguir palavras e atitudes.",
    "Ao recordar os caminhos da vida, o coração considera os acontecimentos e as consequências das decisões humanas.",
    "Numa reflexão coletiva, a atenção passa das expressões conhecidas para os fatos que ocorreram.",
    "Diante de um tempo de incerteza, as pessoas ouvem o relato e procuram compreender os gestos de cada participante.",
    "Entre orações e perguntas, a narrativa apresenta escolhas cujos efeitos merecem ser observados.",
    "Na lembrança de uma reunião, as pessoas prestam atenção aos fatos e ao destino de quem aparece no relato.",
    "Sob o peso das dificuldades, o testemunho procura mostrar o que aconteceu de fato e quem participou.",
    "Ao buscar entendimento, os ouvintes seguem o desenvolvimento da cena e observam o que resulta dela.",
    "Em uma conversa sobre fé e responsabilidade, um episódio é lembrado por seus acontecimentos concretos.",
    "Na quietude de uma reflexão, as palavras conduzem o pensamento a uma história com pessoas e decisões.",
    "Diante da necessidade de discernimento, os ouvintes procuram reconhecer o sentido que emerge das ações relatadas.",
    "Em uma ocasião de estudo e oração, os presentes procuram entender os acontecimentos sem antecipar conclusões.",
    "A congregação escuta atentamente a lembrança de uma experiência e considera o lugar de cada participante.",
    "A reflexão sobre caminhos e decisões prepara os ouvintes para acompanhar a situação narrada.",
    "Quando se avaliam atitudes humanas, é preciso observar as ações, os agentes e seus resultados.",
    "Um testemunho passa a ser considerado com cuidado, enquanto diferentes pessoas acompanham o relato.",
    "Na memória de quem narra, os fatos se encadeiam e levam a uma conclusão que merece ser examinada."
]
OUTRO=[
    "A reflexão final chama a atenção para a importância dos acontecimentos, não apenas para palavras repetidas.",
    "Os ouvintes guardam a lembrança dos gestos e de suas consequências ao longo do relato.",
    "Depois, o grupo volta a considerar o que ocorreu com cada pessoa mencionada.",
    "A comunidade procura extrair uma lição sem mudar os fatos já apresentados.",
    "O pensamento retorna ao significado das ações e do resultado observado.",
    "Ao recordar a cena, os presentes distinguem intenção, acontecimento e consequência.",
    "A memória do episódio desperta perguntas sobre responsabilidade e confiança.",
    "O relato é retomado como oportunidade de observar decisões e seus efeitos.",
    "A atenção se mantém no percurso dos personagens, mesmo depois de terminar a narração.",
    "O episódio permanece como tema de conversa e discernimento entre os ouvintes.",
    "Cada participante da reflexão considera como o desenlace ilumina o sentido do relato.",
    "O registro dos fatos serve de ponto de partida para pensar sobre a vida.",
    "A história é lembrada sem transformar suposições em acontecimentos.",
    "As pessoas refletem sobre o que a cena mostra e sobre o que ela deixa em aberto.",
    "O encontro prossegue com uma reflexão sobre os gestos narrados.",
    "Quem escutou procura compreender o percurso real, sem se deter apenas no vocabulário.",
    "A cena ajuda a contrastar esperança, decisão e realidade.",
    "A meditação final valoriza o que aconteceu na história e seu significado."
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

def render(core,topic,pair_index,style):
    # Identical balanced frame is used for both labels of the SAME scenario.
    # A style controls placement; lexical surroundings vary with every pair.
    k=(topic*37+pair_index*11+style*7)%len(INTRO)
    j=(topic*19+pair_index*13+style*5)%len(OUTRO)
    a,b=INTRO[k],OUTRO[j]
    if style==0:return a+"\n\n"+core
    if style==1:return core+"\n\n"+b
    if style==2:return a+"\n\n"+core+"\n\n"+b
    if style==3:return core+" "+b+" "+INTRO[(k+4)%len(INTRO)]
    if style==4:return INTRO[(k+8)%len(INTRO)]+" "+core+" "+b
    if style==5:return b+" "+core+" "+a
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
