'use strict';

const LocalHymnAI = (() => {
  const MAX_CANDIDATES = 5;
  const MAX_PICKS = 2;
  const MAX_REASON_LENGTH = 90;
  const COMPARISON_TIMEOUT_MS = 90000;
  const LOOKUP_CHARACTERS = 'A-Za-zÀ-ÖØ-öø-ÿ ';
  const invalidLookupCharacter = new RegExp(`[^${LOOKUP_CHARACTERS}]`);
  const clip = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const promptText = (value, limit) => clip(value, limit).replace(/["\\\u0000-\u001f\uD800-\uDFFF]/gu, ' ');
  const diagnostic = {
    prompt: 'Responda apenas OK.',
    grammar: 'root ::= "OK"',
    maxTokens: 4,
    timeoutMs: 90000
  };

  function prepareComparison(query, exclusions, hymns, context, lookup = null) {
    const candidates = new Map();
    for (const hymn of hymns) {
      const { id } = hymn;
      const excerpt = clip(hymn.snippet, 92);
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
      pedido: promptText(query, 120),
      exclusões: exclusions.slice(0, 2).map(value => promptText(value, 30)),
      temas: (context?.topics || []).slice(0, 2).map(value => promptText(value, 20)),
      ...(context?.reference && context.passage ? {
        referência: promptText(context.reference, 38),
        passagem: promptText(context.passage, 90)
      } : {}),
      ...(lookup ? { busca_complementar: { termos: lookup.term, novos_hinos: lookup.added } } : {}),
      hinos: [...candidates.values()].map(({ id, title, excerpt }) => ({ id, título: promptText(title, 42), trecho: promptText(excerpt, 92) }))
    };
    const instructions = 'Escolha até 2 hinos por evidência no trecho. Responda somente JSON [{"id":1,"motivo":"texto curto"}]. IDs distintos; motivo até 48 caracteres. [] se nenhum.';
    const tool = 'Se necessário, busque uma vez com {"buscar_hinos":"termos alternativos"}.';
    const lookupRequired = canLookup && !candidates.size;
    const instruction = lookupRequired ? 'Sem candidatos. Retorne {"buscar_hinos":"termos alternativos"}, somente letras e espaços.' : instructions + (canLookup ? '\n' + tool : '');
    const prompt = instruction + '\n' + JSON.stringify(input);
    const grammar = [
      'root ::= '+(lookupRequired?'lookup':canLookup?'picks | lookup':'picks'),
      ...(lookupRequired ? [] : [candidates.size ? 'picks ::= "[" ws (entry (ws "," ws entry)?)? ws "]"' : 'picks ::= "[]"']),
      ...(candidates.size ? [
        String.raw`entry ::= "{" ws "\"id\"" ws ":" ws hymn-id ws "," ws "\"motivo\"" ws ":" ws reason ws "}"`,
        'hymn-id ::= ' + [...candidates.keys()].map(id => JSON.stringify(String(id))).join(' | '),
        String.raw`reason ::= "\"" [^"\\\x00-\x1F]{1,48} "\""`,
      ] : []),
      ...(canLookup ? [
        String.raw`lookup ::= "{" ws "\"buscar_hinos\"" ws ":" ws "\"" lookup-text "\"" ws "}"`,
        `lookup-text ::= [${LOOKUP_CHARACTERS}]{3,64}`
      ] : []),
      'ws ::= " "?'
    ].join('\n');
    return { prompt, grammar, maxTokens: lookupRequired ? 36 : 72, timeoutMs: COMPARISON_TIMEOUT_MS, candidates, canLookup, lookupRequired };
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
    // IDs numéricos evitam gerar nomes longos de temas no processador do telefone.
    // Nenhum tema é removido da lista permitida.
    const options = labels.map((label, i) => [i + 1, promptText(label, 40)]);
    const input = {pedido: promptText(query, 140),
      exclusões: exclusions.slice(0, 2).map(x => promptText(x, 24)),
      temas: options.map(([id, label]) => id + ':' + label)};
    return {
      prompt: 'Escolha até 4 números dos temas ligados ao pedido. Responda apenas JSON [1,2] ou [].\n' + JSON.stringify(input),
      grammar: [
        'root ::= "[" ws (theme (ws "," ws theme){0,3})? ws "]"',
        'theme ::= ' + options.map(([id]) => JSON.stringify(String(id))).join(' | '),
        'ws ::= " "?'
      ].join('\n'),
      maxTokens: 24,
      timeoutMs,
      themeLabels: labels.slice()
    };
  }

  return { diagnostic, prepareComparison, readComparison, mergeCandidates, prepareThemes };
})();
