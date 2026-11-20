#!/usr/bin/env python3
"""Baixa E5-small int8, exporta vocabulário e índices vetoriais de hinos.
Os textos de hinos NÃO são distribuídos: apenas vetores normalizados em int8.
Uso: pip install huggingface_hub tokenizers onnxruntime numpy requests
"""
import base64
import hashlib
import html
import json
import os
import re
import struct
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
import onnxruntime as ort
import requests
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'app/src/main/assets'
ASSETS.mkdir(parents=True,exist_ok=True)
# Fixa a revisão: garante modelo e tokenizer da mesma versão.
REPO='Xenova/multilingual-e5-small'
REVISION='761b726dd34fb83930e26aab4e9ac3899aa1fa78'
SOURCE='https://raw.githubusercontent.com/italozaina/projection-html5-icm/master/data/data.json'

class Markup(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True);self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()=='br':self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag.lower() in ('p','div','li','section','h1','h2','h3','h4','h5','h6'):self.parts.append('\n')
    def handle_data(self,data):self.parts.append(data)

def plain(s):
    s=str(s or '').replace('\\n','\n')
    p=Markup();p.feed(s)
    return re.sub(r'\n{4,}','\n\n\n',re.sub(r'[ \t]+$','',(''.join(p.parts)).replace('\xa0',' '),flags=re.M)).strip()
def normalize(s):
    s=unicodedata.normalize('NFKD',str(s))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return ' '.join(s.lower().split())
def titleparse(raw):
    t=plain(raw).replace('\n',' ').strip()
    m=re.match(r'^\s*(?:(?:hino|louvor)\s+)?(\d{1,4})\s*(?:[-–—.:)]\s*|\s+)(.+)$',t,re.I)
    if m:return m.group(1).zfill(3),m.group(2).strip()
    m=re.match(r'^\s*(?:hino\s*)?(\d{1,4})\s*$',t,re.I)
    return (m.group(1).zfill(3) if m else None),t

def fetch_hymns():
    source=requests.get(SOURCE,timeout=120);source.raise_for_status()
    data=source.json()
    groups=data if isinstance(data,list) else data.get('collections',data.get('coletaneas',data.get('data',[data])))
    if not isinstance(groups,list):groups=[groups]
    # No índice v1.9 usamos apenas essas três edições brasileiras.
    allowed={'Coletânea 2018':'principal','Avulsos 2018':'avulsos','CIA 2018':'cia'}
    selected=[g for g in groups if isinstance(g,dict) and g.get('name') in allowed and isinstance(g.get('songs'),list)]
    if len(selected)!=3:raise RuntimeError('As três coleções esperadas estão ausentes da origem')
    selected.sort(key=lambda g:['Coletânea 2018','Avulsos 2018','CIA 2018'].index(g['name']))
    hymns=[]; exact=set();counts={}; duplicates=0
    for group in selected:
        added=0
        for h in group['songs']:
            if not isinstance(h,dict):continue
            num,title=titleparse(h.get('title',h.get('titulo','')))
            lyrics=plain(h.get('content',h.get('letra','')))
            if not title or not lyrics:continue
            explicit=h.get('number',h.get('numero'))
            if explicit is not None and str(explicit).isdigit(): num=str(explicit).zfill(3)
            key=re.sub(r'[^a-z0-9]+',' ',normalize(lyrics)).strip()
            if len(key)>=75 and key in exact:
                duplicates+=1;continue
            if len(key)>=75:exact.add(key)
            digest=hashlib.sha256(normalize(title+'|'+lyrics).encode('utf-8')).hexdigest()[:24]
            hymns.append({'id':len(hymns)+1,'number':num or '', 'title':title,'lyrics':lyrics,
                          'fingerprint':digest,'collection':allowed[group['name']]})
            added+=1
        counts[group['name']]=added
    if len(hymns)<1400:raise RuntimeError('Menos de 1400 hinos únicos; fonte inesperada')
    print('Coleções integradas:',counts,'duplicatas exatas:',duplicates,flush=True)
    return hymns,counts,hashlib.sha256(source.content).hexdigest()

def generate_vocab(tokenizer_path):
    data=json.loads(Path(tokenizer_path).read_text(encoding='utf-8'))
    model=data['model']; typ=model.get('type','Unigram')
    if typ!='Unigram':raise RuntimeError('Tokenizer incompatible (expected Unigram, got '+str(typ)+')')
    vocab=model['vocab']
    out=ASSETS/'e5-vocab.bin'
    with out.open('wb') as f:
        f.write(struct.pack('>I',len(vocab)))
        for i,(piece,score) in enumerate(vocab):
            word=piece.encode('utf8')
            if len(word)>65535:raise ValueError('Oversized tokenizer piece')
            f.write(struct.pack('>ifH',i,float(score),len(word)))
            f.write(word)
    print('Tokenizer:',typ,len(vocab),'entries',out.stat().st_size,'bytes',flush=True)
    return data

