'use strict';
/* Conversão determinística texto -> entradas ONNX do Laya.
 * REQUER tokenizer HF real; não aceita tokens approximados.
 * API compatível com @huggingface/tokenizers 0.2.0 (pure JS, sem backend remoto).
 */
(function(root,make){
  const api=make();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.TelepatiaSequence=api;
})(typeof window==='object'?window:null,function(){
  const LABELS=Object.freeze(['contradiction','entailment','neutral']);
  const CRITERIA=Object.freeze({
    contradiction:'O texto fornece evidências de que a hipótese é falsa.',
    entailment:'O texto fornece evidências suficientes para confirmar a hipótese.',
    neutral:'O texto não fornece evidências suficientes para confirmar ou contradizer.'
  });
  const INS_PREFIX='Leia integralmente o texto e avalie a relação lógica com esta hipótese: ';
  function tokenName(tok,property,alternate){
    const cfg=tok.config||{};
    const value=cfg[property]||cfg[alternate];
    const name=typeof value==='string'?value:value&&typeof value.content==='string'?value.content:null;
    if(!name)throw Error('Configuração do tokenizador sem '+property+'.');
    return name;
  }
  function tokenId(tok,name){
    const k=tok.token_to_id(name);
    if(!Number.isInteger(k)||k<0)throw Error('Tokenizador incompatível: token especial '+name+' ausente.');
    return k;
  }
  const encode=(tok,text)=>tok.encode(text,{add_special_tokens:false}).ids;
  function serializeState(state){
    // Python laya.common.serialize_state: json.dumps({"state": state},ensure_ascii=False)
    return '{"state": '+JSON.stringify(state)+'}';
  }
  function sequence(tok,state,hypothesis,{maxLen=512,headMaxLen=192,maxWindows=10}={}){
    if(typeof state!=='string'||typeof hypothesis!=='string'||!state.trim()||!hypothesis.trim())
      throw Error('Estado e hipótese não podem estar vazios.');
    if(state.length>12000||hypothesis.length>450)throw Error('Texto excede o limite do classificador.');
    if(maxLen<128||maxLen>8192||headMaxLen<64||headMaxLen>=maxLen)
      throw Error('Configuração de tokens incompatível.');
    const clsName=tokenName(tok,'cls_token','bos_token');
    const sepName=tokenName(tok,'sep_token','eos_token');
    const maskName=tokenName(tok,'mask_token');
    const cls=tokenId(tok,clsName),sep=tokenId(tok,sepName),mask=tokenId(tok,maskName);
    const instructions=INS_PREFIX+hypothesis;
    const header=encode(tok,'choice question: '+instructions.replaceAll(maskName,' '));
    const opts=LABELS.map(label=>{
      const option=' '+label+': '+CRITERIA[label];
      return [mask,...encode(tok,option.replaceAll(maskName,' ')).slice(0,48)];
    });
    let budget=headMaxLen-opts.reduce((sum,ids)=>sum+ids.length,0);
    if(budget<16){
      const per=Math.max(4,Math.floor((headMaxLen-16)/opts.length));
      for(let i=0;i<opts.length;i++)opts[i]=opts[i].slice(0,per);
      budget=headMaxLen-opts.reduce((sum,ids)=>sum+ids.length,0);
    }
    const head=[cls,...header.slice(0,Math.max(8,budget)),sep];
    const markers=[];
    for(const arr of opts){markers.push(head.length);head.push(...arr);}
    head.push(sep);
    if(new Set(opts.map(x=>x.join(','))).size!==3)
      throw Error('As alternativas NLI colidiram após a redução de tokens.');
    const capacity=maxLen-head.length-1;
    if(capacity<24)throw Error('Pergunta consumiu o espaço disponível para a letra.');
    const source=encode(tok,serializeState(state.replaceAll(maskName,' ')));
    const stride=Math.max(1,Math.floor(capacity*0.72));
    const result=[];
    for(let start=0;start<source.length;start+=stride){
      const part=source.slice(start,start+capacity);
      result.push({
        input_ids:[...head,...part,sep],
        marker_pos:markers.slice(),
        marker_mask:[true,true,true],
        qtype:0,
        start_token:start,
        state_tokens:source.length,
        state_tokens_used:part.length
      });
      if(start+capacity>=source.length)break;
      if(result.length>=maxWindows)throw Error('A letra excede a cobertura máxima das janelas; não será classificada parcialmente.');
    }
    if(!result.length)throw Error('Tokenização vazia.');
    return result;
  }
  return {LABELS,CRITERIA,INS_PREFIX,serializeState,sequence};
});