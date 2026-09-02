// Shared logic for recording snapshots and changes (used by track.mjs and backfill.mjs).
import { computeChange, headline } from './diff.mjs';
import { hashLines, stableLines } from './text.mjs';
import { readState, writeState, readChanges, writeChanges, writeSnapshot, readSnapshot, urlKey, tsToDate, snapshotPath } from './store.mjs';
import { promises as fs } from 'node:fs';

const MIN_KEEP_RATIO = 0.4; // a capture with far fewer lines than the last one is probably a broken/partial page

export function isSuspiciousShrink(prevLines, nextLines) {
  return prevLines && nextLines.length < prevLines.length * MIN_KEEP_RATIO;
}

// Detect "flaps": change B exactly reverses change A on the same URL (A/B tests, rollbacks within days).
export function isInverse(a, b) {
  if (!a || !b || !a.pairs.length || a.pairs.length !== b.pairs.length) return false;
  const key = p => p.deltas.map(d => `${d.before}>${d.after}`).join('|');
  const inv = p => p.deltas.map(d => `${d.after}>${d.before}`).join('|');
  const as = a.pairs.map(key).sort().join('\n'), bs = b.pairs.map(inv).sort().join('\n');
  return as === bs;
}

/**
 * Record a new observation of `url` for `service`.
 * Returns {status: 'first'|'unchanged'|'changed'|'skipped', change?}
 */
export async function observe(service, url, ts, lines, source, { serviceName, forceTransition = false } = {}) {
  const slug = service.slug;
  const key = urlKey(url);
  const state = await readState(slug);
  const st = state.urls[key] || { url };
  const stable = stableLines(lines);
  const hash = hashLines(stable);
  st.url = url;
  st.lastChecked = ts;

  if (!st.latestTs) {
    await writeSnapshot(slug, url, ts, lines);
    Object.assign(st, { latestTs: ts, hash, firstTs: ts, status: 'ok', lastSource: source });
    state.urls[key] = st;
    await writeState(slug, state);
    return { status: 'first' };
  }
  if (st.hash === hash) {
    st.status = 'ok'; st.lastSource = source;
    state.urls[key] = st;
    await writeState(slug, state);
    return { status: 'unchanged' };
  }
  const prevLines = await readSnapshot(slug, url, st.latestTs);
  if (isSuspiciousShrink(prevLines, lines)) {
    st.status = 'suspicious';
    st.lastNote = `capture ${ts} had ${lines.length} lines vs ${prevLines.length}; ignored`;
    state.urls[key] = st;
    await writeState(slug, state);
    return { status: 'skipped' };
  }
  const change = computeChange(stableLines(prevLines), stable);
  if (!change) { // only volatile lines differed
    st.hash = hash; st.status = 'ok';
    state.urls[key] = st;
    await writeState(slug, state);
    return { status: 'unchanged' };
  }
  const changes = await readChanges(slug);
  // The first live capture after archived history usually differs in rendering (regions, currency
  // toggles, client-side sections). Record the diff but keep it out of the main feed.
  const transition = forceTransition || (st.lastSource === 'wayback' && source !== 'wayback');
  const entry = {
    id: `${key}-${ts}`,
    url, ts, date: tsToDate(ts), source, ...(transition ? { transition: true } : {}),
    prevTs: st.latestTs,
    kind: change.kind, score: change.score, counts: change.counts, material: change.material,
    headline: headline(change, serviceName || service.name),
    pairs: change.pairs, added: change.added, removed: change.removed, totals: change.totals,
  };
  // flap detection against the previous material change on this url
  const prevEntry = [...changes].reverse().find(c => c.url === url && c.material);
  if (entry.material && prevEntry && isInverse(prevEntry, entry)) {
    entry.flap = true; prevEntry.flap = true;
  }
  changes.push(entry);
  await writeChanges(slug, changes);
  // keep snapshots for material changes; replace the latest otherwise
  await writeSnapshot(slug, url, ts, lines);
  if (!entry.material) {
    // prune the previous non-material snapshot unless it's referenced by a material change
    const referenced = new Set(changes.filter(c => c.material).flatMap(c => [c.ts, c.prevTs]));
    if (!referenced.has(st.latestTs) && st.latestTs !== st.firstTs) {
      try { await fs.unlink(snapshotPath(slug, url, st.latestTs)); } catch {}
    }
  }
  Object.assign(st, { latestTs: ts, hash, lastChanged: ts, status: 'ok', lastSource: source });
  state.urls[key] = st;
  await writeState(slug, state);
  return { status: 'changed', change: entry };
}
