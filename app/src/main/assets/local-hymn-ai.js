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

  return { REVIEW_LIMIT, prepareReview, readReview, applyReview, diagnostic, prepareComparison, readComparison, mergeCandidates, prepareThemes };
})();
