import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToLines, isMaterialLine, isVolatileLine, numericTokens, shape, stableLines } from '../scripts/lib/text.mjs';

test('htmlToLines strips scripts, nav and keeps visible text in order', () => {
  const html = `<html><head><title>x</title><script>var a=1</script></head><body><nav>Home</nav><h1>Pricing</h1><div><span>$20</span> <span>per month</span></div><ul><li>100 GB bandwidth</li><li>Unlimited sites</li></ul><footer>© 2026</footer></body></html>`;
  assert.deepEqual(htmlToLines(html), ['Pricing', '$20 per month', '100 GB bandwidth', 'Unlimited sites']);
});

test('material lines: prices, quantities with units, free wording', () => {
  assert.ok(isMaterialLine('$20 per member / month'));
  assert.ok(isMaterialLine('100 GB bandwidth'));
  assert.ok(isMaterialLine('1M requests/month'));
  assert.ok(isMaterialLine('Free forever'));
  assert.ok(!isMaterialLine('Build faster with our platform'));
  assert.ok(!isMaterialLine('04 I went over my included credit. What can I do?'));
});

test('volatile lines are ignored', () => {
  assert.ok(isVolatileLine('© 2026 Vercel Inc.'));
  assert.ok(isVolatileLine('Trusted by 20,000+ teams'));
  assert.ok(isVolatileLine('Last updated March 3, 2026'));
  assert.ok(!isVolatileLine('$19 per month'));
  assert.deepEqual(stableLines(['$19', 'Copyright 2026']), ['$19']);
});

test('numeric tokens and shape', () => {
  assert.deepEqual(numericTokens('$20 per member / month, 100 GB included'), ['$20', '100GB']);
  assert.deepEqual(numericTokens('04 I went over 5 GB'), ['5GB']);
  assert.deepEqual(numericTokens('60 compute hours'), ['60']);
  assert.deepEqual(numericTokens('10 projects'), ['10']);
  assert.deepEqual(numericTokens('12 Why did my bill go up this month when nothing changed?'), []);
  assert.equal(shape('$20 per member / month'), '¤ per member month');
  assert.equal(shape('$25 per member / month'), shape('$20 per member / month'));
});
