// Change detection between two snapshots of a pricing page.
import { diffArrays } from 'diff';
import { isMaterialLine, isVolatileLine, numericTokens, shape, isWeakToken, CURRENCY_RE, UNIT_RE } from './text.mjs';

const PLAN_WORDS = /\b(free|hobby|starter|basic|developer|dev|pro|plus|premium|standard|team|teams|business|scale|growth|enterprise|launch|build|essentials?|personal|individual|organization|ultimate|max|lite|core)\b/i;

function tokenSet(s) { return new Set(shape(s).split(' ').filter(t => t.length > 2)); }
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Pair removed lines with added lines that look like the same line with different numbers.
export function pairLines(removed, added, { exactOnly = false, minWords = 1 } = {}) {
  const pairs = [];
  const usedA = new Set(), usedR = new Set();
  // Pass 1: identical shape (numbers stripped) → strongest signal.
  const byShape = new Map();
  added.forEach((l, i) => { const s = shape(l); if (!byShape.has(s)) byShape.set(s, []); byShape.get(s).push(i); });
  removed.forEach((l, i) => {
    const s = shape(l);
    const cands = (byShape.get(s) || []).filter(j => !usedA.has(j));
    const words = s.split(' ').filter(w => w !== '#' && w !== '¤' && w.length > 1).length;
    if (cands.length && s.replace(/[#¤ ]/g, '').length >= 3 && words >= minWords) {
      const j = cands[0]; usedA.add(j); usedR.add(i);
      pairs.push({ before: l, after: added[j], confidence: 1 });
    }
  });
  // Pass 2: fuzzy token overlap for lines that changed wording slightly.
  const addedSets = added.map(tokenSet);
  removed.forEach((l, i) => {
    if (exactOnly || usedR.has(i)) return;
    const rs = tokenSet(l); if (rs.size < 3) return;
    let best = -1, bestScore = 0;
    added.forEach((a, j) => { if (usedA.has(j)) return; const sc = jaccard(rs, addedSets[j]); if (sc > bestScore) { bestScore = sc; best = j; } });
    if (best >= 0 && bestScore >= 0.6) { usedA.add(best); usedR.add(i); pairs.push({ before: l, after: added[best], confidence: Math.round(bestScore * 100) / 100 }); }
  });
  return { pairs, unpairedRemoved: removed.filter((_, i) => !usedR.has(i)), unpairedAdded: added.filter((_, i) => !usedA.has(i)) };
}

// Numeric deltas inside a pair: [{before:'$20', after:'$25'}]
export function deltas(pair) {
  const b = numericTokens(pair.before), a = numericTokens(pair.after);
  const out = [];
  const n = Math.max(b.length, a.length);
  for (let i = 0; i < n; i++) {
    if (b[i] === a[i]) continue;
    if (b[i] === undefined && a[i] === undefined) continue;
    const weak = (b[i] === undefined || isWeakToken(b[i], pair.before)) && (a[i] === undefined || isWeakToken(a[i], pair.after));
    if (weak) continue;
    out.push({ before: b[i] ?? null, after: a[i] ?? null });
  }
  return out;
}

export function classify(pairs, unpairedRemoved, unpairedAdded) {
  let price = 0, limit = 0, plan = 0;
  for (const p of pairs) {
    const ds = deltas(p);
    if (!ds.length) continue;
    if (ds.some(d => CURRENCY_RE.test(d.before || '') || CURRENCY_RE.test(d.after || ''))) price++;
    else if (UNIT_RE.test(p.before) || UNIT_RE.test(p.after)) limit++;
    else limit++;
  }
  for (const l of [...unpairedRemoved, ...unpairedAdded]) {
    if (CURRENCY_RE.test(l)) price += 0.5;
    else if (UNIT_RE.test(l)) limit += 0.5;
    const words = l.split(' ');
    if (words.length <= 3 && PLAN_WORDS.test(l) && /^[A-Z]/.test(l)) plan++;
  }
  let kind = 'copy';
  if (price >= 1) kind = 'price';
  else if (limit >= 1) kind = 'limits';
  else if (plan >= 1) kind = 'plans';
  const score = Math.round(price * 3 + limit * 2 + plan * 2);
  return { kind, score, counts: { price: Math.round(price), limit: Math.round(limit), plan } };
}

export function computeChange(prevLines, nextLines) {
  const parts = diffArrays(prevLines, nextLines);
  // Build hunks: a removed run followed by an added run (a modification) pairs locally first.
  const hunks = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.removed) {
      const next = parts[i + 1];
      if (next && next.added) { hunks.push({ removed: p.value, added: next.value }); i++; }
      else hunks.push({ removed: p.value, added: [] });
    } else if (p.added) hunks.push({ removed: [], added: p.value });
  }
  const clean = arr => arr.filter(l => !isVolatileLine(l));
  const removed = clean(hunks.flatMap(h => h.removed));
  const added = clean(hunks.flatMap(h => h.added));
  if (!removed.length && !added.length) return null;
  let pairs = [], leftoverR = [], leftoverA = [];
  for (const h of hunks) {
    const r = pairLines(clean(h.removed).filter(isMaterialLine), clean(h.added).filter(isMaterialLine));
    pairs.push(...r.pairs); leftoverR.push(...r.unpairedRemoved); leftoverA.push(...r.unpairedAdded);
  }
  // Second pass across hunks: only exact-shape matches with enough words to be specific (a moved table row).
  const cross = pairLines(leftoverR, leftoverA, { exactOnly: true, minWords: 3 });
  pairs.push(...cross.pairs);
  const unpairedRemoved = cross.unpairedRemoved, unpairedAdded = cross.unpairedAdded;
  const mRemoved = removed.filter(isMaterialLine);
  const mAdded = added.filter(isMaterialLine);
  const realPairs = pairs.filter(p => deltas(p).length);
  const { kind, score, counts } = classify(realPairs, unpairedRemoved, unpairedAdded);
  return {
    kind, score, counts,
    material: kind !== 'copy',
    pairs: realPairs.map(p => ({ ...p, deltas: deltas(p) })),
    removed: unpairedRemoved.slice(0, 40),
    added: unpairedAdded.slice(0, 40),
    totals: { removed: removed.length, added: added.length, materialRemoved: mRemoved.length, materialAdded: mAdded.length },
  };
}

