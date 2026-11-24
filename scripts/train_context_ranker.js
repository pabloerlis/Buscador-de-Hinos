'use strict';

const {profile, compare, features} = require('../app/src/main/assets/context-ranker.js');
const samples = require('../qa/context-ranker-training.json');
const differences = samples.map(([query, preferred, other]) => {
  const source = profile(query);
  const positive = compare(source, profile(preferred));
  const negative = compare(source, profile(other));
  return positive.map((value, index) => value - negative[index]);
});

// Regressão logística por pares com regularização L2 e ordem determinística.
let weights = features.map(() => 0);
for (let step = 0; step < 800; step++) {
  const gradient = weights.map(value => 0.08 * value);
  for (const row of differences) {
    const margin = row.reduce((sum, value, index) => sum + value * weights[index], 0);
    const error = 1 / (1 + Math.exp(margin)) / differences.length;
    row.forEach((value, index) => { gradient[index] -= error * value; });
  }
  weights = weights.map((value, index) => {
    const next = value - 0.2 * gradient[index];
    return index === features.indexOf('opposition') ? Math.min(0, next) : Math.max(0, next);
  });
}
weights = weights.map(value => Math.round(value * 10000) / 10000);
if (require.main === module) console.log(JSON.stringify(weights));
module.exports = weights;
