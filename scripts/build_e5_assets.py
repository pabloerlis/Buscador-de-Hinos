#!/usr/bin/env python3
import base64,hashlib,html,json,re,struct,unicodedata,shutil
from html.parser import HTMLParser
from pathlib import Path
import numpy as np,onnxruntime as ort,requests
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer
ROOT=Path(__file__).resolve().parents[1];ASSETS=ROOT/'app/src/main/assets'
REPO='Xenova/multilingual-e5-small';REV='761b726dd34fb83930e26aab4e9ac3899aa1fa78'
SOURCE='https://raw.githubusercontent.com/italozaina/projection-html5-icm/master/data/data.json'
class Markup(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag.lower()=='br':self.parts.append('\n')
 def handle_endtag(self,tag):
  if tag.lower() in ('p','div','li','section','h1','h2','h3','h4','h5','h6'):self.parts.append('\n')
 def handle_data(self,data):self.parts.append(data)
def plain(s):
 p=Markup();p.feed(str(s or '').replace('\\n','\n'))
 return re.sub(r'\n{4,}','\n\n\n',re.sub(r'[ \t]+$','',(''.join(p.parts)).replace('\xa0',' '),flags=re.M)).strip()
def norm(s):
 s=unicodedata.normalize('NFKD',str(s))
 return ' '.join(''.join(c for c in s if unicodedata.category(c)!='Mn').lower().split())
def titleparse(s):
 t=plain(s).replace('\n',' ').strip()
 m=re.match(r'^\s*(?:(?:hino|louvor)\s+)?(\d{1,4})\s*(?:[-–—.:)]\s*|\s+)(.+)$',t,re.I)
 if m:return m.group(1).zfill(3),m.group(2).strip()
 m=re.match(r'^\s*(?:hino\s*)?(\d{1,4})\s*$',t,re.I)
 return (m.group(1).zfill(3) if m else None),t
def main():
 print('Baixando modelo E5 Small quantizado…',flush=True)
 model=hf_hub_download(repo_id=REPO,filename='onnx/model_int8.onnx',revision=REV)
 tokenizer=hf_hub_download(repo_id=REPO,filename='tokenizer.json',revision=REV)
 data=json.loads(Path(tokenizer).read_text(encoding='utf-8'))
 kind=data['model'].get('type','Unigram')
 if kind!='Unigram':raise RuntimeError('Tokenizer inesperado: '+str(kind))
 vocab=data['model']['vocab']
 with (ASSETS/'e5-vocab.bin').open('wb') as f:
  f.write(struct.pack('>I',len(vocab)))
  for i,(piece,score) in enumerate(vocab):
   word=piece.encode('utf-8');f.write(struct.pack('>ifH',i,float(score),len(word)));f.write(word)
 shutil.copyfile(model,ASSETS/'e5-model.onnx')
 raw=requests.get(SOURCE,timeout=120);raw.raise_for_status();groups=raw.json()
 if isinstance(groups,dict):groups=groups.get('collections',groups.get('coletaneas',groups.get('data',[groups])))
 if not isinstance(groups,list):groups=[groups]
 groups=[g for g in groups if isinstance(g,dict) and isinstance(g.get('songs'),list)]
 groups.sort(key=lambda g:0 if 'coletanea 2018' in norm(g.get('name','')) else 1 if 'coletanea' in norm(g.get('name','')) else 2)
 if not groups:raise RuntimeError('JSON sem coleções')
 records=[]
 for s in groups[0]['songs']:
  if not isinstance(s,dict):continue
  n,t=titleparse(s.get('title',s.get('titulo','')));lyric=plain(s.get('content',s.get('letra','')))
  if not t or not lyric:continue
  explicit=s.get('number',s.get('numero'))
  if explicit is not None and str(explicit).isdigit():n=str(explicit).zfill(3)
  sig=hashlib.sha256(norm(t+'|'+lyric).encode('utf-8')).hexdigest()[:24]
  records.append({'id':len(records)+1,'n':n or '', 't':norm(t),'f':sig,'title':t,'lyrics':lyric})
 if len(records)<100:raise RuntimeError('Fonte com poucos hinos')
 print('Hinos:',len(records),'Tokenizer:',len(vocab),flush=True)
 tok=Tokenizer.from_file(str(tokenizer))
 so=ort.SessionOptions();so.intra_op_num_threads=4;so.inter_op_num_threads=1
 session=ort.InferenceSession(str(ASSETS/'e5-model.onnx'),sess_options=so,providers=['CPUExecutionProvider'])
 print('ONNX inputs:',[x.name for x in session.get_inputs()],flush=True)
 passages=[]
 for s in records:
  lines=[x.strip() for x in s['lyrics'].split('\n') if x.strip()]
  passages.extend(['passage: '+s['title']+'. '+' '.join(lines[:12])[:800], 'passage: '+s['title']+'. '+' '.join(lines[-12:])[:800]])
 vectors=[]
 for start in range(0,len(passages),12):
  batch=[tok.encode(x) for x in passages[start:start+12]]
  lengths=[min(192,len(x.ids)) for x in batch]
  w=max(lengths);ids=np.ones((len(batch),w),dtype=np.int64);mask=np.zeros_like(ids)
  for i,item in enumerate(batch):
   l=lengths[i];ids[i,:l]=item.ids[:l];mask[i,:l]=1
   if l<len(item.ids):ids[i,l-1]=2
  inputs={}
  for item in session.get_inputs():
   if item.name=='input_ids':inputs[item.name]=ids
   elif item.name=='attention_mask':inputs[item.name]=mask
   elif item.name=='token_type_ids':inputs[item.name]=np.zeros_like(ids)
   else:raise RuntimeError('ONNX input desconhecida: '+item.name)
  hidden=session.run(None,inputs)[0]
  if hidden.ndim!=3 or hidden.shape[-1]!=384:raise RuntimeError('ONNX output inválido: '+str(hidden.shape))
  v=(hidden*mask[:,:,None]).sum(1)/np.maximum(mask.sum(1)[:,None],1)
  v=v/np.maximum(np.linalg.norm(v,axis=1,keepdims=True),1e-8)
  vectors.extend(v)
  if start%240==0:print('Embeddings:',min(start+12,len(passages)),'/',len(passages),flush=True)
 def pack(v):return base64.b64encode(np.clip(np.rint(v*127),-127,127).astype(np.int8).tobytes()).decode('ascii')
 payload={'version':1,'dimension':384,'count':len(records),'collection':groups[0].get('name',''),
   'model':REPO+'/onnx/model_int8.onnx','source_sha256':hashlib.sha256(raw.content).hexdigest(),
   'records':[{'id':r['id'],'n':r['n'],'t':r['t'],'f':r['f'],'v':[pack(vectors[2*i]),pack(vectors[2*i+1])]}
     for i,r in enumerate(records)]}
 (ASSETS/'e5-index.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf8')
 print('Index pronto:',len(records),'hinos, tamanho',len((ASSETS/'e5-index.json').read_bytes()),flush=True)
if __name__=='__main__':main()
