'use strict';

const LocalHymnAI = (() => {
  const MAX_CANDIDATES = 5;
  const MAX_PICKS = 2;
  const COMPARISON_TIMEOUT_MS = 20000;
  const MAX_THEME_OPTIONS = 8;
  const LOOKUP_CHARACTERS = 'A-Za-zÀ-ÖØ-öø-ÿ ';
  const invalidLookupCharacter = new RegExp(`[^${LOOKUP_CHARACTERS}]`);
  const clip = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const promptText = (value, limit) => clip(value, limit).replace(/["\\\u0000-\u001f\uD800-\uDFFF]/gu, ' ');
  const diagnostic = {
    prompt: 'Responda apenas OK.',
    grammar: 'root ::= "OK"',
    maxTokens: 4,
    timeoutMs: 20000
  };

  function prepareComparison(query, exclusions, hymns, context, lookup = null) {
    const candidates = new Map();
    for (const hymn of hymns) {
      const { id } = hymn;
      const excerpt = clip(hymn.snippet, 72);
      if (!Number.isSafeInteger(id) || id < 1 || candidates.has(id) || !excerpt || excerpt === 'Nenhum trecho disponível') continue;
      candidates.set(id, {
        id,
        title: clip(hymn.title, 70),
        number: hymn.number,
        collection: hymn.collection,
        excerpt,
        matchType: hymn.match_type
      });
      if (candidates.size === MAX_CANDIDATES) break;
    }
    const direct = [...candidates.values()].filter(hymn =>
      ['acontecimento','referencia_biblica','narrativa'].includes(hymn.matchType));
    if (direct.length) {
      candidates.clear();
      for (const hymn of direct) candidates.set(hymn.id, hymn);
    }

    const canLookup = lookup === null;
    const lookupRequired = canLookup && !candidates.size;
    const instructions = lookupRequired
      ? 'Sem candidatos. Responda com termos alternativos no formato {"buscar_hinos":"termos"}.'
      : 'Escolha até dois IDs cujo trecho sustenta o pedido. Responda com uma lista de IDs ou [].';
    const prompt = [
      instructions,
      canLookup && !lookupRequired && 'Se precisar, peça uma busca com {"buscar_hinos":"termos"}.',
      'Pedido: '+promptText(query, 100),
      exclusions.length && 'Excluir: '+exclusions.slice(0, 2).map(x=>promptText(x, 24)).join(', '),
      context?.reference && 'Ref.: '+promptText(context.reference, 30),
      context?.reference && context?.passage && promptText(context.passage, 54),
      candidates.size && 'ID | trecho',
      ...[...candidates.values()].map(hymn=>hymn.id+' | '+promptText(hymn.excerpt, 72))
    ].filter(Boolean).join('\n');
    const grammar = [
      'root ::= '+(lookupRequired?'lookup':canLookup?'picks | lookup':'picks'),
      ...(lookupRequired ? [] : [candidates.size ? 'picks ::= "[" ws (hymn-id (ws "," ws hymn-id)?)? ws "]"' : 'picks ::= "[]"']),
      ...(candidates.size ? ['hymn-id ::= ' + [...candidates.keys()].map(id=>JSON.stringify(String(id))).join(' | ')] : []),
      ...(canLookup ? [
        String.raw`lookup ::= "{" ws "\"buscar_hinos\"" ws ":" ws "\"" lookup-text "\"" ws "}"`,
        `lookup-text ::= [${LOOKUP_CHARACTERS}]{3,64}`
      ] : []),
      'ws ::= " "?'
    ].join('\n');
    return { prompt, grammar, maxTokens: canLookup ? 36 : 18, timeoutMs: COMPARISON_TIMEOUT_MS, candidates, canLookup, lookupRequired };
  }

  function readComparison(response, { candidates, canLookup, lookupRequired }) {
    const picks = JSON.parse(response);
    if (canLookup && picks && Object.keys(picks).length === 1 && typeof picks.buscar_hinos === 'string') {
      const raw = picks.buscar_hinos;
      const term = raw.trim().replace(/ +/g, ' ');
      if (term.length >= 3 && raw.length <= 64 && !invalidLookupCharacter.test(raw)) return { lookup: term };
      throw Error('A busca complementar recebeu termos inválidos.');
    }
    if (lookupRequired || !Array.isArray(picks) || picks.length > MAX_PICKS) throw Error('Formato de comparação inválido.');

    const seen = new Set();
    return { picks: picks.map(id => {
      const hymn = candidates.get(id);
      if (!hymn || seen.has(id)) throw Error('A comparação contém um ID inválido.');
      seen.add(id);
      return hymn;
    }) };
  }

  function mergeCandidates(original, additional) {
    const ids = new Set(original.map(hymn => hymn.id));
    const extra = [];
    const limit = Math.max(2,MAX_CANDIDATES-original.length);
    for (const hymn of additional) {
      if (ids.has(hymn.id) || !String(hymn.snippet||'').trim()) continue;
      ids.add(hymn.id);
      extra.push(hymn);
      if (extra.length===limit) break;
    }
    return { added: extra.length, hymns: [...original.slice(0,MAX_CANDIDATES-extra.length),...extra] };
  }

  function prepareThemes(query, exclusions, labels, timeoutMs, preferred = []) {
    const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const canonical = new Map(labels.map(label=>[normalize(label),label]));
    const shortlist = [...new Set(preferred.map(label=>canonical.get(normalize(label))).filter(Boolean))]
      .slice(0, MAX_THEME_OPTIONS);
    const options = shortlist.length ? shortlist : labels;
    if (!options.length) return null;
    const input = [
      'Escolha até quatro IDs de temas ligados ao pedido. Responda com a lista de IDs ou [].',
      'Pedido: '+promptText(query, 120),
      exclusions.length && 'Excluir: '+exclusions.slice(0, 2).map(x=>promptText(x, 24)).join(', '),
      options.map((label,i)=>(i+1)+':'+promptText(label, 32)).join(' ')
    ].filter(Boolean).join('\n');
    return {
      prompt: input,
      grammar: [
        'root ::= "[" ws (theme (ws "," ws theme){0,3})? ws "]"',
        'theme ::= ' + options.map((_,i) => JSON.stringify(String(i+1))).join(' | '),
        'ws ::= " "?'
      ].join('\n'),
      maxTokens: 24,
      timeoutMs,
      themeLabels: options.slice()
    };
  }

  const REVIEW_LIMIT = 4;
  const REVIEW_TIMEOUT_MS = 30000;
  const reviewLabels = { D: 'Encaixe direto', I: 'Encaixe direto não identificado' };

  function reviewPassages(snippet, lyrics) {
    const stanzas = String(lyrics||'').split(/\r?\n[ \t]*\r?\n+/)
      .map(stanza=>stanza.split(/\r?\n/).map(line=>clip(line, 100)).filter(Boolean))
      .filter(lines=>lines.length);
    if (!stanzas.length) return [];
    const key = text => text.normalize('NFC').toLocaleLowerCase('pt-BR');
    const lineHint = clip(String(snippet||'').split(/\s+\/\s+/)[0], 45);
    const hint = key(lineHint);
    const match = hint.length>=6 ? stanzas.findIndex(lines=>lines.some(line=>key(line).includes(hint))) : -1;
    const lines = stanzas[Math.max(0, match)];
    const anchor = match<0 ? 0 : lines.findIndex(line=>key(line).includes(hint));
    const excerpt = clip(lines.slice(Math.max(0, anchor-1), anchor+2).join(' / '), 150);
    const alternatives = [stanzas.at(-1), stanzas[0]].filter(stanza=>stanza!==lines)
      .map(stanza=>clip(stanza.join(' / '), 75));
    const second = alternatives.find(text=>!key(excerpt).includes(key(text)));
    return second ? [excerpt, second] : [excerpt];
  }

  function prepareReview(query, lyricsById, hymns, {exclude=[], required=[], context}={}) {
    const candidates = hymns.slice(0, REVIEW_LIMIT).map(hymn=>({
      id: hymn.id, excerpts: reviewPassages(hymn.snippet, lyricsById.get(hymn.id))
    }));
    if (candidates.length!==REVIEW_LIMIT || candidates.some(item=>!item.excerpts.length) ||
        new Set(candidates.map(item=>item.id)).size!==REVIEW_LIMIT) return null;
    const subject = promptText(context?.narrative || query, 145).replace(/[.!?]+$/, '');
    const requests = candidates.map(candidate=>{
      const excerpt = candidate.excerpts.join(' / ');
      const prompt = [
        'Este trecho fala especificamente de '+subject+'? Responda sim ou não.',
        exclude.length && 'Exclua: '+promptText(exclude.join(', '), 65),
        required.length && 'Obrigatório: '+promptText(required.join(', '), 65),
        'Trecho: '+promptText(excerpt, 228)
      ].filter(Boolean).join('\n');
      return { prompt, candidate, grammar:'root ::= "sim" | "não"', maxTokens:5 };
    });
    return { requests, timeoutMs:REVIEW_TIMEOUT_MS };
  }

  function readReview(response, candidate) {
    if (response!=='sim' && response!=='não') throw Error('Resposta de revisão inválida.');
    const grade = response==='sim'?'D':'I';
    return {id:candidate.id, grade, label:reviewLabels[grade],
      excerpt:grade==='D'?candidate.excerpts.join(' / '):''};
  }

  function applyReview(hymns, judgments) {
    if (!judgments.every(({id},i)=>hymns[i]?.id===id)) return null;
    if (!judgments.some(({grade})=>grade==='D')) return hymns;
    const priority = {D:1,I:0};
    const reviewed = judgments.map((review,i)=>({...hymns[i],aiReview:review}));
    reviewed.sort((a,b)=>priority[b.aiReview.grade]-priority[a.aiReview.grade]);
    return [...reviewed,...hymns.slice(reviewed.length)];
  }

  const CHAT_MESSAGE_LIMIT=1000;
  const CHAT_TEXT=String.raw`A-Za-zÀ-ÖØ-öø-ÿ0-9 .,:;!?()/'’–\-`;
  const invalidChatText=new RegExp('[^'+CHAT_TEXT+']');
  const preferenceQuestions={
    clima:'Você prefere hinos mais alegres ou mais solenes?',
    ritmo:'Você prefere hinos mais animados ou mais tranquilos?',
    tema:'Qual tema você quer enfatizar? Há algum tema que prefere evitar?',
    ocasiao:'Para qual momento do culto você está escolhendo os hinos?',
    hino:'Qual hino você quer manter ou mudar? Pode me dizer o número ou o título.'
  };

  function chatSearchRequest(message,history=[],viaButton=false) {
    const text=message.trim();
    const command=text.match(/(?:^|[.!?]\s+)(?:(?:por favor|agora|pode|voc[eê] pode|quero(?: que(?: voc[eê])?)?)[,\s]+){0,2}(?:bus(?:car|ca|que)|pesquis(?:ar|a|e)|procur(?:ar|a|e)|encontr(?:ar|e|a)|(?:me\s+)?(?:mostre|sugira|proponha|recomende|indique)(?=\s+(?:hinos|louvores|op[cç][õo]es)\b))(?:\s+|[:,.!?]+(?:\s+|$)|$)/iu);
    if(!command&&!viaButton)return null;
    const query=(command?text.slice(command.index+command[0].length):text)
      .replace(/^(?:por|sobre)\s+/iu,'').replace(/^(?:o|a)\s+(?=(?:hino|louvor)\s+\d)/iu,'').replace(/\s*[,;]?\s+por favor[.!?]*$/iu,'').replace(/[.!?]+$/u,'').trim();
    if(!viaButton&&/^(?:mais tarde|depois|amanh[ãa]|quando eu (?:pedir|disser))\b/iu.test(query))return null;
    if(query&&!/^(?:(?:alguns?|mais|outros?)\s+)?(?:hinos|louvores|op[cç][õo]es)(?:\s+(?:assim|agora))?$|^(?:agora|mais|isso|por favor|na colet[âa]nea|no cat[áa]logo)$/iu.test(query))
      return {query,refine:/^(?:s[oó]|somente|apenas|sem|mais|menos|agora|tamb[eé]m)\s+/iu.test(query)};
    const beforeCommand=command?text.slice(0,command.index).trim():'';
    const preferences=history.filter(item=>item.kind==='user'&&item.intent==='conversation').map(item=>item.text);
    if(beforeCommand)preferences.push(beforeCommand);
    const recent=preferences.map(item=>item.replace(/^(?:prefiro|quero|gostaria de|[eé] para)\s+/iu,''))
      .filter(item=>item.length>=5&&!/^(?:ol[aá]|obrigad[oa]|tudo bem|sim|n[aã]o)[.!?]*$/iu.test(item)).slice(-3);
    const context=recent.reverse().join(' · ');
    return {query:context.slice(0,500),refine:false,context:context.slice(0,CHAT_MESSAGE_LIMIT)};
  }

  function prepareChat({query,message,history=[],shown=[],found=[],constraints,editIntent,explaining=false,pick=false,forced=null,asked=[],scripture=null}) {
    const candidates=new Map();
    const addRow=(hymn,inList)=>{
      if(!Number.isSafeInteger(hymn.id)||[...candidates.values()].some(item=>item.id===hymn.id))return;
      candidates.set(candidates.size+1,{...hymn,inList});
    };
    shown.slice(0,message.length>500?3:6).forEach(hymn=>addRow(hymn,true));
    found.slice(0,3).forEach(hymn=>addRow(hymn,false));
    const positions=predicate=>[...candidates].filter(([,h])=>predicate(h)).map(([position])=>position);
    const editKeys={
      acrescentar:positions(h=>!h.inList),
      retirar:positions(h=>h.inList),
      destacar:positions(h=>h.inList)
    };
    const forcedPosition=forced&&[...candidates].find(([,hymn])=>hymn.id===forced.id)?.[0];
    if(forcedPosition&&forced.verb in editKeys)editKeys[forced.verb]=[forcedPosition];

    const questions=Object.keys(preferenceQuestions).filter(key=>!asked.includes(key));
    const rules=['falar ::= '+JSON.stringify('["falar",')+' text "]"'];
    if(questions.length){
      rules.push('perguntar ::= '+JSON.stringify('["perguntar",')+' preference "]"');
      rules.push('preference ::= '+questions.map(key=>JSON.stringify(JSON.stringify(key))).join(' | '));
    }
    for(const [verb,keys] of Object.entries(editKeys)){
      if(!keys.length)continue;
      rules.push(verb+' ::= '+JSON.stringify('["'+verb+'",')+' '+verb+'-position "]"');
      rules.push(verb+'-position ::= '+keys.map(key=>JSON.stringify(String(key))).join(' | '));
    }
    const uncertain=/\b(?:em dúvida|não sei|não tenho certeza|me ajude a decidir)\b/i.test(message);
    const edit=editIntent==='acrescentar'&&editKeys.acrescentar.length?'acrescentar':null;
    const actions=forcedPosition?[forced.verb]:edit?[edit,'falar']:uncertain&&questions.length?['perguntar']:
      explaining?['falar']:pick&&editKeys.destacar.length?['destacar','falar']:['falar'];
    if(!forcedPosition&&!explaining&&questions.length&&!actions.includes('perguntar'))actions.push('perguntar');
    const prompt=[
      'Você conversa em português para ajudar a escolher hinos. Responda só com uma ação JSON.',
      forcedPosition
        ?'Pedido explícito confirmado pelo catálogo. Use a ação '+forced.verb+' na posição '+forcedPosition+' para confirmar.'
        :edit
          ?'Escolha um hino do catálogo para propor. Se não houver boa opção, pergunte qual hino o usuário procura.'
          :uncertain
            ?'Escolha qual preferência perguntar: clima, ritmo, tema, ocasiao ou hino.'
            :'Responda ao conteúdo novo. Em uma anotação espiritual, interprete a mensagem central e sugira temas de hinos. Use perguntar só para uma informação que falta.',
      asked.length&&'Já perguntado: '+asked.join(', ')+'. Aproveite as respostas do histórico.',
      scripture&&'Bíblia Livre '+promptText(scripture.reference,60)+': '+promptText(scripture.text,270),
      scripture?.narrative&&'Relato: '+promptText(scripture.narrative,60),
      scripture&&'Relacione o trecho à anotação sem inventar citações.',
      'Cite títulos e números apenas se estiverem nas opções abaixo.',
      pick&&'Para indicar um hino da lista atual, use destacar com a posição da opção mais adequada à preferência.',
      explaining&&'Explique as sugestões usando apenas os títulos e trechos apresentados. Não execute ações.',
      query&&'Última busca: '+promptText(query,76),
      constraints&&'Filtros: '+promptText(constraints,90),
      ...history.slice(-4).map(item=>(item.kind==='user'?'Usuário: ':'Você: ')+promptText(item.text,80)),
      'Usuário agora: '+promptText(message,CHAT_MESSAGE_LIMIT),
      ...(candidates.size?[...candidates].map(([position,h])=>position+' '+(h.inList?'na lista':'catálogo')+
        ' · '+promptText(h.number,8)+' '+promptText(h.title,34)+' '+promptText(h.snippet,message.length>500?20:36)):[])
    ].filter(Boolean);
    // Keep the current note and Scripture when a long note fills the bridge budget.
    while(prompt.join('\n').length>2280){
      const oldest=prompt.findIndex(line=>/^(?:Usuário|Você):/.test(line));
      if(oldest<0)break;
      prompt.splice(oldest,1);
    }
    const grammar=[
      'root ::= '+actions.join(' | '),...rules,
      'text ::= ' + JSON.stringify('"') + ' ['+(asked.length?CHAT_TEXT.replace('?',''):CHAT_TEXT)+']{4,300} ' +JSON.stringify('"')
    ].join('\n');
    return {prompt:prompt.join('\n'),grammar,maxTokens:105,timeoutMs:45000,candidates,actions,editKeys,questions,noFreeQuestion:asked.length>0};
  }

  function cleanChatText(value,max) {
    if(typeof value!=='string'||value.length>max||invalidChatText.test(value)||value.includes('://')||
        value.replace(/\s/g,'').length<3)throw Error('Texto do chat inválido.');
    return value.trim().replace(/\s+/g,' ');
  }

  function readChat(answer,{actions,editKeys,candidates,questions,noFreeQuestion}) {
    const value=JSON.parse(answer);
    if(!Array.isArray(value)||!actions.includes(value[0]))throw Error('Ação do chat inválida.');
    const [verb,arg]=value;
    if(value.length!==2)throw Error('Resposta inválida.');
    if(verb==='perguntar'){
      if(!questions.includes(arg))throw Error('Preferência inválida.');
      return {reply:preferenceQuestions[arg],question:arg};
    }
    if(verb==='falar'){
      const text=cleanChatText(arg,300);
      if(noFreeQuestion&&text.includes('?'))throw Error('Use uma pergunta de preferência inédita.');
      if(/^(?:\/|(?:buscar|busca|perguntar|retirar|acrescentar|destacar|filtros|usu[aá]rio(?: agora)?)\s*:)/i.test(text))throw Error('Resposta sem conteúdo.');
      return {reply:text};
    }
    const hymn=candidates.get(arg);
    if(!hymn||!editKeys[verb].includes(arg))throw Error('Hino fora do contexto.');
    return {verb,hymn};
  }

  return { CHAT_MESSAGE_LIMIT, chatSearchRequest, prepareChat, readChat, REVIEW_LIMIT, prepareReview, readReview, applyReview, diagnostic, prepareComparison, readComparison, mergeCandidates, prepareThemes };
})();
