from pathlib import Path
import base64,json,hashlib
root=Path(__file__).resolve().parents[1]
assets=root/'app/src/main/assets'
a=json.loads((assets/'e5-index.json').read_text())
assert a['version']==2 and a['dimension']==384 and a['count']>1400
assert {'Coletânea 2018','Avulsos 2018','CIA 2018'}==set(a['collections'])
assert len(a['records'])==a['count']
assert len({x['f'] for x in a['records']})==a['count']
for record in a['records']:
    assert len(record['f'])==24
    assert len(record['v'])==2
    assert all(len(base64.b64decode(x))==384 for x in record['v'])
model=assets/'e5-model.onnx';vocab=assets/'e5-vocab.bin'
assert model.stat().st_size>100_000_000
assert vocab.stat().st_size>1_000_000
print('E5-small asset validation:',a['count'],'hymns,',model.stat().st_size,'model bytes,',vocab.stat().st_size,'vocab bytes')
