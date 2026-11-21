#!/usr/bin/env python3
"""QA independente de embeddings E5: cobertura, proveniência e não redistribuição de letras."""
from pathlib import Path
import base64
import hashlib
import json
import sys

BASE=Path(__file__).resolve().parents[1]
ASSETS=BASE/'app/src/main/assets'
index=json.loads((ASSETS/'e5-index.json').read_text(encoding='utf-8'))
source=(ASSETS/'e5-source.txt').read_text(encoding='utf-8')
model=(ASSETS/'e5-model.onnx')
vocab=(ASSETS/'e5-vocab.bin')
issues=[]
def check(ok,msg):
    if not ok:issues.append(msg)

check(index.get('version')==3,'Versão de índice E5 incorreta')
check(index.get('dimension')==384,'Dimensão E5 incompatível')
check(index.get('model_sha256')=='ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1','Hash do modelo não fixado')
check(index.get('count')>=1500,'Cobertura de hinos insuficiente')
check(index.get('passages',0)>=4000,'Trechos E5 insuficientes (não indexa estrofes)')
check(index.get('source_url','').find('/da8e75932982123301affce688e45b4152c9e06e/')>0,'Coletânea sem revisão fixada')
check('MIT' in source and 'huggingface' in source.lower(),'Atribuição E5 ausente')
check(model.exists() and model.stat().st_size>100_000_000,'Modelo ONNX ausente')
check(vocab.exists() and vocab.stat().st_size>1_000_000,'Tokenizer E5 ausente')
if model.exists():
    check(hashlib.sha256(model.read_bytes()).hexdigest()==index.get('model_sha256'),'Modelo E5 não corresponde ao SHA fixado')
rows=index.get('records') or []
check(len(rows)==index.get('count'),'Quantidade de registros divergente')
check(sum(len(x.get('v',[])) for x in rows)==index.get('passages'),'Contagem de passagens divergente')
seen=set()
for item in rows:
    fingerprint=item.get('f')
    check(isinstance(fingerprint,str) and len(fingerprint)==24 and fingerprint not in seen,'Fingerprint duplicado ou inválido')
    seen.add(fingerprint)
    check('lyrics' not in item and 'content' not in item and 'snippet' not in item,'Letras no índice')
    spans=item.get('s') or []
    v=item.get('v') or []
    check(1<=len(v)<=8 and len(v)==len(spans),'Passagens sem correspondência 1:1')
    for encoded,span in zip(v,spans):
        try:check(len(base64.b64decode(encoded,validate=True))==384,'Vetor quantizado não tem 384 dimensões')
        except Exception:issues.append('Vetor base64 inválido')
        check(isinstance(span,list) and len(span)==2 and
              all(isinstance(x,int) for x in span) and 0<=span[0]<span[1]<=1000,'Janela de letra inválida')

# Cobertura longitudinal: não basta trocar o título da técnica mantendo apenas início/fim.
long=[r for r in rows if len(r.get('s',[]))>=5]
check(len(long)>400,'Poucos hinos receberam cobertura distribuída')
if issues:
    print('AGENTE E5 — REPROVADO')
    for i in sorted(set(issues))[:30]:print('  -',i)
    sys.exit(1)
print('AGENTE E5 — APROVADO:',len(rows),'hinos,',index['passages'],
      'trechos,',len(long),'hinos com pelo menos cinco janelas.')
