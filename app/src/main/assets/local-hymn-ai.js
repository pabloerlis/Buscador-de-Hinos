'use strict';

const LocalHymnAI = (() => {
  const MAX_CANDIDATES = 5;
  const MAX_PICKS = 2;
  const MAX_REASON_LENGTH = 90;
  const COMPARISON_TIMEOUT_MS = 60000;
  const LOOKUP_CHARACTERS = 'A-Za-zÀ-ÖØ-öø-ÿ ';
  const invalidLookupCharacter = new RegExp(`[^${LOOKUP_CHARACTERS}]`);
  const clip = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const promptText = (value, limit) => clip(value, limit).replace(/["\\\u0000-\u001f]/g, ' ');
  const diagnostic = {
    prompt: 'Responda apenas OK.',
    grammar: 'root ::= "OK"',
    maxTokens: 8,
    timeoutMs: 45000
  };

  function prepareComparison(query, exclusions, hymns, context, lookup = null) {
    const candidates = new Map();
    for (const hymn of hymns) {
      const { id } = hymn;
      const excerpt = clip(hymn.snippet, 140);
      if (!Number.isSafeInteger(id) || id < 1 || candidates.has(id) || !excerpt || excerpt === 'Nenhum trecho disponível') continue;
      candidates.set(id, {
        id,
        title: clip(hymn.title, 70),
        number: hymn.number,
        collection: hymn.collection,
        excerpt
      });
      if (candidates.size === MAX_CANDIDATES) break;
    }

    const canLookup = lookup === null;
    const input = {
      pedido: promptText(query, 230),
      exclusões: exclusions.slice(0, 4).map(value => promptText(value, 40)),
      temas: (context?.topics || []).slice(0, 4).map(value => promptText(value, 28)),
      ...(context?.reference && context.passage ? {
        referência: promptText(context.reference, 50),
        passagem: promptText(context.passage, 220)
      } : {}),
      ...(lookup ? { busca_complementar: { termos: lookup.term, novos_hinos: lookup.added } } : {}),
      hinos: [...candidates.values()].map(({ id, title, excerpt }) => ({ id, título: promptText(title, 60), trecho: promptText(excerpt, 140) }))
    };
    const instructions = 'Escolha até dois hinos do mais adequado ao menos adequado ao pedido. Responda com uma lista JSON de objetos id e motivo. Use IDs distintos e um motivo curto em português, sustentado pelo trecho. Use [] se não houver evidência.';
    const tool = 'Se os trechos forem insuficientes, você pode chamar a busca local uma vez com {"buscar_hinos":"palavras alternativas"}. Use de 3 a 64 letras e espaços.';
    const lookupRequired = canLookup && !candidates.size;
    const instruction = lookupRequired ? 'A busca atual não encontrou hinos. Chame a busca local com {"buscar_hinos":"palavras alternativas"}. Use de 3 a 64 letras e espaços.' : instructions + (canLookup ? '\n' + tool : '');
    const prompt = instruction + '\n' + JSON.stringify(input);
    const grammar = [
      'root ::= '+(lookupRequired?'lookup':canLookup?'picks | lookup':'picks'),
      ...(lookupRequired ? [] : [candidates.size ? 'picks ::= "[" ws (entry (ws "," ws entry)?)? ws "]"' : 'picks ::= "[]"']),
      ...(candidates.size ? [
        String.raw`entry ::= "{" ws "\"id\"" ws ":" ws hymn-id ws "," ws "\"motivo\"" ws ":" ws reason ws "}"`,
        'hymn-id ::= ' + [...candidates.keys()].map(id => JSON.stringify(String(id))).join(' | '),
        String.raw`reason ::= "\"" [^"\\\x00-\x1F]{1,90} "\""`,
      ] : []),
      ...(canLookup ? [
        String.raw`lookup ::= "{" ws "\"buscar_hinos\"" ws ":" ws "\"" lookup-text "\"" ws "}"`,
        `lookup-text ::= [${LOOKUP_CHARACTERS}]{3,64}`
      ] : []),
      'ws ::= " "?'
    ].join('\n');
    return { prompt, grammar, maxTokens: lookupRequired ? 40 : 120, timeoutMs: COMPARISON_TIMEOUT_MS, candidates, canLookup, lookupRequired };
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
    return { picks: picks.map(pick => {
      const hymn = candidates.get(pick?.id);
      const reason = typeof pick?.motivo === 'string' ? pick.motivo.trim() : '';
      if (!hymn || seen.has(hymn.id) || !reason || reason.length > MAX_REASON_LENGTH || /[\u0000-\u001f]/.test(reason)) {
        throw Error('A comparação contém um hino ou motivo inválido.');
      }
      seen.add(hymn.id);
      return { ...hymn, reason };
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

  function prepareThemes(query, exclusions, labels, timeoutMs) {
    if (!labels.length) return null;
    const input = { pedido: promptText(query, 230), exclusões: exclusions.slice(0,4).map(x => promptText(x,40)), temas: labels };
    return {
      prompt: 'Escolha até quatro temas do catálogo diretamente relacionados ao pedido. Responda com uma lista JSON de nomes de tema. Se nenhum for adequado, responda [].\n'+JSON.stringify(input),
      grammar: [
        'root ::= "[" ws (theme (ws "," ws theme){0,3})? ws "]"',
        'theme ::= '+labels.map(label => JSON.stringify(JSON.stringify(label))).join(' | '),
        'ws ::= " "?'
      ].join('\n'),
      maxTokens: 56,
      timeoutMs
    };
  }

  return { diagnostic, prepareComparison, readComparison, mergeCandidates, prepareThemes };
})();
