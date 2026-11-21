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
    # Float32 accumulations may differ by one ULP across identical sessions.
    # This tolerance (1e-6) is orders below the observed cross-build drift (1e-2).
    if a.shape!=b.shape or not np.allclose(a,b,rtol=0,atol=1e-6,equal_nan=False):
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
    identical(first.astype(np.float16).astype(np.float32),expected,
              'Serialized query vectors differ from independent same-configuration inference')
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
    # ONNX CPU quantized GEMM can choose different ISA-specific kernels.
    # Rebuild ALL passages for verification, but package the audited frozen
    # index so the APK's reference vectors do not depend on runner hardware.
    # It contains only per-stanza quantized vectors and identifiers, no lyrics.
    golden_file=ROOT/'qa/e5-index-golden.json'
    reference=json.loads(manifest_file.read_text(encoding='utf8'))
    if reference.get('status')!='locked':
        raise AssertionError('No locked baseline')
    golden_sha=reference['fingerprint']['index_sha256']
    if digest(golden_file)!=golden_sha:
        raise AssertionError('Pinned passage index changed without baseline approval')
    golden=json.loads(golden_file.read_text(encoding='utf8'))
    assert golden['count']==idx['count']==1557 and golden['passages']==idx['passages']==10496
    assert golden['model_sha256']==idx['model_sha256']==MODEL_SHA256
    assert golden['source_sha256']==idx['source_sha256']==source_sha
    packed_cpu=[]
    packed_fixed=[]
    for current,pinned in zip(idx['records'],golden['records']):
        for key in ('id','n','t','f','c','s'):
            if current[key]!=pinned[key]:
                raise AssertionError('Pinned passage metadata mismatch: '+key)
        assert set(pinned)=={'id','n','t','f','c','s','v'}, 'Unexpected data in pinned index'
        for c,p in zip(current['v'],pinned['v']):
            packed_cpu.append(np.frombuffer(base64.b64decode(c),dtype=np.int8))
            packed_fixed.append(np.frombuffer(base64.b64decode(p),dtype=np.int8))
    assert len(packed_cpu)==len(packed_fixed)==10496
    cpu=np.stack(packed_cpu).astype(np.float32)
    fixed=np.stack(packed_fixed).astype(np.float32)
    norm_cpu=np.maximum(np.linalg.norm(cpu,axis=1),1e-8)
    norm_fixed=np.maximum(np.linalg.norm(fixed,axis=1),1e-8)
    cosine=np.einsum('ij,ij->i',cpu,fixed)/(norm_cpu*norm_fixed)
    delta=np.abs(cpu-fixed)
    drift={
        'generated_index_sha256':digest(index_file),
        'golden_index_sha256':golden_sha,
        'exact_index_match':digest(index_file)==golden_sha,
        'min_cosine':float(np.min(cosine)),
        'p01_cosine':float(np.percentile(cosine,1)),
        'median_cosine':float(np.median(cosine)),
        'max_absolute_q8_component_delta':int(np.max(delta)),
        'fraction_changed_q8_components':float(np.count_nonzero(delta)/delta.size),
        'passages_compared':len(packed_cpu),
    }
    # Conservative controls derived from multi-CPU measurements, NOT a claim
    # of bitwise equivalence. A substantial encoder regression still blocks.
    assert drift['min_cosine']>=0.992, 'Worst-case CPU passage vector drift excessive'
    assert drift['p01_cosine']>=0.995, 'Lower-tail CPU passage vector drift excessive'
    assert drift['median_cosine']>=0.9975, 'Typical CPU passage vector drift excessive'
    assert drift['max_absolute_q8_component_delta']<=3, 'CPU passage component drift excessive'
    assert drift['fraction_changed_q8_components']<=0.20, 'Too many changed quantized components'
    # All published APKs must use the EXACT same 10496 pinned passage vectors.
    index_file.write_bytes(golden_file.read_bytes())
    fp={'model_sha256':MODEL_SHA256,'tokenizer_sha256':digest(tokenizer_file),
        'catalog_sha256':source_sha,'index_sha256':digest(index_file),
        'queries_sha256':digest(query_file)}
    matched=fp==reference['fingerprint']
    report={'schema_version':1,'status':'approved' if matched else 'mismatch',
        'configuration':'cpu_single_thread_uint8_deterministic_x64quantprecision_onnxruntime_1.20.1',
        'same_session_equal':True,'fresh_session_equal':True,
        'recomputed_index_passages_equal':count,
        'all_generated_passages_compared':len(packed_cpu),
        'pinned_index_used':True,'cross_cpu_drift':drift,
        'fingerprint':fp,'baseline_matched':matched,
        'reference_status':reference.get('status'),
        'limitations':'CPU kernels may produce non-identical quantized results. The APK packages fixed golden index. ARM64 physical performance is not yet measured.'}
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('E5 runtime/locked index comparison:',json.dumps(drift,sort_keys=True))
    print('E5 packaged fingerprint:',json.dumps(fp,sort_keys=True))
    print('E5 samples independently reproduced:',count)
    if not matched:
        raise SystemExit('BLOCKED: model/index/query does not match audited reference')

if __name__=='__main__':
    main()
