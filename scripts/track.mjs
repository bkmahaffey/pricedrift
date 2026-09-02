// Daily tracker: fetch every tracked URL, detect changes, confirm them on the next run (A/B and rollback guard).
// Usage: node scripts/track.mjs [--only slug] [--no-confirm] [--concurrency 4]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fetchPage, closeBrowser, sleep } from './lib/fetch.mjs';
import { observe } from './lib/pipeline.mjs';
import { loadServices } from './lib/catalog.mjs';
import { readState, writeState, urlKey, tsNow, ROOT, writeJson, readJson } from './lib/store.mjs';
import { hashLines, stableLines } from './lib/text.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const ONLY = args.only ? String(args.only).split(',') : null;
const CONFIRM = !args['no-confirm'];
const CONCURRENCY = Number(args.concurrency || 4);
const PENDING_DIR = path.join(ROOT, 'data', 'pending');

async function main() {
  let services = await loadServices();
  if (ONLY) services = services.filter(s => ONLY.includes(s.slug));
  const ts = tsNow();
  const summary = { ranAt: new Date().toISOString(), ts, checked: 0, changed: [], confirmed: [], pending: [], unreachable: [], sources: {} };
  const jobs = services.flatMap(s => s.track_urls.map(url => ({ s, url })));
  let i = 0;
  const hostLast = new Map();
  async function worker() {
    while (i < jobs.length) {
      const { s, url } = jobs[i++];
      const host = new URL(url).host;
      const last = hostLast.get(host) || 0; const wait = 1500 - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      hostLast.set(host, Date.now());
      const minLines = s.min_lines || 40;
      const r = await fetchPage(url, { minLines, minMaterial: s.min_material ?? 3 });
      summary.checked++;
      const state = await readState(s.slug);
      const key = urlKey(url);
      const st = state.urls[key] || { url };
      if (!r.lines) {
        st.status = 'unreachable'; st.lastChecked = ts; st.lastNote = r.notes.join('; ');
        st.failures = (st.failures || 0) + 1;
        state.urls[key] = st; await writeState(s.slug, state);
        summary.unreachable.push({ slug: s.slug, url, notes: r.notes });
        console.log(`✗ ${s.slug} ${url} unreachable: ${r.notes.join('; ')}`);
        continue;
      }
      summary.sources[r.source] = (summary.sources[r.source] || 0) + 1;
      st.failures = 0;
      const hash = hashLines(stableLines(r.lines));
      const observedTs = r.source === 'wayback' && r.waybackTs ? r.waybackTs : ts;
      if (!CONFIRM || !st.latestTs || st.hash === hash) {
        // first observation, unchanged, or confirmation disabled → record directly
        if (st.hash === hash) { st.lastChecked = ts; st.status = 'ok'; delete st.pending; state.urls[key] = st; await writeState(s.slug, state); continue; }
        const res = await observe(s, url, observedTs, r.lines, r.source, { serviceName: s.name });
        if (res.status === 'changed') { summary.changed.push({ slug: s.slug, headline: res.change.headline, material: res.change.material }); console.log(`Δ ${res.change.headline}`); }
        else console.log(`• ${s.slug} ${res.status}`);
        continue;
      }
      // changed vs latest: confirm on a second run before publishing
      const pendingFile = path.join(PENDING_DIR, `${s.slug}--${key}.json`);
      const pending = await readJson(pendingFile, null);
      if (pending && pending.hash === hash) {
        const res = await observe(s, url, pending.ts, pending.lines, pending.source, { serviceName: s.name });
        await fs.unlink(pendingFile).catch(() => {});
        if (res.status === 'changed') { summary.confirmed.push({ slug: s.slug, headline: res.change.headline, material: res.change.material }); console.log(`✓ confirmed: ${res.change.headline}`); }
      } else {
        await writeJson(pendingFile, { slug: s.slug, url, ts: observedTs, hash, source: r.source, lines: r.lines });
        summary.pending.push({ slug: s.slug, url });
        console.log(`? ${s.slug} ${url} changed; awaiting confirmation on next run`);
        st.lastChecked = ts; st.status = 'pending'; state.urls[key] = st; await writeState(s.slug, state);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await closeBrowser();
  await writeJson(path.join(ROOT, 'data', 'runs', 'latest.json'), summary);
  const hist = await readJson(path.join(ROOT, 'data', 'runs', 'history.json'), []);
  hist.push({ ranAt: summary.ranAt, checked: summary.checked, changed: summary.changed.length + summary.confirmed.length, unreachable: summary.unreachable.length, sources: summary.sources });
  await writeJson(path.join(ROOT, 'data', 'runs', 'history.json'), hist.slice(-400));
  console.log(`\nchecked ${summary.checked}; changed ${summary.changed.length}; confirmed ${summary.confirmed.length}; pending ${summary.pending.length}; unreachable ${summary.unreachable.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
