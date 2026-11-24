'use strict';
// A group is a single synset. Do not follow broader/narrower relations or chain groups.
const LexicalPT=(()=>{
  function normalize(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function create(data){
    if(data?.schema_version!==1||data.source!=='OpenWordnet-PT 1.0.0'||!Array.isArray(data.groups))throw Error('Base lexical inválida.');
    const index=new Map();
    for(const group of data.groups){
      if(!Array.isArray(group)||group.length<2||group.some(word=>typeof word!=='string'||!word||word!==normalize(word)))throw Error('Grupo lexical inválido.');
      for(const term of group){
        if(!index.has(term))index.set(term,[]);
        index.get(term).push(group);
      }
    }
    return {terms:index.size,groups:data.groups.length,synonyms(value){
      const key=normalize(value);
      return [...new Set((index.get(key)||[]).flat().filter(word=>word!==key))].sort();
    }};
  }
  return {create};
})();
