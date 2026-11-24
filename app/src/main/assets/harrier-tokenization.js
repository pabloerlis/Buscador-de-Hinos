'use strict';
const HarrierTokenization=(()=>{
  function create(json,config){
    if(typeof globalThis.HarrierTokenizerLib?.Tokenizer!=='function')throw Error('Tokenizer local indisponível');
    const tokenizer=new globalThis.HarrierTokenizerLib.Tokenizer(json,config);
    return text=>{
      const ids=tokenizer.encode(String(text),{add_special_tokens:true}).ids;
      if(!Array.isArray(ids)||!ids.length||ids.some(x=>!Number.isInteger(x)||x<0||x>200000))throw Error('Tokens inválidos');
      if(ids.length>192)throw Error('Consulta excede o limite validado de 192 tokens');
      return ids;
    };
  }
  function conform(encode,reference){
    if(!Array.isArray(reference?.fixtures)||reference.fixtures.length!==3)throw Error('Referência de conformidade inválida');
    return reference.fixtures.map((fixture,index)=>{
      const ids=encode(fixture.text);
      if(ids.length!==fixture.ids.length||ids.some((id,i)=>id!==fixture.ids[i]))throw Error('Tokenização divergente no caso '+(index+1));
      return ids;
    });
  }
  return {create,conform};
})();
