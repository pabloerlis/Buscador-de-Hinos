'use strict';
/* E5 multilíngue offline — até oito trechos distribuídos por hino.
 * Vetores int8 quantizados e intervalos de linhas; nenhuma letra é embutida
 * no índice. A consulta é codificada pelo mesmo E5 no próprio aparelho.
 * Similaridade de cosseno NÃO representa certeza nem probabilidade.
 */
const VectorIndex=(()=>{
  let source=null,vectors=new Map(),count=0,error='',passageCount=0;
  const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  function dot(a,b){let d=0;for(let i=0;i<384;i++)d+=a[i]*b[i];return d;}
  function parse(encoded){
    const bytes=atob(encoded);
    if(bytes.length!==384)throw Error('Vetor E5 inválido');
    const v=new Float32Array(384);let n=0;
    for(let i=0;i<384;i++){v[i]=(bytes.charCodeAt(i)<<24>>24)/127;n+=v[i]*v[i];}
    const factor=1/Math.sqrt(Math.max(n,1e-10));
    for(let i=0;i<384;i++)v[i]*=factor;
    return v;
  }
  async function fingerprint(h){
    if(!globalThis.crypto?.subtle||typeof TextEncoder==='undefined')return null;
    const data=new TextEncoder().encode(norm(h.title+'|'+h.lyrics));
    const hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,24);
  }
  async function configure(hymns){
    vectors=new Map();count=0;passageCount=0;error='';
    if(!source){
      try{
        const response=await fetch('e5-index.json');
        if(!response.ok)throw Error('Índice vetorial não instalado');
        source=await response.json();
        if(source.dimension!==384||!Array.isArray(source.records)||![2,3].includes(source.version))
          throw Error('Índice E5 incompatível');
      }catch(ex){error=ex.message;return status();}
    }
    const candidates=new Map();
    for(const r of source.records)if(!candidates.has(r.f))candidates.set(r.f,r);
    for(let i=0;i<hymns.length;i++){
      const h=hymns[i],sha=await fingerprint(h);
      if(!sha)continue;
      const record=candidates.get(sha);
      if(!record||record.t!==norm(h.title))continue;
      try{
        if(!Array.isArray(record.v)||!record.v.length||record.v.length>12)
          throw Error('Número de passagens E5 inválido');
        const ranges=Array.isArray(record.s)&&record.s.length===record.v.length?record.s:[];
        const entries=record.v.map((encoded,j)=>{
          const range=ranges[j];
          const valid=Array.isArray(range)&&range.length===2&&range.every(Number.isInteger)&&
            range[0]>=0&&range[1]>range[0]&&range[1]<=1000;
          return {vector:parse(encoded),range:valid?range:null};
        });
        vectors.set(h.id,entries);count++;passageCount+=entries.length;
      }catch(ex){error=ex.message;}
      if(i%75===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(hymns.length&&!count)error='Nenhum hino corresponde ao índice vetorial; a pesquisa textual permanece ativa.';
    else if(count<hymns.length)error=(hymns.length-count)+' hinos sem vetores E5; ainda pesquisáveis por texto e temas.';
    return status();
  }
  function status(){
    return {ready:count>0,count,passages:passageCount,source_count:source?.count||0,
      error,model:'multilingual-e5-small / 384D / int8',
      mode:source?.version===3?'trechos distribuídos':'início e fim'};
  }
  function checkQuery(v){return Array.isArray(v)&&v.length===384&&v.every(x=>typeof x==='number'&&Number.isFinite(x));}
  function normalizedQuery(v){
    if(!checkQuery(v))return null;
    const vec=Float32Array.from(v);let norm2=0;
    for(const x of vec)norm2+=x*x;
    if(norm2<0.01)return null;
    const scale=1/Math.sqrt(norm2);
    for(let i=0;i<384;i++)vec[i]*=scale;
    return vec;
  }
  function bestSegment(segments,vec){
    let best=null,similarity=-2;
    for(const entry of segments){
      const score=dot(entry.vector,vec);
      if(score>similarity){similarity=score;best=entry;}
    }
    return {similarity,range:best?.range||null};
  }
  function topForQuery(v,limit=80){
    const vec=normalizedQuery(v);
    if(!vec||!count)return [];
    return Array.from(vectors.entries(),([id,segments])=>{
      const best=bestSegment(segments,vec);
      return {id,similarity:best.similarity,range:best.range};
    }).sort((a,b)=>b.similarity-a.similarity).slice(0,limit);
  }
  function topForHymn(id,limit=60){
    const anchor=vectors.get(Number(id));if(!anchor)return [];
    const results=[];
    for(const [other,segments] of vectors){
      if(other===Number(id))continue;
      let s=-1;
      for(const a of anchor)for(const b of segments)s=Math.max(s,dot(a.vector,b.vector));
      results.push({id:other,similarity:s});
    }
    return results.sort((a,b)=>b.similarity-a.similarity).slice(0,limit);
  }
  function passageForSong(song,range){
    if(!song||!Array.isArray(range)||range.length!==2)return '';
    const lines=String(song.lyrics||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const [start,end]=range;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>lines.length)return '';
    return lines.slice(start,end).join(' ').slice(0,480).trim();
  }
  function percent(sim){return Math.max(0,Math.min(100,Math.round((sim-.68)/.27*100)));}
  return {configure,status,topForQuery,topForHymn,passageForSong,percent,checkQuery};
})();
