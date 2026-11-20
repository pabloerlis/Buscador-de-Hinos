'use strict';
/* Busca E5 Small offline: passage embeddings precomputados, query inferida localmente.
 * Os cossenos NÃO são probabilidades. Apenas registros com a mesma impressão digital
 * da fonte recebem vetores, evitando usar índices de outra edição da coletânea.
 */
const VectorIndex=(()=>{
  let source=null, vectors=new Map(),count=0,error='';
  const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const maxCos=(a,b)=>Math.max(...a.map(x=>dot(x,b)));
  function dot(a,b){let d=0;for(let i=0;i<384;i++)d+=a[i]*b[i];return d;}
  function parse(encoded){
    const bytes=atob(encoded);if(bytes.length!==384)throw Error('Vetor E5 inválido');
    const v=new Float32Array(384);let n=0;
    for(let i=0;i<384;i++){v[i]=(bytes.charCodeAt(i)<<24>>24)/127;n+=v[i]*v[i];}
    const factor=1/Math.sqrt(Math.max(n,1e-10));for(let i=0;i<384;i++)v[i]*=factor;
    return v;
  }
  async function fingerprint(h){
    if(!globalThis.crypto?.subtle||typeof TextEncoder==='undefined')return null;
    const data=new TextEncoder().encode(norm(h.title+'|'+h.lyrics));
    const hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,24);
  }
  async function configure(hymns){
    vectors=new Map();count=0;error='';
    if(!source){try{
        const response=await fetch('e5-index.json');
        if(!response.ok)throw Error('Índice vetorial não instalado');
        source=await response.json();
        if(source.dimension!==384||!Array.isArray(source.records))throw Error('Índice E5 incompatível');
      }catch(ex){error=ex.message;return status();}}
    const candidates=new Map();
    for(const r of source.records)if(!candidates.has(r.f))candidates.set(r.f,r);
    for(let i=0;i<hymns.length;i++){
      const h=hymns[i];
      const sha=await fingerprint(h);
      if(!sha)continue;
      const record=candidates.get(sha);
      if(!record||record.t!==norm(h.title))continue;
      try{vectors.set(h.id,record.v.map(parse));count++;}catch(ex){error=ex.message;}
      if(i%75===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(hymns.length && !count)error='Nenhum hino corresponde exatamente ao índice pré-calculado; a pesquisa textual permanece ativa.';
    else if(count<hymns.length)error=(hymns.length-count)+' hinos sem vetores E5 (pesquisáveis por texto e temas).';
    return status();
  }
  function status(){return {ready:count>0,count,source_count:source?.count||0,error,model:'multilingual-e5-small / 384D / int8'};}
  function checkQuery(v){return Array.isArray(v)&&v.length===384&&v.every(x=>typeof x==='number'&&Number.isFinite(x));}
  function topForQuery(v,limit=80){
    if(!checkQuery(v)||!count)return [];
    const vec=Float32Array.from(v);let norm2=0;for(const x of vec)norm2+=x*x;
    if(norm2<0.01)return [];
    const scale=1/Math.sqrt(norm2);for(let i=0;i<384;i++)vec[i]*=scale;
    return Array.from(vectors.entries(),([id,segments])=>({id,similarity:maxCos(segments,vec)}))
      .sort((a,b)=>b.similarity-a.similarity).slice(0,limit);
  }
  function topForHymn(id,limit=60){
    const anchor=vectors.get(Number(id));if(!anchor)return [];
    const results=[];
    for(const [other,segments] of vectors){
      if(other===Number(id))continue;
      let s=-1;
      for(const a of anchor)for(const b of segments)s=Math.max(s,dot(a,b));
      results.push({id:other,similarity:s});
    }
    return results.sort((a,b)=>b.similarity-a.similarity).slice(0,limit);
  }
  function percent(sim){return Math.max(0,Math.min(100,Math.round((sim-.68)/.27*100)));}
  return {configure,status,topForQuery,topForHymn,percent,checkQuery};
})();
