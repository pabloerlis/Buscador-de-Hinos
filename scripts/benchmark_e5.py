#!/usr/bin/env python3
"""Benchmark verificável de recuperação E5 por trechos no catálogo completo.

Avalia hinos rotulados para diferentes narrativas; não treina o encoder e
não grava letras em logs ou artefatos. Métricas iniciais são exploratórias:
o ranking híbrido final tem sua própria regressão separada.
"""
from pathlib import Path
import base64
import json
import sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'app/src/main/assets'
sys.path.insert(0,str(ROOT/'scripts'))
from build_e5_assets import encode, opt

index=json.loads((ASSETS/'e5-index.json').read_text(encoding='utf-8'))
rows=index['records']
vectors=[]
owner=[]
for i,r in enumerate(rows):
    for encoded in r['v']:
        v=np.frombuffer(base64.b64decode(encoded),dtype=np.int8).astype(np.float32)/127
        v/=max(np.linalg.norm(v),1e-8)
        vectors.append(v)
        owner.append(i)
matrix=np.stack(vectors).astype(np.float32)
owner=np.asarray(owner)
model=ort.InferenceSession(str(ASSETS/'e5-model.onnx'),sess_options=opt(),providers=['CPUExecutionProvider'])
tok=Tokenizer.from_file(str(Path(__import__('huggingface_hub').hf_hub_download(
    repo_id='Xenova/multilingual-e5-small',filename='tokenizer.json',
    revision='761b726dd34fb83930e26aab4e9ac3899aa1fa78'))))
cases=[
    ('tocar nas vestes de Jesus buscando cura pela fé',('principal','374')),
    ('alguém tocou o mestre entre a multidão e saiu virtude',('principal','261')),
    ('o pastor procurou uma ovelha que se perdeu',('principal','259')),
    ('meu irmão morreu e foi chamado para sair do túmulo',('principal','704')),
    ('vento e ondas agitavam o barco até Jesus acalmar',('principal','310')),
    ('um homem cego clamava no caminho pelo filho de Davi',('cia','062')),
    ('filho arrependido voltou ao pai que o perdoou',('principal','286'))
]
queries=['query: '+q for q,_ in cases]
embedded=encode(model,tok,queries,max_tokens=96)
output=[]
for query,expected in zip(embedded,cases):
    sim=matrix@query
    # Cosseno máximo entre até oito estrofes do mesmo hino.
    scores=np.full(len(rows),-1.,dtype=np.float32)
    np.maximum.at(scores,owner,sim)
    ranks=np.argsort(-scores,kind='stable')
    label=(expected[1][0],expected[1][1])
    def ident(i):
        item=rows[int(i)]
        return item.get('c'),str(item.get('n') or '').zfill(3)
    found=next((pos+1 for pos,i in enumerate(ranks) if ident(i)==label),None)
    output.append({'consulta':expected[0],'alvo_colecao':label[0],
                   'alvo_numero':label[1],'posicao':found,
                   'top5':[{'colecao':rows[int(i)].get('c'),'numero':rows[int(i)].get('n'),
                            'sim':round(float(scores[int(i)]),4)} for i in ranks[:5]]})
recall_at_20=sum(x['posicao'] is not None and x['posicao']<=20 for x in output)/len(output)
recall_at_100=sum(x['posicao'] is not None and x['posicao']<=100 for x in output)/len(output)
report={'schema_version':1,'model':index['model'],'catalog_count':len(rows),
        'passage_count':len(vectors),'cases':output,
        'vector_recall_at_20':recall_at_20,'vector_recall_at_100':recall_at_100}
dest=ROOT/'qa-report/e5-metrics.json'
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Queries vetorizadas pelo modelo real para teste do ranking híbrido JS.
(ROOT/'qa-report/e5-query-vectors.json').write_text(json.dumps([
    {'query':case[0],'collection':case[1][0],'number':case[1][1],
     'vector':vector.tolist()} for case,vector in zip(cases,embedded)
],ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print('E5 por estrofes:',len(rows),'hinos,',len(vectors),'passagens')
for x in output:
    print(f"  {x['consulta']}: esperado {x['alvo_colecao']}:{x['alvo_numero']} rank={x['posicao']}")
print('Recall@20 (vetor isolado):',round(recall_at_20,3),
      'Recall@100:',round(recall_at_100,3))
# Teste mínimo de utilidade da recuperação neural (não de relevância perfeita).
if recall_at_100 < 0.35:
    raise SystemExit('AGENTE E5: embeddings não recuperam casos básicos (Recall@100<0.35)')
print('AGENTE E5 — RECUPERAÇÃO APROVADA. Ranking final continua híbrido.')
