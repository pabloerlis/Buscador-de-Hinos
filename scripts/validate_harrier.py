#!/usr/bin/env python3
"""Experimental validation only. Nothing is installed or shipped in the APK."""
import argparse
import hashlib
import json
import math
import resource
import time
from pathlib import Path

REPO = "onnx-community/harrier-oss-v1-0.6b-ONNX"
REV = "dbaf6767003608562dd5b744bc443656a29c45bd"
E5_REPO = "Xenova/multilingual-e5-small"
E5_REV = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
FILES = {
    "onnx/model_q4f16.onnx": (376930, "164230246e40d0249dfefe2901cafd071e1d116e96aa0f9b7fa2da1284fbdbb1"),
    "onnx/model_q4f16.onnx_data": (353058816, "4c431be6a2456467e96bee8e9080464e2d0a4352c8de77639deee87bac69dd1d"),
    "onnx/model_q4.onnx": (389110, "4a41218d088c2e31fd6a3953d838d08536a27e98cf987796104a9511f9d9a671"),
    "onnx/model_q4.onnx_data": (398813184, "5dee6d2aecd2657464eb80e833ce79593a94430c3abca3d0c1f5424f0713e59e"),
}
PROMPT = "Instruct: Retrieve passages from Portuguese Christian hymns that express the biblical context or spiritual meaning of the query.\nQuery: "
# Original synthetic paraphrases; not hymns or copied lyrics. No tuning on these cases.
CASES = [
 ("medo diante das ondas, confiar que Cristo pode acalmar a situação","Mesmo quando o vento ruge e as águas ameaçam, a voz do Salvador traz quietude ao coração."),
 ("o pai recebe o filho que se arrependeu","Voltei sem nada à casa que abandonei; encontrei os braços abertos de quem me amava."),
 ("oração por livramento de quem está preso","Na escuridão do cárcere os servos cantaram; as portas se abriram e as cadeias caíram."),
 ("Deus cuida de nós no deserto e supre as necessidades","Na terra árida recebi alimento do alto e água da rocha; nada me faltou."),
 ("renunciar a si mesmo para seguir Jesus","Deixo minha vontade e tomo a cruz, seguindo os passos do Mestre."),
 ("perseverar quando a resposta de Deus demora","Ainda que os dias passem sem sinal, espero firme pela promessa do Senhor."),
 ("Jesus encontra a ovelha que se afastou","O Pastor foi além do aprisco e trouxe nos ombros aquela que se perdera."),
 ("união dos irmãos como um só corpo","Muitos membros, uma esperança; unidos no amor servimos ao mesmo Senhor."),
 ("gratidão pela misericórdia apesar de não merecer","Não por meus méritos fui recebido; agradeço a graça que me alcançou."),
 ("ressurreição e vitória sobre a morte","A pedra foi removida e o sepulcro vazio anuncia que o Senhor vive."),
 ("luz para orientar decisões difíceis","Quando não sei por onde andar, tua palavra ilumina meus passos."),
 ("Deus ouve o coração contrito e perdoa pecados","Com sincero arrependimento confesso minhas faltas e encontro perdão."),
 ("preparação vigilante para a volta de Cristo","Mantenho a lâmpada acesa, aguardando o Noivo que há de chegar."),
 ("o Espírito Santo consola em momentos de luto","Na ausência de quem partiu, o Consolador sustenta minha alma."),
 ("missão de anunciar o evangelho a todas as nações","Envia-nos aos povos distantes para proclamar a boa notícia."),
 ("a fidelidade de Deus quando tudo parece perdido","Mesmo quando a figueira não floresce, minha alegria permanece no Senhor."),
]
DISTRACTORS = [
 "O pastor explicou a programação da reunião de sábado.",
 "O vento e as ondas atrasaram o barco de transporte.",
 "Os filhos chegaram à casa para uma festa de aniversário.",
 "O agricultor preparou a terra e comprou sementes.",
 "A luz da lâmpada foi substituída por uma nova.",
 "A porta da prisão foi pintada durante a reforma.",
 "Os irmãos compraram pão e água para a viagem.",
 "O coral ensaia uma canção em outra tonalidade.",
]
def metrics(scores, labels):
    ranks = []
    for row, label in zip(scores, labels):
        order = sorted(range(len(row)), key=lambda i: (-float(row[i]), i))
        ranks.append(order.index(label) + 1)
    return {"queries": len(ranks), "recall_at_1": sum(r==1 for r in ranks)/len(ranks),
            "recall_at_5": sum(r<=5 for r in ranks)/len(ranks),
            "mrr": sum(1/r for r in ranks)/len(ranks),
            "ndcg_at_10": sum(1/math.log2(r+1) if r<=10 else 0 for r in ranks)/len(ranks),
            "ranks": ranks}

