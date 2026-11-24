'use strict';
/* Independent reader for a verified external Harrier package. It is not enabled
   in the search pipeline until the Android model/tokenizer pass conformance. */
const HarrierIndex=(()=>{
  const DIM=1024,SCHEMA='harrier-hymn-index-v1';
  const REPO='onnx-community/harrier-oss-v1-0.6b-ONNX';
  const REV='dbaf6767003608562dd5b744bc443656a29c45bd';
  const VARIANT='q4f16',CATALOG='da8e75932982123301affce688e45b4152c9e06e';
  const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  async function digest(text){
    if(!globalThis.crypto?.subtle)throw Error('Verificação SHA-256 indisponível');
    const bytes=new TextEncoder().encode(text);
    const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
  }
  const fingerprint=async hymn=>(await digest(norm(hymn.title+'|'+hymn.lyrics))).slice(0,24);
  function decode(encoded){
    if(typeof encoded!=='string'||encoded.length!==1368||!/^[A-Za-z0-9+/]{1366}==$/.test(encoded))
      throw Error('Vetor Harrier codificado inválido');
    const bytes=atob(encoded);
    if(bytes.length!==DIM)throw Error('Dimensão Harrier incorreta');
    const vector=new Float32Array(DIM);
    let sq=0;
    for(let i=0;i<DIM;i++){
      const v=bytes.charCodeAt(i)<<24>>24;
      if(v===-128)throw Error('Quantização simétrica inválida');
      vector[i]=v;sq+=v*v;
    }
    if(!sq)throw Error('Vetor Harrier nulo');
    const scale=1/Math.sqrt(sq);
    for(let i=0;i<DIM;i++)vector[i]*=scale;
    return vector;
  }
  function dot(a,b){
    let sum=0;
    for(let i=0;i<DIM;i++)sum+=a[i]*b[i];
    return Math.max(-1,Math.min(1,sum));
  }
  function normalizeQuery(v){
    if(!Array.isArray(v)||v.length!==DIM||!v.every(x=>typeof x==='number'&&Number.isFinite(x)))
      return null;
    const sq=v.reduce((sum,x)=>sum+x*x,0);
    if(!Number.isFinite(sq)||sq<1e-12)return null;
    return Float32Array.from(v,x=>x/Math.sqrt(sq));
  }
  const limitCount=n=>Math.max(0,Math.min(1000,Math.trunc(Number(n)||0)));
  async function open(manifest,indexText){
    const model=manifest?.model,meta=manifest?.index;
    if(manifest?.schema!==SCHEMA||model?.repo!==REPO||model.revision!==REV||model.variant!==VARIANT||
       model.dimension!==DIM||model.runtime!=='1.31.1'||model.pooling!=='sentence_embedding'||model.normalization!=='L2'||
       manifest.catalog?.revision!==CATALOG)throw Error('Manifesto Harrier incompatível');
    if(typeof indexText!=='string'||!Number.isInteger(meta?.bytes)||meta.bytes<1||meta.bytes>20_000_000||
       new TextEncoder().encode(indexText).length!==meta.bytes||!/^[0-9a-f]{64}$/.test(meta.sha256||'')||
       await digest(indexText)!==meta.sha256)throw Error('Integridade do índice Harrier inválida');
    const source=JSON.parse(indexText);
    if(source.schema!==SCHEMA||source.model!==REPO||source.revision!==REV||source.variant!==VARIANT||
       source.dimension!==DIM||source.quantization!=='symmetric-int8-l2-renormalize'||
       source.catalog_revision!==CATALOG||source.catalog_sha256!==manifest.catalog.sha256||
       !/^[0-9a-f]{64}$/.test(source.catalog_sha256)||!Array.isArray(source.records)||
       !Number.isInteger(source.count)||source.count<1||source.count>6000||
       source.count!==source.records.length||source.count!==meta.count)
      throw Error('Índice Harrier incompatível');
    const records=new Map();let segmentCount=0;
    for(const record of source.records){
      if(!record||Object.keys(record).sort().join(',')!=='f,v'||!/^[0-9a-f]{24}$/.test(record.f)||
         records.has(record.f)||!Array.isArray(record.v)||record.v.length<1||record.v.length>2)
        throw Error('Registro Harrier inválido');
      records.set(record.f,record.v.map(decode));segmentCount+=record.v.length;
    }
    if(segmentCount!==meta.segments)throw Error('Contagem de segmentos incompatível');
    let vectors=new Map(),generation=0,total=0;
    async function attach(hymns){
      const run=++generation, next=new Map();
      for(const h of hymns){
        if(!Number.isInteger(h.id)||!h.title||!h.lyrics)continue;
        const matching=records.get(await fingerprint(h));
        if(matching)next.set(h.id,matching);
      }
      if(run===generation){vectors=next;total=hymns.length;}
      return status();
    }
    function status(){return {ready:vectors.size>0,count:vectors.size,total,source_count:records.size,dimension:DIM,
      model:'Harrier 600M Q4F16',revision:REV};}
    function topForQuery(value,limit=100){
      const q=normalizeQuery(value);
      if(!q)return [];
      return Array.from(vectors,([id,segments])=>({id,similarity:Math.max(...segments.map(v=>dot(v,q)))}))
        .sort((a,b)=>b.similarity-a.similarity||a.id-b.id).slice(0,limitCount(limit));
    }
    function topForHymn(id,limit=60){
      const anchor=vectors.get(Number(id));if(!anchor)return [];
      return Array.from(vectors).filter(([other])=>other!==Number(id)).map(([other,segments])=>{
        let similarity=-1;for(const a of anchor)for(const b of segments)similarity=Math.max(similarity,dot(a,b));
        return {id:other,similarity};
      }).sort((a,b)=>b.similarity-a.similarity||a.id-b.id).slice(0,limitCount(limit));
    }
    return {attach,status,checkQuery:v=>!!normalizeQuery(v),topForQuery,topForHymn};
  }
  return {open,fingerprint};
})();
