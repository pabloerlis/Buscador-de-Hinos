'use strict';
/* Expressões curadas → temas comprováveis na letra. A consulta sozinha nunca
 * prova que um hino possui um tema: SemanticEngine.evaluate verifica o perfil.
 */
const BridgeEngine = (()=>{
  const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const has=(q,t)=>new RegExp('(?:^|[^a-z0-9])'+escape(norm(t))+'(?=$|[^a-z0-9])').test(q);
  function create(data,labels){
    if(!data||data.schema_version!==1||!Array.isArray(data.entries)||data.entries.length>120)throw Error('Ponte lexical inválida');
    const byId=new Map(labels.map(t=>[t.id,t.label]));
    const entries=data.entries.map(e=>{
      if(!Array.isArray(e.phrases)||!Array.isArray(e.topics))throw Error('Registro lexical incorreto');
      if(e.topics.some(id=>!byId.has(id)))throw Error('Tema lexical não reconhecido');
      return {phrases:e.phrases.map(norm),topics:e.topics};
    });
    function interpret(query){
      const q=norm(query),topics=new Map(),aliases=[];
      for(const entry of entries){
        const matched=entry.phrases.filter(x=>x&&has(q,x));if(!matched.length)continue;
        aliases.push(matched[0]);
        for(const [i,id] of entry.topics.entries())if(!topics.has(id))topics.set(id,{id,label:byId.get(id),why:'expressão “'+matched[0]+'”',weight:1-i*.16});
      }
      return {topics:[...topics.values()].slice(0,7),aliases:aliases.slice(0,3)};
    }
    return {revision:data.revision,entries:entries.length,interpret};
  }
  return {create};
})();
