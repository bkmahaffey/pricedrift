// Bootstrap history from the Wayback Machine: one capture per month per tracked URL.
// Usage: node scripts/backfill.mjs [--from 2023-01] [--only slug] [--seed] [--limit N]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { htmlToLines } from './lib/text.mjs';
import { goodEnough, UA, sleep } from './lib/fetch.mjs';
import { observe } from './lib/pipeline.mjs';
import { loadServices } from './lib/catalog.mjs';
import { readState, ROOT, urlKey, writeJson, readJson } from './lib/store.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const FROM = (args.from || '2023-01').replace(/-/g, '').padEnd(8, '01');
const TO = (args.to || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
const ONLY = args.only ? String(args.only).split(',') : null;
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const PACE_MS = Number(args.pace || 1100);
const PRIMARY = !!args.primary;
const SPARSE = !!args.sparse; // before 2025: every other monthly capture
const LOG = path.join(ROOT, 'data', 'runs', 'backfill.log');
const PROGRESS = path.join(ROOT, 'data', 'runs', 'backfill-progress.json');

async function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  await fs.mkdir(path.dirname(LOG), { recursive: true });
  await fs.appendFile(LOG, line + '\n');
}

async function ia(url, { json = false } = {}) {
  let delay = 5000;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      const body = await r.text();
      const offline = body.includes('Internet Archive: Temporarily Offline') || body.includes('Wayback Machine has not archived');
      if (r.status === 429 || r.status >= 500 || (r.status === 200 && offline)) { await log(`  ia ${r.status}${offline ? ' offline' : ''}, backing off ${delay}ms`); await sleep(delay); delay = Math.min(delay * 2, 120000); continue; }
      if (json) { if (!body.trim().startsWith('[')) return []; return JSON.parse(body); }
      return { status: r.status, body };
    } catch (e) {
      await log(`  ia error ${e.message.slice(0, 60)}, backing off ${delay}ms`); await sleep(delay); delay = Math.min(delay * 2, 120000);
    }
  }
  return json ? [] : { status: 0, body: '' };
}

async function captures(url) {
  const q = new URLSearchParams({ url, output: 'json', from: FROM, to: TO, filter: 'statuscode:200', collapse: 'timestamp:6', fl: 'timestamp,digest' });
  const rows = await ia(`https://web.archive.org/cdx/search/cdx?${q}`, { json: true });
  const caps = rows.slice(1).map(([timestamp, digest]) => ({ timestamp, digest }));
  return SPARSE ? caps.filter((c, i) => c.timestamp >= '20250101' || i % 2 === 0 || i === caps.length - 1) : caps;
}

async function main() {
  let services;
  if (args.seed) services = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/seed/services.json'), 'utf8'));
  else services = await loadServices();
  if (ONLY) services = services.filter(s => ONLY.includes(s.slug));
  const progress = (await readJson(PROGRESS, { done: {} }));
  await log(`backfill start: ${services.length} services, from ${FROM} to ${TO}`);
  let fetched = 0;
  for (const s of services) {
    for (const url of (PRIMARY ? s.track_urls.slice(0, 1) : s.track_urls)) {
      const key = `${s.slug}|${url}`;
      if (progress.done[key]) continue;
      const state = await readState(s.slug);
      if (state.urls[urlKey(url)]?.latestTs) { progress.done[key] = 'had-state'; await writeJson(PROGRESS, progress); continue; }
      const caps = await captures(url);
      await sleep(PACE_MS);
      await log(`${s.slug} ${url}: ${caps.length} monthly captures`);
      let lastDigest = null, prevCount = 0, recorded = 0;
      for (const c of caps) {
        if (fetched >= LIMIT) break;
        if (c.digest === lastDigest) continue;
        const r = await ia(`https://web.archive.org/web/${c.timestamp}id_/${url}`);
        fetched++;
        await sleep(PACE_MS);
        if (r.status !== 200) { await log(`  ${c.timestamp}: HTTP ${r.status}`); continue; }
        const lines = htmlToLines(r.body);
        if (!goodEnough(lines, 25, 2)) { await log(`  ${c.timestamp}: thin capture (${lines.length} lines), skipped`); continue; }
        lastDigest = c.digest;
        const res = await observe(s, url, c.timestamp, lines, 'wayback', { serviceName: s.name });
        if (res.status === 'changed') { recorded++; await log(`  ${c.timestamp}: ${res.change.material ? 'MATERIAL' : 'minor'} ${res.change.headline}`); }
        prevCount = lines.length;
      }
      progress.done[key] = `${caps.length} captures, ${recorded} changes`;
      await writeJson(PROGRESS, progress);
    }
  }
  await log(`backfill done. fetched ${fetched} captures`);
}
main().catch(async e => { await log(`FATAL ${e.stack}`); process.exit(1); });
