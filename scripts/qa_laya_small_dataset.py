#!/usr/bin/env python3
"""Small supervised Laya task-adaptation dataset, NEVER including real hymn texts in training.

Generated examples are original and labeled by their explicitly authored events.
The previous 31-case benchmark is held out as an untouched evaluation set.
No hymn IDs, title blacklists, real lyric quotes, or label-dependent inference rules.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import random
import re
import unicodedata
from collections import Counter
from pathlib import Path

from qa_qwen3_reranker_real import SYNTHETIC,build_cases,catalog_entries
from qa_laya_real import questions

# A fifth narrative, Lazarus, is completely unseen in training, testing transfer.
# Six distinct original positives and negatives for four trained narrative types.
# Each example is an independent single narrative, NOT a copied religious hymn.
BASE = {
    "retorno": {
        True: [
            "Depois de deixar a casa paterna, o jovem lamentou sua decisão, pediu perdão e foi recebido pelo pai.",
            "A saudade e o remorso fizeram o rapaz abandonar o caminho distante; ele regressou humilde e o pai o abraçou.",
            "Gastar a herança deixou o filho sem rumo. Ele reconheceu o erro, procurou o pai e encontrou acolhimento.",
            "Não ficou para sempre afastado: confessou sua falha, voltou ao lar e reconciliou-se com seu pai.",
            "Uma escolha orgulhosa o levou para longe da família, até que o arrependimento o trouxe de volta ao abraço paterno.",
            "O filho desistiu de viver distante; ao retornar, encontrou um pai disposto a perdoar e festejar a reconciliação."
        ],
        False: [
            "O pai e o filho ergueram cânticos de louvor entre os anjos, celebrando a paz eterna da cidade celestial.",
            "A família seguia unida e feliz na mesma casa; pai e filho cantavam diariamente sobre misericórdia.",
            "O rapaz partiu de viagem, prosperou e decidiu construir uma nova casa sem regressar ao lar de origem.",
            "Um pai aguardava seu filho, mas o retorno jamais ocorreu; a história termina na espera solitária.",
            "Uma criança perdeu o caminho por uma tarde e encontrou seus familiares na praça, sem ter fugido ou precisado de perdão.",
            "O filho chegou à morada celestial, onde foi saudado por um coro; a canção fala da esperança da vida futura."
        ]
    },
    "cura": {
        True: [
            "Enfraquecida por uma longa doença, uma mulher alcançou a roupa de Jesus e naquele encontro recuperou a saúde.",
            "No meio da multidão, a enferma tocou o tecido do Mestre com fé e recebeu alívio imediato de seu sofrimento.",
            "A mulher não desistiu apesar de anos adoecida; aproximou-se do Salvador, tocou suas vestes e ficou sã.",
            "Depois de muito sofrer, ela estendeu a mão até o manto do Senhor, e a enfermidade desapareceu.",
            "A fé conduziu a doente através da multidão até Jesus. Seu toque nas roupas dele trouxe a cura.",
            "Uma senhora atormentada por longa enfermidade buscou o Mestre, tocou sua capa e saiu restaurada."
        ],
        False: [
            "Uma mulher ofereceu um tecido a um viajante e louvou a generosidade que havia recebido.",
            "A senhora enferma procurou consolo entre amigos, e o poema termina antes de narrar qualquer cura.",
            "Os discípulos viram o manto de Jesus e recordaram um encontro, sem qualquer enferma tocá-lo.",
            "Uma mulher tocou a roupa de um sacerdote, mas a narrativa não relata melhora de sua doença.",
            "O tecido precioso foi deixado aos pés do altar como símbolo de gratidão; não há história de milagre.",
            "O Senhor curou um homem cego pela palavra, e a multidão celebrou o novo olhar do homem."
        ]
    },
    "ovelha": {
        True: [
            "Uma ovelhinha saiu do redil, e seu pastor atravessou o vale até encontrá-la e trazê-la de volta.",
            "Ao perceber a ausência de uma ovelha, o cuidador saiu em busca dela, achou-a e a levou em segurança.",
            "A ovelha se afastou do rebanho; o pastor não desistiu da procura e a resgatou no campo.",
            "No deserto a ovelha estava extraviada, mas seu pastor seguiu seus rastros, encontrou-a e a trouxe para casa.",
            "O homem deixou o restante do rebanho protegido para procurar a ovelha desaparecida e regressou com ela.",
            "Depois de muito procurar pelo animal perdido, o pastor o encontrou entre as pedras e o carregou de volta."
        ],
        False: [
            "O pastor guiava o rebanho inteiro até uma pastagem verde; os animais permaneceram juntos em paz.",
            "Uma ovelha ficou longe do rebanho e nunca mais foi vista; ninguém saiu para resgatá-la.",
            "Os pastores repartiram comida no vale, enquanto as ovelhas dormiam tranquilas no redil.",
            "O pastor admirou uma ovelha saudável e celebrou o alimento que o campo oferecia.",
            "A ovelha foi vendida a outra fazenda; o antigo pastor aceitou a venda e continuou seu trabalho.",
            "A canção recorda a beleza das montanhas, dos pastores e das ovelhas, mas não há busca nem resgate."
        ]
    },
    "tempestade": {
        True: [
            "O barco foi sacudido pelas ondas e os discípulos tiveram medo; Jesus ordenou ao vento que cessasse e veio a calma.",
            "Durante a travessia, uma tormenta assustou os homens; o Mestre repreendeu o mar até ele ficar sereno.",
            "Os seguidores tremiam no barco ameaçado, mas o Senhor falou à tempestade e as águas obedeceram.",
            "O vento forte quase virou a embarcação; Jesus mandou a tormenta parar e o medo deu lugar à paz.",
            "No lago em fúria, os discípulos chamaram Jesus, que repreendeu as ondas e trouxe bonança.",
            "A tempestade surgiu sobre a pequena embarcação; o Mestre deu uma ordem ao vento, e as águas se aquietaram."
        ],
        False: [
            "Os marinheiros enfrentaram ondas violentas e conseguiram chegar à praia remando, sem intervenção sobrenatural.",
            "A canção compara dificuldades da vida a uma tempestade, mas trata sobretudo da gratidão pela colheita.",
            "O vento soprava sobre um lago tranquilo enquanto os discípulos descansavam sem medo.",
            "Um barco foi levado por fortes ondas, e a narrativa termina no desespero, sem acalmar o mar.",
            "Um homem pediu que Deus o conduzisse por águas calmas, sem relatar nenhuma tempestade nem ordem ao vento.",
            "A embarcação chegou ao porto com mercadorias; os pescadores louvaram o trabalho bem-sucedido."
        ]
    }
}
# Distinct suffixes give presentation variation without flipping the human-authored label.
SUFFIXES = [
    "O refrão convida a comunidade a refletir sobre o acontecimento narrado.",
    "A mensagem é cantada em primeira pessoa como testemunho e lembrança.",
    "Ao final, todos são convidados a meditar sobre essa história.",
]
assert len(BASE)==4

def normalized(text):
    x=unicodedata.normalize("NFKD",text.lower())
    return re.sub(r"\s+"," ","".join(c for c in x if not unicodedata.combining(c))).strip()

def fingerprint(text):
    return hashlib.sha256(normalized(text).encode()).hexdigest()

def build_dataset(catalog_path,out_dir):
    cases=build_cases(catalog_entries(catalog_path))
    eval_lyrics={fingerprint(c["lyrics"]) for c in cases}
    eval_ids={c["id"] for c in cases}
    assert "real-retorno-264" in eval_ids
    assert sum(c["kind"]=="real" for c in cases)==5
    rng=random.Random(24112026)
    train=[]
    for narrative,per_label in BASE.items():
        for label,examples in per_label.items():
            assert len(examples)==6
            for k,example in enumerate(examples):
                for suffix in SUFFIXES:
                    text=example+" "+suffix
                    assert fingerprint(text) not in eval_lyrics,"Train-test lyric leakage!"
                    qs=questions(narrative)
                    train.append({"state":{"letra":text},"questions":{
                        "central":qs["central"],"desfecho":qs["desfecho"]},
                        "expected":{"central":label,"desfecho":label}})
    rng.shuffle(train)
    hashes=[fingerprint(row["state"]["letra"]) for row in train]
    assert len(train)==144 and len(set(hashes))==len(hashes)
    assert len(cases)==31
    eval_rows=[]
    for item in cases:
        q=questions(item["query"])
        eval_rows.append({"state":{"letra":item["lyrics"]},"questions":{
            "central":q["central"],"desfecho":q["desfecho"]},
            "expected":{"central":bool(item["gold"]),"desfecho":bool(item["gold"])}})
    assert {fingerprint(row["state"]["letra"]) for row in eval_rows}.isdisjoint(hashes)
    path=Path(out_dir);path.mkdir(parents=True,exist_ok=True)
    with (path/"train.jsonl").open("w",encoding="utf-8") as f:
        for row in train:f.write(json.dumps(row,ensure_ascii=False)+"\n")
    with (path/"eval.jsonl").open("w",encoding="utf-8") as f:
        for row in eval_rows:f.write(json.dumps(row,ensure_ascii=False)+"\n")
    manifest={
        "seed":24112026,"train_rows":len(train),"eval_rows":len(eval_rows),
        "training_narratives":sorted(BASE),
        "unseen_eval_narrative":"lazaro",
        "train_positive":sum(r["expected"]["central"] for r in train),
        "train_negative":sum(not r["expected"]["central"] for r in train),
        "evaluation_isolation":"All 31 benchmark cases, including hymn 264, are evaluation-only. No real hymns are training data.",
        "train_content_sha256":hashlib.sha256((path/"train.jsonl").read_bytes()).hexdigest(),
        "eval_content_sha256":hashlib.sha256((path/"eval.jsonl").read_bytes()).hexdigest(),
        "duplicate_training_items":len(hashes)-len(set(hashes)),
    }
    (path/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(manifest,ensure_ascii=False,indent=2),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("catalog")
    p.add_argument("--output-dir",default=".tmp/laya-ft")
    args=p.parse_args()
    build_dataset(args.catalog,args.output_dir)
