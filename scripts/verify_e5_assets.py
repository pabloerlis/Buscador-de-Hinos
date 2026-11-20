from pathlib import Path
import json,base64
root=Path(__file__).resolve().parents[1]/'app/src/main/assets'
m=json.loads((root/'e5-index.json').read_text(encoding='utf8'))
assert m['count']==len(m['records']) and m['count']>100
assert m['dimension']==384 and len({(r['id'],r['n'],r['t']) for r in m['records']})==m['count']
for r in m['records']:
 assert len(r['f'])==24 and len(r['v'])==2
 assert all(len(base64.b64decode(x))==384 for x in r['v'])
assert (root/'e5-model.onnx').stat().st_size>100_000_000
assert (root/'e5-vocab.bin').stat().st_size>1_000_000
print('E5 assets verified: '+str(m['count'])+' hymns')
