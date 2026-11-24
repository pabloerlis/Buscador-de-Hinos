'use strict';

const ContextRanker = (() => {
  const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const actionGroups = {
    pedir: /^(ped(?:e|em|iu|iram|ir)|rog(?:a|am|ou|aram|ar)|suplic(?:a|am|ou|aram|ar)|clam(?:a|am|ou|aram|ar))$/,
    socorrer: /^(ajud|socorr|ampar|salv)(?:a|e|em|ou|eu|iu|aram|eram|iram|ar|er|ir)$/,
    curar: /^(cur|sar)(?:a|ou|aram|ar|ad[oa]s?)$/,
    tocar: /^(toc)(?:a|ou|aram|ar)$/,
    acalmar: /^(acalm|sosseg|aquiet|silenci)(?:a|e|ou|aram|ar)$/,
    temer: /^(tem(?:e|em|eu|eram|er)|rece(?:ia|ou|aram|ar))$/,
    voltar: /^(volt|retorn|regress)(?:a|ou|aram|ar)$/,
    perdoar: /^(perdo|absolv)(?:a|e|ou|eu|aram|eram|ar|er)$/,
    receber: /^(receb|acolh)(?:e|eu|eram|er)$/,
    procurar: /^(procur|busc)(?:a|ou|aram|ar)$/,
    encontrar: /^(encontr|ach)(?:a|ou|aram|ar)$/,
    ressuscitar: /^(ressuscit|reviv)(?:a|e|ou|eu|aram|eram|ar|er)$/,
    enviar: /^(envi|mand)(?:a|ou|aram|ar)$/,
    ouvir: /^(ouv|escut)(?:e|a|iu|ou|iram|aram|ir|ar)$/,
    andar: /^(and|caminh)(?:a|ou|aram|ar)$/,
    cair: /^(cai(?:u|ram|r)|afund(?:a|ou|aram|ar))$/
  };
  const actionPatterns = Object.entries(actionGroups);
  const aliases = {
    cristo:'jesus', salvador:'jesus', discipulo:'discipulo', discipulos:'discipulo',
    barco:'barco', barca:'barco', embarcacao:'barco', tempestade:'tempestade',
    tormenta:'tempestade', ventania:'tempestade', ondas:'mar',
    doente:'doente', enfermo:'doente', enferma:'doente', filho:'filho', filha:'filho'
  };
  const grammar = new Set('a o as os um uma de do da dos das ao aos no na nos nas em com por para que e se lhe lhes seu sua meu minha ja entao ali aqui muito todos todo toda outro outra sobre'.split(' '));
  const negatives = new Set(['nao', 'nunca', 'jamais', 'nem']);
  const implicit = new Set(['ele', 'ela', 'eles', 'elas', 'eu', 'tu', 'nos', 'vos']);
  const features = ['actionCoverage', 'roleAgreement', 'outcome', 'ordered', 'spread', 'opposition'];
  // Treinado com comparações autorais em qa/context-ranker-training.json.
  const weights = Object.freeze([0.3699,0.5006,0.9401,0.9497,0.7513,-0.1329]);

  function getAction(word) {
    return actionPatterns.find(([,pattern]) => pattern.test(word))?.[0];
  }

  function participant(words) {
    const word = words.find(value => !grammar.has(value) && !negatives.has(value));
    return word && !implicit.has(word) && !getAction(word) ? (Object.prototype.hasOwnProperty.call(aliases, word) ? aliases[word] : word) : null;
  }

  function profile(text) {
    const clauses = normalize(text).split(/[.!?;:\n]+/).map(line => line.trim()).filter(Boolean);
    const distinct = [...new Set(clauses)];
    const events = [];
    distinct.forEach((clause, index) => {
      const tokens = clause.match(/[a-z]+/g) || [];
      const actions = tokens.map(getAction);
      tokens.forEach((_, position) => {
        const action = actions[position];
        if (!action) return;
        const before = tokens.slice(Math.max(0, position - 3), position);
        const after = tokens.slice(position + 1, position + 4);
        events.push({
          action, actor:participant(before.slice().reverse()), object:participant(after),
          negative:before.some(word => negatives.has(word)), index
        });
      });
    });
    return {events, clauses:distinct.length};
  }

  function compare(source, candidate) {
    const keys = new Map();
    for (const event of source.events) keys.set(event.action, event);
    if (!keys.size) return features.map(() => 0);
    const matches = [];
    let roleAgreement = 0;
    let opposition = 0;
    const outcome = [...keys.values()].at(-1);
    for (const expected of keys.values()) {
      const possibilities = candidate.events.filter(item => item.action === expected.action);
      const same = possibilities.find(item => item.negative === expected.negative
        && expected.actor && expected.object && item.actor === expected.actor && item.object === expected.object);
      const reverse = possibilities.find(item => item.negative === expected.negative
        && expected.actor && expected.object && expected.actor !== expected.object
        && item.actor === expected.object && item.object === expected.actor);
      const compatible = same || possibilities.find(item => item.negative === expected.negative && item !== reverse);
      if (compatible) {
        matches.push({expected, candidate:compatible});
        if (same) roleAgreement++;
      } else if (reverse || possibilities.some(item => item.negative !== expected.negative
        && expected.actor && item.actor === expected.actor)) opposition++;
    }
    const count = keys.size;
    const ordered = matches.length >= 2 && matches.every((entry, index) =>
      index === 0 || entry.candidate.index >= matches[index - 1].candidate.index);
    return [
      matches.length / count,
      roleAgreement / count,
      Number(matches.some(entry => entry.expected === outcome)),
      Number(ordered),
      new Set(matches.map(entry => entry.candidate.index)).size / Math.max(1, candidate.clauses),
      opposition / count
    ];
  }

  function score(values) {
    return values.reduce((sum, value, index) => sum + value * weights[index], 0);
  }

  return {profile, compare, score, features, weights};
})();

if (typeof module !== 'undefined') module.exports = ContextRanker;