def encode(session,tok,texts,max_tokens=192):
    enc=[tok.encode(s) for s in texts]
    lens=[min(max_tokens,len(x.ids)) for x in enc]
    max_len=max(lens)
    ids=np.full((len(enc),max_len),1,dtype=np.int64)
    mask=np.zeros_like(ids)
    for i,e in enumerate(enc):
        length=lens[i];ids[i,:length]=e.ids[:length];mask[i,:length]=1
        # Quando truncado, deixar eos no final.
        if length<len(e.ids):ids[i,length-1]=2
    inputs={}
    for name in session.get_inputs():
        if name.name=='input_ids':inputs[name.name]=ids
        elif name.name=='attention_mask':inputs[name.name]=mask
        elif name.name=='token_type_ids':inputs[name.name]=np.zeros_like(ids)
        else:raise RuntimeError('Unknown model input '+name.name)
    result=session.run(None,inputs)[0]
    if result.ndim!=3 or result.shape[-1]!=384:raise RuntimeError('E5 output shape unexpected '+str(result.shape))
    v=(result*mask[:,:,None]).sum(axis=1)/np.maximum(mask.sum(axis=1)[:,None],1)
    v=v/np.maximum(np.linalg.norm(v,axis=1,keepdims=True),1e-8)
    return v

def main():
    print('Downloading quantized ONNX model...',flush=True)
    model=Path(hf_hub_download(repo_id=REPO,filename='onnx/model_int8.onnx',revision=REVISION))
    tokenizer=Path(hf_hub_download(repo_id=REPO,filename='tokenizer.json',revision=REVISION))
    tok=Tokenizer.from_file(str(tokenizer))
    data=generate_vocab(tokenizer)
    print('Inputs tokenizer:',list(data.keys()), 'pre-tokenizer:',str(data.get('pre_tokenizer'))[:100],flush=True)
    import shutil
    target=ASSETS/'e5-model.onnx'
    shutil.copyfile(model,target)
    session=ort.InferenceSession(str(target),providers=['CPUExecutionProvider'],sess_options=opt())
    print('Model:',target.stat().st_size,'bytes','inputs',[x.name for x in session.get_inputs()],'outputs',[x.name for x in session.get_outputs()],flush=True)
    hymns,collections,source_digest=fetch_hymns()
    print('Hymns:',len(hymns),'collections:',collections,flush=True)
    # Até dois segmentos por hino, para capturar mensagens em estrofes diferentes.
    passages=[]
    for h in hymns:
        lines=[s.strip() for s in h['lyrics'].split('\n') if s.strip()]
        first=' '.join(lines[:12])[:800]
        last=' '.join(lines[-12:])[:800]
        passages.append('passage: '+h['title']+'. '+first)
        passages.append('passage: '+h['title']+'. '+last)
    vectors=[]
    bs=12
    for i in range(0,len(passages),bs):
        output=encode(session,tok,passages[i:i+bs],max_tokens=192)
        vectors.extend(output)
        if i%240==0:print('Embedded',min(i+bs,len(passages)),'/',len(passages),flush=True)
    records=[]
    for i,h in enumerate(hymns):
        def compress(x):return base64.b64encode(np.clip(np.rint(x*127),-127,127).astype(np.int8).tobytes()).decode('ascii')
        records.append({'id':h['id'],'n':h['number'],'t':normalize(h['title']),'f':h['fingerprint'],'c':h['collection'],
                        'v':[compress(vectors[2*i]),compress(vectors[2*i+1])]})
    payload={'version':2,'model':'Xenova/multilingual-e5-small:onnx/model_int8.onnx','dimension':384,
             'source_sha256':source_digest,'source_url':SOURCE,'collections':collections,'count':len(records),
             'records':records,'score_note':'cosine is not probability'}
    out=ASSETS/'e5-index.json';out.write_text(json.dumps(payload,separators=(',',':'),ensure_ascii=False),encoding='utf8')
    assert len(records)==len(hymns) and all(len(x['v'][0])==512 for x in records)
    print('Generated index',out.stat().st_size,'bytes, model',target.stat().st_size,'bytes',flush=True)
    # Arquivo compacto de diagnóstico e teste das formas de tokenização.
    test=['query: Filho Pródigo','query: Quero voltar para Deus','query: Salmo 23','passage: Voltei pra ti meu Pai']
    expected={'tokenizer_type':'Unigram','test_cases':[{'text':s,'ids':tok.encode(s).ids} for s in test]}
    (ROOT/'tests/e5-tokenizer-cases.json').write_text(json.dumps(expected,ensure_ascii=False,indent=2),encoding='utf8')
    (ASSETS/'e5-source.txt').write_text('Modelo: https://huggingface.co/Xenova/multilingual-e5-small\nBase: https://huggingface.co/intfloat/multilingual-e5-small\nLicença: MIT; ver arquivos do projeto original\n\nEste APK redistribui apenas vetores codificados das três coleções 2018; as letras são importadas pelo usuário no dispositivo.\n',encoding='utf8')

def opt():
    o=ort.SessionOptions();o.intra_op_num_threads=4;o.inter_op_num_threads=1
    o.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return o

if __name__=='__main__':main()
