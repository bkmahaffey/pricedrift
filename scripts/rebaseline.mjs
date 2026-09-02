// Accept every pending observation as the new baseline without publishing it to the feed.
// Use once after moving the tracker to a new environment (e.g. laptop → CI runners), when rendering
// differences would otherwise be confirmed as vendor changes. Usage: node scripts/rebaseline.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { observe } from './lib/pipeline.mjs';
import { loadServices } from './lib/catalog.mjs';
import { ROOT } from './lib/store.mjs';

const dir = path.join(ROOT, 'data', 'pending');
const services = Object.fromEntries((await loadServices()).map(s => [s.slug, s]));
let n = 0;
for (const f of (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'))) {
  const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
  const s = services[p.slug]; if (!s) continue;
  const r = await observe(s, p.url, p.ts, p.lines, p.source, { serviceName: s.name, forceTransition: true });
  await fs.unlink(path.join(dir, f));
  n++;
  console.log(`${r.status === 'changed' ? 'baseline' : r.status}: ${s.name} ${p.url}${r.change ? ` (${r.change.kind}, kept out of feed)` : ''}`);
}
console.log(`re-baselined ${n} pending observation${n === 1 ? '' : 's'}`);
