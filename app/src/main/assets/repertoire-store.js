'use strict';
/* Repertório local da igreja. A marcação é separada dos dados importados e
 * não afeta os índices nem as letras. A assinatura deriva da letra normalizada,
 * portanto não depende de IDs que possam mudar em novas importações. */
const RepertoireStore=(()=>{
  const STORAGE='hinos-repertoire-v21';
  let keys=new Set(),loaded=false;
  const signatures=new WeakMap();
  function load(){
    if(loaded)return;
    loaded=true;
    try{
      const data=JSON.parse(localStorage.getItem(STORAGE)||'{}');
      if(data.version===1&&Array.isArray(data.notLearned))
        keys=new Set(data.notLearned.filter(k=>typeof k==='string'&&/^[a-z0-9:_-]{4,80}$/.test(k)).slice(0,30000));
    }catch(error){console.warn('Lista de não aprendidos indisponível:',error.message);}
  }
  function fingerprint(song){
    if(!song||typeof song!=='object')throw Error('Hino inválido para marcação.');
    if(signatures.has(song))return signatures.get(song);
    const source=String(song.lyrics||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    let h1=2166136261,h2=0x9e3779b9;
    for(let i=0;i<source.length;i++){
      const c=source.charCodeAt(i);
      h1=Math.imul(h1^c,16777619)>>>0;
      h2=Math.imul(h2^c,2246822519)>>>0;
    }
    const result=source?`l:${source.length.toString(36)}:${h1.toString(36)}:${h2.toString(36)}`:
      `id:${String(song.id||'').replace(/[^0-9]/g,'').slice(0,12)}`;
    signatures.set(song,result);return result;
  }
  function isNotLearned(song){load();return keys.has(fingerprint(song));}
  function mark(song,notLearned){
    load();const key=fingerprint(song),next=new Set(keys);
    if(notLearned)next.add(key);else next.delete(key);
    // Gravar antes de aplicar evita uma marcação visual que não foi salva.
    localStorage.setItem(STORAGE,JSON.stringify({version:1,notLearned:[...next]}));
    keys=next;return {key,not_learned:!!notLearned};
  }
  function marked(hymns){load();return hymns.filter(isNotLearned);}
  return {fingerprint,isNotLearned,mark,marked};
})();