def sha(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()

def normalize(v, dim):
    import numpy as np
    v = np.asarray(v, dtype=np.float32)
    if v.shape != (1, dim) or not np.isfinite(v).all():
        raise ValueError(f"Invalid embedding {v.shape}")
    n = float(np.linalg.norm(v))
    if n < 1e-8:
        raise ValueError("zero embedding")
    return v[0] / n

def encode(session, tok, texts, dim, e5=False):
    import numpy as np
    result, times = [], []
    for text in texts:
        start = time.perf_counter()
        enc = tok.encode(text, add_special_tokens=True)
        ids = np.array([enc.ids], dtype=np.int64)
        mask = np.ones_like(ids)
        inputs = {}
        for item in session.get_inputs():
            if item.name == "input_ids": inputs[item.name] = ids
            elif item.name == "attention_mask": inputs[item.name] = mask
            elif item.name == "position_ids": inputs[item.name] = np.arange(ids.shape[1],dtype=np.int64)[None,:]
            elif item.name == "token_type_ids": inputs[item.name] = np.zeros_like(ids)
            else: raise ValueError("Unsupported input: "+item.name)
        outputs = session.run(None, inputs)
        names = [o.name for o in session.get_outputs()]
        if "sentence_embedding" in names:
            v = outputs[names.index("sentence_embedding")]
        elif "last_hidden_state" in names:
            hidden = outputs[names.index("last_hidden_state")]
            v = hidden.mean(axis=1) if e5 else hidden[:, -1, :]
        elif len(outputs) == 1 and outputs[0].ndim == 3:
            v = outputs[0].mean(axis=1) if e5 else outputs[0][:,-1,:]
        else: raise ValueError("Unknown outputs "+str(names))
        result.append(normalize(v, dim))
        times.append((time.perf_counter()-start)*1000)
    return np.stack(result), times

def run(model, target, variant):
    import numpy as np
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from tokenizers import Tokenizer
    e5 = model == "e5"
    repo, rev = (E5_REPO, E5_REV) if e5 else (REPO, REV)
    graph = "onnx/model_int8.onnx" if e5 else "onnx/model_"+variant+".onnx"
    paths = [graph, "tokenizer.json"] if e5 else [graph, graph+"_data", "tokenizer.json", "tokenizer_config.json", "config.json"]
    manifest = []
    for name in paths:
        path = Path(hf_hub_download(repo, name, revision=rev, local_dir=target))
        size, digest = path.stat().st_size, sha(path)
        if name in FILES and (size,digest)!=FILES[name]:
            raise RuntimeError("Source integrity failure: "+name)
        manifest.append({"path": name, "bytes": size, "sha256": digest})
    tok = Tokenizer.from_file(str(target/"tokenizer.json"))
    tok.enable_truncation(max_length=192)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads=3
    opts.inter_op_num_threads=1
    start = time.perf_counter()
    session = ort.InferenceSession(str(target/graph), sess_options=opts, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter()-start)*1000
    dim = 384 if e5 else 1024
    documents = [d for _, d in CASES] + DISTRACTORS
    queries = [q for q, _ in CASES]
    qtexts = [("query: " if e5 else PROMPT)+q for q in queries]
    dtexts = [("passage: " if e5 else "")+d for d in documents]
    vectors, times = encode(session, tok, qtexts+dtexts, dim, e5)
    scores = vectors[:len(queries)] @ vectors[len(queries):].T
    qtimes = times[1:len(queries)]
    return {"model":model, "variant":variant, "repo":repo,"revision":rev,"dimension":dim,
            "runtime":ort.__version__,"providers":session.get_providers(),
            "inputs":[{"name":i.name,"type":i.type,"shape":i.shape} for i in session.get_inputs()],
            "outputs":[{"name":i.name,"type":i.type,"shape":i.shape} for i in session.get_outputs()],
            "tokenizer_type":json.loads((target/"tokenizer.json").read_text())["model"]["type"],
            "files":manifest,"package_bytes":sum(x["bytes"] for x in manifest),
            "load_ms":load_ms,"first_query_ms":times[0],"median_query_ms":float(np.median(qtimes)),
            "p95_query_ms":float(np.percentile(qtimes,95)), "peak_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "quality":metrics(scores, list(range(len(queries))))}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--model",choices=["e5","harrier"],required=True)
    parser.add_argument("--variant",choices=["q4","q4f16"],default="q4f16")
    parser.add_argument("--directory",type=Path,required=True)
    parser.add_argument("--report",type=Path,required=True)
    args=parser.parse_args()
    args.report.parent.mkdir(parents=True,exist_ok=True)
    try:
        report=run(args.model,args.directory,args.variant)
        report["passed"]=True
        print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
    except Exception as exc:
        report={"model":args.model,"variant":args.variant,"passed":False,"error":str(exc)}
        raise
    finally:
        args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
if __name__=="__main__": main()
