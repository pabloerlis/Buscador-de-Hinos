#!/usr/bin/env python3
"""E5 real para TODAS as paráfrases: somente QA, não é um modelo novo do APK.

Proíbe comparações sem vetor e nunca grava letras de hinos.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from huggingface_hub import hf_hub_download
from build_e5_assets import encode, opt, REPO, REVISION, MODEL_SHA256

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'qa/semantic-paraphrase-queries.json'
data=json.loads(source.read_text(encoding='utf-8'))
queries=data['queries']
assert data['schema_version']==1 and data['human_review_status']=='pending'
assert len(queries)==12 and all(isinstance(q,str) and len(q)>20 for q in queries)
assert len(set(queries))==12, 'Consultas de paráfrases repetidas'
model_path=ROOT/'app/src/main/assets/e5-model.onnx'
assert hashlib.sha256(model_path.read_bytes()).hexdigest()==MODEL_SHA256, 'E5 diferente do modelo pinado'
model=ort.InferenceSession(str(model_path),sess_options=opt(),providers=['CPUExecutionProvider'])
tokenizer_path=Path(hf_hub_download(repo_id=REPO,filename='tokenizer.json',revision=REVISION))
tokenizer=Tokenizer.from_file(str(tokenizer_path))
vectors=encode(model,tokenizer,['query: '+q for q in queries],max_tokens=96)
assert vectors.shape==(12,384) and np.isfinite(vectors).all(), 'Vetor E5 inválido'
norms=np.linalg.norm(vectors,axis=1)
assert np.all((norms>.97)&(norms<1.03)), 'Norma E5 inválida'
# Canonicalize harmless ~1 ULP CPU differences without changing ranking semantics.
# All 12 vectors remain outputs of real, same-revision ONNX inference.
canonical=vectors.astype(np.float16).astype(np.float32)
assert np.max(np.abs(canonical-vectors))<3e-4, 'Float16 canonicalization changed meaning unexpectedly'
report={
    'schema_version':1,
    'vector_serialization':'onnx_float32_to_float16_to_float32_canonical',
    'source_kind':'actual_e5_onnx_inference',
    'human_review_status':'pending',
    'model_sha256':MODEL_SHA256,
    'tokenizer_revision':REVISION,
    'tokenizer_sha256':hashlib.sha256(tokenizer_path.read_bytes()).hexdigest(),
    'queries':[{'query':q,'vector':v.tolist()} for q,v in zip(queries,canonical)],
}
dest=ROOT/'qa-report/e5-paraphrase-vectors.json'
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(report,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print('QA E5 paráfrases: 12/12 vetores reais, 384 dimensões, revisão humana pendente')
