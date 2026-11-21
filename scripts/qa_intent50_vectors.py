#!/usr/bin/env python3
"""Produce authentic ONNX E5 vectors for 50 distinct unjudged semantic intents.
QA artifacts only. Do not write hymn lyrics or include vectors in the APK.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from huggingface_hub import hf_hub_download
from build_e5_assets import encode, opt, REPO, REVISION, MODEL_SHA256

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "qa/semantic-intents-50.json"
raw = source.read_bytes()
manifest = json.loads(raw)
rows = manifest["intents"]
assert manifest["schema_version"] == 1 and manifest["human_review_status"] == "pending"
assert manifest["authoring_status"] == "draft_unjudged"
assert len(rows) == manifest["intent_count"] == 50
assert len({r["id"] for r in rows}) == 50
assert len({r["query"].casefold().strip() for r in rows}) == 50
assert sum(r["category"] == "biblical_event" for r in rows) == 25
assert sum(r["category"] == "thematic" for r in rows) == 25
assert sum(r["split"] == "holdout" for r in rows) >= 15
model_path = ROOT / "app/src/main/assets/e5-model.onnx"
assert hashlib.sha256(model_path.read_bytes()).hexdigest() == MODEL_SHA256
tokenizer_path = Path(hf_hub_download(repo_id=REPO, filename="tokenizer.json", revision=REVISION))
tokenizer = Tokenizer.from_file(str(tokenizer_path))
session = ort.InferenceSession(str(model_path), sess_options=opt(), providers=["CPUExecutionProvider"])
vectors = encode(session, tokenizer, ["query: " + r["query"] for r in rows], max_tokens=96)
assert vectors.shape == (50, 384) and np.isfinite(vectors).all()
norms = np.linalg.norm(vectors, axis=1)
assert np.all((norms > .97) & (norms < 1.03))
canonical = vectors.astype(np.float16).astype(np.float32)
assert np.max(np.abs(canonical - vectors)) < 3e-4
report = {
    "schema_version": 1, "source_kind": "actual_e5_onnx_inference",
    "review_status": "pending", "manifest_sha256": hashlib.sha256(raw).hexdigest(),
    "model_sha256": MODEL_SHA256, "tokenizer_revision": REVISION,
    "tokenizer_sha256": hashlib.sha256(tokenizer_path.read_bytes()).hexdigest(),
    "vectors": [{"id": r["id"], "vector": v.tolist()} for r, v in zip(rows, canonical)]
}
out = ROOT / "qa-report/intent50-vectors.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print("E5 50/50 real queries x 384 dimensions; no human relevance labels")
