#!/usr/bin/env python3
"""CPU-path diagnostic: quantized E5 int8 vs uint8, never records lyrics."""
import hashlib,json,os,platform,subprocess
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from huggingface_hub import hf_hub_download

ROOT=Path(__file__).resolve().parents[1]
REVISION='761b726dd34fb83930e26aab4e9ac3899aa1fa78'
REPO='Xenova/multilingual-e5-small'
MODELS={
 'int8':('onnx/model_int8.onnx','4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c'),
 'uint8':('onnx/model_uint8.onnx','ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1'),
}
def sha(b):return hashlib.sha256(b).hexdigest()
def embed(model,tok,queries):
    tok_enc=[tok.encode('query: '+s) for s in queries]
    n=max(len(x.ids) for x in tok_enc)
    ids=np.ones((len(queries),n),dtype=np.int64)
    mask=np.zeros_like(ids)
    for i,x in enumerate(tok_enc):
        ids[i,:len(x.ids)]=x.ids;mask[i,:len(x.ids)]=1
    inp={x.name:({'input_ids':ids,'attention_mask':mask,'token_type_ids':np.zeros_like(ids)})[x.name] for x in model.get_inputs()}
    raw=model.run(None,inp)[0]
    result=(raw*mask[:,:,None]).sum(axis=1)/mask.sum(axis=1)[:,None]
    return result/np.maximum(np.linalg.norm(result,axis=1,keepdims=True),1e-8)

def main():
    queries=json.loads((ROOT/'qa/semantic-paraphrase-queries.json').read_text())['queries']
    tok_file=Path(hf_hub_download(repo_id=REPO,revision=REVISION,filename='tokenizer.json'))
    tok=Tokenizer.from_file(str(tok_file))
    info={'machine':platform.machine(),'processor':platform.processor(),'ort':ort.__version__,'numpy':np.__version__,
        'cpu':str(subprocess.run(['bash','-lc','lscpu | grep -E "Model name:|Vendor ID:|Flags:|Architecture:" | cut -c 1-240'],capture_output=True,text=True).stdout),
        'models':{}}
    for typ,(file,expected) in MODELS.items():
        path=Path(hf_hub_download(repo_id=REPO,revision=REVISION,filename=file))
        assert sha(path.read_bytes())==expected
        opts=ort.SessionOptions()
        opts.intra_op_num_threads=1;opts.inter_op_num_threads=1
        opts.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
        opts.use_deterministic_compute=True
        opts.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.add_session_config_entry('session.x64quantprecision','1')
        m=ort.InferenceSession(str(path),sess_options=opts,providers=['CPUExecutionProvider'])
        x=embed(m,tok,queries)
        x_again=embed(m,tok,queries)
        diff=float(np.max(np.abs(x-x_again)))
        assert diff<=1e-6 and np.isfinite(x).all()
        raw=np.array(x,dtype=np.float32)
        result={
          'model_sha256':expected,
          'float32_sha':sha(raw.tobytes()),
          'fp16_sha':sha(raw.astype(np.float16).tobytes()),
          'rounded6_sha':sha(np.round(raw,6).astype(np.float32).tobytes()),
          'q8_sha':sha(np.clip(np.rint(raw*127),-127,127).astype(np.int8).tobytes()),
          'max_session_delta':diff,
          'query_count':len(queries)
        }
        info['models'][typ]=result
        print('PROBE '+typ+': '+json.dumps(result,sort_keys=True),flush=True)
    dest=ROOT/'qa-report/e5-cpu-profile.json';dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(info,indent=2,ensure_ascii=False)+'\n')
    print('CPU '+info['cpu'],flush=True)

if __name__=='__main__':main()