// Human-readable headline built only from what was detected. No guessing.
export function headline(change, serviceName) {
  const c = change.counts || {};
  const parts = [];
  if (c.price) parts.push(`${c.price} price${c.price === 1 ? '' : 's'}`);
  if (c.limit) parts.push(`${c.limit} limit${c.limit === 1 ? '' : 's'}`);
  if (c.plan) parts.push(`${c.plan} plan name${c.plan === 1 ? '' : 's'}`);
  const ex = change.pairs.slice(0, 2).flatMap(p => p.deltas.slice(0, 1)).map(d => `${d.before ?? '∅'} → ${d.after ?? '∅'}`);
  if (change.kind === 'copy') return `${serviceName}: pricing page text changed (no price or limit change detected)`;
  const what = parts.join(', ') + ' changed';
  if (ex.length) return `${serviceName}: ${what} (${ex.join('; ')})`;
  const short = l => l.length > 48 ? l.slice(0, 45) + '…' : l;
  const rm = (change.removed || []).filter(l => /\d/.test(l)).slice(0, 1).map(l => `removed “${short(l)}”`);
  const ad = (change.added || []).filter(l => /\d/.test(l)).slice(0, 1).map(l => `added “${short(l)}”`);
  const ex2 = [...rm, ...ad];
  return ex2.length ? `${serviceName}: ${what} (${ex2.join('; ')})` : `${serviceName}: ${what}`;
}
