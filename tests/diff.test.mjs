import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChange, headline, pairLines } from '../scripts/lib/diff.mjs';
import { isInverse } from '../scripts/lib/pipeline.mjs';

test('price change is paired and classified', () => {
  const c = computeChange(['Pro', '$20 per member / month', '100 GB bandwidth'], ['Pro', '$25 per member / month', '100 GB bandwidth']);
  assert.equal(c.kind, 'price');
  assert.equal(c.pairs.length, 1);
  assert.deepEqual(c.pairs[0].deltas, [{ before: '$20', after: '$25' }]);
  assert.equal(headline(c, 'Vercel'), 'Vercel: 1 price changed ($20 → $25)');
});

test('FAQ numbering and unrelated same-shape rows do not pair', () => {
  const prev = ['04 I went over my credit. What now?', 'Analytics', '5K events / month included', 'Blob', '500 requests / month included'];
  const next = ['05 I went over my credit. What now?', 'Analytics', '5K events / month included', 'Blob', '500 requests / month included'];
  const c = computeChange(prev, next);
  assert.equal(c.kind, 'copy'); // ordinal lines are not material
  assert.equal(c.pairs.length, 0);
});

test('limit change without currency is a limits change', () => {
  const c = computeChange(['Storage', '0.5 GB per project'], ['Storage', '1 GB per project']);
  assert.equal(c.kind, 'limits');
  assert.match(headline(c, 'Neon'), /1 limit changed/);
});

test('wording-only edits are not material', () => {
  const c = computeChange(['Build the future', '$20 / mo'], ['Ship the future', '$20 / mo']);
  assert.equal(c.kind, 'copy');
  assert.equal(c.material, false);
});

test('reverted change is detected as inverse', () => {
  const a = { pairs: [{ deltas: [{ before: '$20', after: '$25' }] }] };
  const b = { pairs: [{ deltas: [{ before: '$25', after: '$20' }] }] };
  assert.ok(isInverse(a, b));
  assert.ok(!isInverse(a, a));
});

test('fuzzy pairing tolerates small wording changes', () => {
  const { pairs } = pairLines(['$19 per month per member, billed monthly'], ['$20 per month per member, billed monthly or yearly']);
  assert.equal(pairs.length, 1);
});
