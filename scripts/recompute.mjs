// Re-derive every change entry from the stored snapshots with the current classifier.
// Use after improving scripts/lib/diff.mjs or text.mjs. Usage: node scripts/recompute.mjs [--only slug]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadServices } from './lib/catalog.mjs';
import { computeChange, headline } from './lib/diff.mjs';
import { stableLines, normalizeLine } from './lib/text.mjs';
import { readState, readChanges, writeChanges, listSnapshots, readSnapshot, tsToDate, DATA } from './lib/store.mjs';
import { isInverse } from './lib/pipeline.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
let services = await loadServices();
if (args.only) services = services.filter(s => String(args.only).split(',').includes(s.slug));
let total = 0, material = 0;
for (const s of services) {
  const state = await readState(s.slug);
  const old = await readChanges(s.slug);
  const sourceByTs = Object.fromEntries(old.map(c => [`${c.url}|${c.ts}`, c.source]));
  const next = [];
  for (const st of Object.values(state.urls || {})) {
    const url = st.url; if (!url) continue;
    const stamps = await listSnapshots(s.slug, url);
    let prev = null, prevTs = null, prevEntry = null;
    for (const ts of stamps) {
      const lines = (await readSnapshot(s.slug, url, ts)).map(normalizeLine).filter(Boolean);
      if (prev) {
        const change = computeChange(stableLines(prev), stableLines(lines));
        if (change) {
          const entry = { id: `${path.basename(path.dirname(await Promise.resolve(path.join(DATA, 'snapshots', s.slug, 'x'))))}`, url, ts, date: tsToDate(ts), source: sourceByTs[`${url}|${ts}`] || 'wayback', prevTs, kind: change.kind, score: change.score, counts: change.counts, material: change.material, headline: headline(change, s.name), pairs: change.pairs, added: change.added, removed: change.removed, totals: change.totals };
          entry.id = old.find(c => c.url === url && c.ts === ts)?.id || `${new URL(url).host.replace(/^www\./, '')}${new URL(url).pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) + `-${ts}`;
          if (entry.material && prevEntry && isInverse(prevEntry, entry)) { entry.flap = true; prevEntry.flap = true; }
          next.push(entry);
          if (entry.material) prevEntry = entry;
        }
      }
      prev = lines; prevTs = ts;
    }
  }
  next.sort((a, b) => a.ts.localeCompare(b.ts));
  await writeChanges(s.slug, next);
  total += next.length; material += next.filter(c => c.material && !c.flap).length;
}
console.log(`recomputed ${services.length} services: ${total} entries, ${material} material`);
