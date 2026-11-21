#!/usr/bin/env python3
"""Create Android instrumentation-only ONNX query canary from actual CI vectors.
The file is packaged into androidTest APK ONLY, never app release APK.
"""
import hashlib
import math
import json
from pathlib import Path
import sys

source=Path(sys.argv[1])
dest=Path(sys.argv[2])
data=json.loads(source.read_text(encoding='utf8'))
assert data['source_kind']=='actual_e5_onnx_inference'
assert data['vector_serialization']=='onnx_float32_to_float16_to_float32_canonical'
assert data['model_sha256']=='ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1'
assert len(data['queries'])==12
query=data['queries'][0]
assert query['query']=='Uma mulher enferma tocou nas vestes de Jesus e foi curada'
vec=query['vector']
assert len(vec)==384 and all(isinstance(x,(int,float)) and math.isfinite(x) for x in vec)
packed=bytes(max(-127,min(127,round(x*127)))&255 for x in vec)
sha=hashlib.sha256(packed).hexdigest()
assert sha=='555bda01cdc0f22dcc4864d75303562e5f7cbb539530aeabc476218b5f0eb26d'
payload={'schema_version':1,'source':'actual_pinned_e5_onnx_inference',
         'model_sha256':data['model_sha256'],'query':query['query'],
         'expected_q8_sha256':sha,'vector':query['vector']}
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
print('Android canary: actual 384D ONNX vector, SHA verified, instrumentation assets only')
