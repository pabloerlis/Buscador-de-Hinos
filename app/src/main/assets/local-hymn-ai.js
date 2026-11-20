'use strict';

const LocalHymnAI = (() => {
  const MAX_CANDIDATES = 5;
  const MAX_PICKS = 2;
  const MAX_REASON_LENGTH = 90;
  const clip = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const promptText = (value, limit) => clip(value, limit).replace(/["\\\u0000-\u001f]/g, ' ');
  const diagnostic = {
    prompt: 'Responda apenas OK.',
    grammar: 'root ::= "OK"',
    maxTokens: 8,
    timeoutMs: 45000
  };

  function prepareComparison(query, exclusions, hymns, context) {
    const candidates = new Map();
    for (const hymn of hymns.slice(0, MAX_CANDIDATES)) {
      const { id } = hymn;
      const excerpt = clip(hymn.snippet, 140);
      if (!Number.isSafeInteger(id) || id < 1 || !excerpt || excerpt === 'Nenhum trecho disponível') continue;
      candidates.set(id, {
        id,
        title: clip(hymn.title, 70),
        number: hymn.number,
        collection: hymn.collection,
        excerpt
      });
    }

    if (candidates.size < 2) return null;
    const input = {
      pedido: promptText(query, 230),
      exclusões: exclusions.slice(0, 4).map(value => promptText(value, 40)),
      temas: (context?.topics || []).slice(0, 4).map(value => promptText(value, 28)),
      ...(context?.reference && context.passage ? {
        referência: promptText(context.reference, 50),
        passagem: promptText(context.passage, 220)
      } : {}),
      hinos: [...candidates.values()].map(({ id, title, excerpt }) => ({ id, título: promptText(title, 60), trecho: promptText(excerpt, 140) }))
    };
    const prompt = 'Compare os hinos com o pedido usando apenas os trechos fornecidos. Escolha até dois hinos, do mais adequado ao menos adequado, sem repetir ID. Em motivo, diga brevemente o que no trecho atende ao pedido, em português. Responda com objetos id e motivo em uma lista JSON, ou [] sem evidência suficiente.\n' + JSON.stringify(input);
    const grammar = [
      'root ::= "[" ws (entry (ws "," ws entry)?)? ws "]"',
      String.raw`entry ::= "{" ws "\"id\"" ws ":" ws hymn-id ws "," ws "\"motivo\"" ws ":" ws reason ws "}"`,
      'hymn-id ::= ' + [...candidates.keys()].map(id => JSON.stringify(String(id))).join(' | '),
      String.raw`reason ::= "\"" [^"\\\x00-\x1F]{1,90} "\""`,
      'ws ::= " "?'
    ].join('\n');
    return { prompt, grammar, maxTokens: 120, timeoutMs: 60000, candidates };
  }

  function readComparison(response, candidates) {
    const picks = JSON.parse(response);
    if (!Array.isArray(picks) || picks.length > MAX_PICKS) throw Error('Formato de comparação inválido.');

    const seen = new Set();
    return picks.map(pick => {
      const hymn = candidates.get(pick?.id);
      const reason = typeof pick?.motivo === 'string' ? pick.motivo.trim() : '';
      if (!hymn || seen.has(hymn.id) || !reason || reason.length > MAX_REASON_LENGTH || /[\u0000-\u001f]/.test(reason)) {
        throw Error('A comparação contém um hino ou motivo inválido.');
      }
      seen.add(hymn.id);
      return { ...hymn, reason };
    });
  }

  return { diagnostic, prepareComparison, readComparison };
})();
