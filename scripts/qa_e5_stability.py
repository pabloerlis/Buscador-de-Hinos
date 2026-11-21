#!/usr/bin/env python3
"""Fail-closed ONNX reproducibility audit (no lyrics stored or printed).

The baseline fingerprint must be pinned after an independent diagnostic run.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build_e5_assets import ASSETS, MODEL_SHA256, REPO, REVISION, encode, opt, fetch_hymns, passage_spans

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def identical(a,b,message):
    if a.shape!=b.shape or not np.array_equal(a,b):
        diff=float(np.max(np.abs(a-b))) if a.shape==b.shape else None
        raise AssertionError(message+'; max_difference='+str(diff))

def main():
    model=ASSETS/'e5-model.onnx'
    index_file=ASSETS/'e5-index.json'
    query_file=ROOT/'qa-report/e5-paraphrase-vectors.json'
    manifest_file=ROOT/'qa/e5-stability-reference.json'
    output=ROOT/'qa-report/e5-stability.json'
    assert digest(model)==MODEL_SHA256, 'E5 model not pinned'
    idx=json.loads(index_file.read_text(encoding='utf8'))
    queries=json.loads(query_file.read_text(encoding='utf8'))
    assert idx['passages']==10496 and idx['count']==1557
    assert len(queries['queries'])==12 and queries['source_kind']=='actual_e5_onnx_inference'
    tokenizer_file=Path(hf_hub_download(repo_id=REPO,revision=REVISION,filename='tokenizer.json'))
    tokenizer=Tokenizer.from_file(str(tokenizer_file))
    src=['query: '+q['query'] for q in queries['queries']]
    expected=np.asarray([q['vector'] for q in queries['queries']],dtype=np.float32)
    session=ort.InferenceSession(str(model),sess_options=opt(),providers=['CPUExecutionProvider'])
    first=encode(session,tokenizer,src,max_tokens=96)
    identical(first,expected,'Query vectors differ from independent same-configuration inference')
    identical(first,encode(session,tokenizer,src,max_tokens=96),'Queries changed within one session')
    other=ort.InferenceSession(str(model),sess_options=opt(),providers=['CPUExecutionProvider'])
    identical(first,encode(other,tokenizer,src,max_tokens=96),'Queries changed between independent sessions')
    # Reconstruct only fixed 16-passage batches in CI memory. Do not write text to disk.
    hymns,_,source_sha=fetch_hymns()
    assert source_sha==idx['source_sha256'], 'Catalog different from generated index'
    texts=[]
    records=[]
    for h,record in zip(hymns,idx['records']):
        spans=passage_spans(h['lyrics'],max_segments=8)
        assert spans==[tuple(s) for s in record['s']], 'Passage boundary mismatch'
        lines=[line.strip() for line in h['lyrics'].split('\n') if line.strip()]
        texts.extend('passage: '+' '.join(lines[a:b])[:750] for a,b in spans)
        records.extend(record['v'])
    assert len(texts)==len(records)==10496
    starts=sorted({0,(len(texts)//4//16)*16,(len(texts)//2//16)*16,((len(texts)-1)//16)*16})
    count=0
    for start in starts:
        end=min(start+16,len(texts))
        result=encode(other,tokenizer,texts[start:end],max_tokens=160)
        actual=[np.clip(np.rint(vec*127),-127,127).astype(np.int8).tobytes() for vec in result]
        expected_bytes=[base64.b64decode(v) for v in records[start:end]]
        if actual!=expected_bytes:
            raise AssertionError('Generated index does not reproduce at batch '+str(start))
        count+=len(actual)
    fp={'model_sha256':MODEL_SHA256,'tokenizer_sha256':digest(tokenizer_file),
        'catalog_sha256':source_sha,'index_sha256':digest(index_file),
        'queries_sha256':digest(query_file)}
    expected_reference=json.loads(manifest_file.read_text(encoding='utf8'))
    locked=expected_reference.get('status')=='locked'
    matched=locked and fp==expected_reference.get('fingerprint')
    report={'schema_version':1,'status':'approved' if matched else 'unlocked_or_mismatch',
        'configuration':'cpu_single_thread_deterministic_onnxruntime_1.20.1',
        'same_session_equal':True,'fresh_session_equal':True,
        'recomputed_index_passages_equal':count,
        'fingerprint':fp,'baseline_matched':matched,
        'reference_status':expected_reference.get('status'),
        'limitations':'CPU reproducibility test only; ARM64 physical performance is not measured'}
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('E5 fingerprint:',json.dumps(fp,sort_keys=True))
    print('E5 samples independently reproduced:',count)
    if not matched:
        raise SystemExit('BLOCKED: fingerprint has not matched a frozen, cross-build verified reference')

if __name__=='__main__':
    main()
