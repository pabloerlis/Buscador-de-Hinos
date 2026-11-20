'use strict';
const VectorIndex=(()=>{
 let source=null,vectors=new Map(),count=0,error='';
 const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
 function dot(a,b){let n=0;for(let i=0;i<384;i++)n+=a[i]*b[i];return n;}
 function parse(s){const raw=atob(s);if(raw.length!==384)throw Error('Vetor E5 inválido');
   const v=new Float32Array(384);let norm=0;for(let i=0;i<384;i++){v[i]=(raw.charCodeAt(i)<<24>>24)/127;norm+=v[i]*v[i];}
   const scale=1/Math.sqrt(Math.max(1e-12,norm));for(let i=0;i<384;i++)v[i]*=scale;return v;}
 async function fingerprint(h){if(!globalThis.crypto?.subtle||typeof TextEncoder==='undefined')return null;
   const data=new TextEncoder().encode(norm(h.title+'|'+h.lyrics));
   return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);}
 async function configure(hymns){
   vectors=new Map();count=0;error='';
   if(!source){try{const r=await fetch('e5-index.json');if(!r.ok)throw Error('Índice E5 ausente');
       source=await r.json();if(source.dimension!==384||!Array.isArray(source.records))throw Error('Formato de índice E5 inválido');
     }catch(e){error=e.message;return status();}}
   const lookup=new Map(source.records.map(r=>[r.id+'|'+r.n+'|'+r.t,r]));
   for(let i=0;i<hymns.length;i++){const h=hymns[i],r=lookup.get(h.id+'|'+(h.number||'')+'|'+norm(h.title));if(!r)continue;
     const f=await fingerprint(h);if(!f||r.f!==f)continue;
     try{vectors.set(h.id,r.v.map(parse));count++;}catch(e){error=e.message;}
     if(i%75===0)await new Promise(resolve=>setTimeout(resolve,0));}
   if(hymns.length&&count<hymns.length*.85){error='Coletânea diferente da edição indexada ('+count+'/'+hymns.length+').';vectors.clear();count=0;}
   return status();
 }
 function status(){return {ready:count>0,count,error,source_count:source?.count||0};}
 function checkQuery(v){return Array.isArray(v)&&v.length===384&&v.every(x=>typeof x==='number'&&Number.isFinite(x));}
 function topForQuery(v,limit=80){if(!checkQuery(v)||!count)return [];const q=Float32Array.from(v);let norm=0;for(const x of q)norm+=x*x;if(norm<.01)return [];
   const scale=1/Math.sqrt(norm);for(let i=0;i<384;i++)q[i]*=scale;
   return [...vectors.entries()].map(([id,vs])=>({id,similarity:Math.max(...vs.map(x=>dot(x,q)))})).sort((a,b)=>b.similarity-a.similarity).slice(0,limit);}
 function topForHymn(id,limit=60){const anchor=vectors.get(Number(id));if(!anchor)return [];
   return [...vectors.entries()].filter(([other])=>other!==Number(id)).map(([other,vecs])=>{
     let s=-1;for(const a of anchor)for(const b of vecs)s=Math.max(s,dot(a,b));return {id:other,similarity:s};
   }).sort((a,b)=>b.similarity-a.similarity).slice(0,limit);}
 const percent=x=>Math.max(0,Math.min(100,Math.round((x-.68)/.27*100)));
 return {configure,status,checkQuery,topForQuery,topForHymn,percent};
})();