#!/usr/bin/env python3
"""Audit an external Telepatia NLI ONNX export against upstream Laya prediction.

The original model is pinned to the *same* HuggingFace revision used in the
historic 31-case experiment. No copyrighted lyrics, model weights or inference
output are committed into the application.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

MODEL = "telepatia-ai/laya-pt-es-nli"
REVISION = "71459abd38f4e439b2f4e3a2dae87573ae40c77e"
LABELS = ("contradiction", "entailment", "neutral")
FIELDS = ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype")
FIXTURES = (
    ("Um gato dorme no sofá.", "Um animal está dormindo."),
    ("O menino deixou a casa e voltou arrependido para o pai.", "O menino retornou à família."),
    ("A menina entrou na escola.", "A menina está numa praia."),
    ("Uma pessoa estava enferma e recebeu a cura.", "A pessoa ficou curada."),
)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(8 << 20), b""):
            h.update(data)
    return h.hexdigest()


def audit(model_dir: Path, bundle: Path, report: Path):
    import numpy as np
    import onnxruntime as ort
    import torch
    import laya
    from transformers import AutoTokenizer
    from laya.common import build_sequence, collate_items, QTYPES

    model_file = bundle / "model.onnx"
    sidecar = bundle / "model.onnx.data"
    tok_dir = bundle / "tokenizer"
    cfg_file = bundle / "rl_agent_config.json"
    for path in (model_file, sidecar, tok_dir / "tokenizer.json", cfg_file):
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Exported file missing or empty: {path}")

    with cfg_file.open(encoding="utf-8") as handle:
        cfg = json.load(handle)
    if cfg.get("max_len", 512) < 128:
        raise RuntimeError("Model max_len unexpectedly low")
    tokenizer = AutoTokenizer.from_pretrained(tok_dir, local_files_only=True)
    agent = laya.load(str(model_dir), device="cpu")
    opt = ort.SessionOptions()
    opt.intra_op_num_threads = min(4, os.cpu_count() or 2)
    opt.inter_op_num_threads = 1
    sess = ort.InferenceSession(str(model_file), opt, providers=["CPUExecutionProvider"])
    expected_inputs = set(FIELDS)
    if {input.name for input in sess.get_inputs()} != expected_inputs:
        raise RuntimeError("ONNX input contract differs from Laya")
    if "logits" not in {output.name for output in sess.get_outputs()}:
        raise RuntimeError("ONNX output missing logits")

    output = []
    for state, hypothesis in FIXTURES:
        criteria = {
            "contradiction": "O texto fornece evidências de que a hipótese é falsa.",
            "entailment": "O texto fornece evidências suficientes para confirmar a hipótese.",
            "neutral": "O texto não fornece evidências suficientes para confirmar ou contradizer.",
        }
        instructions = "Leia integralmente o texto e avalie a relação lógica com esta hipótese: " + hypothesis
        questions = {"relation": {"type": "choice", "instructions": instructions, "criteria": criteria}}
        t = time.perf_counter()
        predicted = agent.predict({"state": state}, questions, max_len=512)
        public = predicted["answers"]["relation"]
        if isinstance(public, dict):
            public = public["choice"]
        if public not in LABELS:
            raise RuntimeError(f"Unrecognized Laya answer {public!r}")
        internal = {"t": "choice", "ins": instructions, "crit": criteria}
        ids, markers, stats = build_sequence(
            tokenizer, {"state": state}, internal,
            cfg.get("max_len", 512), cfg.get("head_max_len", 192),
            return_stats=True,
        )
        if stats["options_distinct"] != 3 or len(markers) != 3:
            raise RuntimeError("NLI choices truncated/collided")
        if len(ids) > cfg.get("max_len", 512):
            raise RuntimeError("Token budget exceeded")
        batch = collate_items([[{"ids": ids, "markers": markers, "qtype": QTYPES["choice"]}]], tokenizer.pad_token_id)
        feed = {k:batch[k].cpu().numpy() for k in FIELDS}
        dtypes = {"tensor(int64)": np.int64, "tensor(int32)": np.int32, "tensor(bool)": np.bool_}
        byname = {i.name:i for i in sess.get_inputs()}
        feed = {k:np.asarray(feed[k],dtype=dtypes[byname[k].type]) for k in FIELDS}
        logits = sess.run(["logits"], feed)[0]
        if logits.shape != (1, 3):
            raise RuntimeError(f"Unexpected ONNX logits shape: {logits.shape}")
        if not np.isfinite(logits).all():
            raise RuntimeError("NaN or infinity in ONNX logits")
        onnx_label = LABELS[int(logits[0].argmax())]
        if onnx_label != public:
            raise RuntimeError(f"PyTorch/ONNX NLI decision mismatch {public} != {onnx_label}")
        output.append({"fixture":len(output)+1,"input_tokens":len(ids),
                       "pytorch_label":public,"onnx_label":onnx_label,
                       "onnx_ms_including_pytorch":round((time.perf_counter()-t)*1000,2)})
        print(f"PARITY_CASE {len(output)} PASS: label={public}, tokens={len(ids)}",flush=True)

    manifest = {
        "schema_version":1,"status":"verified","model":MODEL,"revision":REVISION,
        "target":"external_onnx_no_apk_weights","runtime":"ONNX Runtime CPU",
        "model_sha256":sha256(model_dir/"model.safetensors"),
        "onnx_sha256":sha256(model_file),
        "sidecar_sha256":sha256(sidecar),
        "tokenizer_sha256":sha256(tok_dir/"tokenizer.json"),
        "model_bytes":model_file.stat().st_size,
        "weights_bytes":sidecar.stat().st_size,
        "labels":list(LABELS),
        "parity_cases":output,
        "limitations":[
            "This is a CPU model-export parity gate, not an Android device inference test.",
            "The exported model is not quantized and may be too large for phones with little free RAM.",
            "An Android tokenizer/sequence-builder implementation must match Laya before deployment.",
            "Do not interpret NLI logits as calibrated probabilities for hino relevance.",
            "No copyrighted lyrics or GGUF are included in the export.",
        ],
    }
    report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("EXPORT_PARITY_PASS",report,flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--checkpoint",required=True,type=Path)
    p.add_argument("--bundle",required=True,type=Path)
    p.add_argument("--report",default=Path("qa-report/telepatia-onnx-export-manifest.json"),type=Path)
    args=p.parse_args()
    audit(args.checkpoint,args.bundle,args.report)
