// Static site generator for Pricedrift. Output: dist/
// Usage: node scripts/build.mjs [--seed] [--og]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadServices, CATEGORIES } from './lib/catalog.mjs';
import { headline as makeHeadline } from './lib/diff.mjs';
import { ROOT, readJson, readChanges, readState, urlKey, tsToIso } from './lib/store.mjs';
import { PROVIDERS } from './llm.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const site = await readJson(path.join(ROOT, 'config', 'site.json'));
const DIST = path.join(ROOT, 'dist');
const BASE = (site.basePath || '').replace(/\/$/, '');
const u = p => BASE + p;
const abs = p => site.url.replace(/\/$/, '') + p;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TODAY = new Date().toISOString().slice(0, 10);

// ---------- data ----------
let services;
if (args.seed) services = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/seed/services.json'), 'utf8')).sort((a, b) => a.name.localeCompare(b.name));
else services = await loadServices();
const bySlug = Object.fromEntries(services.map(s => [s.slug, s]));
const runs = await readJson(path.join(ROOT, 'data/runs/latest.json'), null);
const llm = await readJson(path.join(ROOT, 'data/llm/prices.json'), { models: {}, events: [] });

const all = [];
for (const s of services) {
  const changes = await readChanges(s.slug);
  const state = await readState(s.slug);
  s._state = state; s._changes = changes;
  for (const c of changes) {
    c.headline = makeHeadline({ ...c, pairs: c.pairs || [], added: c.added || [], removed: c.removed || [] }, s.name).replace(/^.*?: /, '');
    all.push({ ...c, service: s });
  }
  s._urlKeys = s.track_urls.map(urlKey);
  const primaryKey = s._urlKeys[0];
  s._lastChecked = Object.values(state.urls || {}).map(x => x.lastChecked).filter(Boolean).sort().pop() || null;
  s._lastMaterial = changes.filter(c => c.material && !c.flap && !c.transition).map(c => c.ts).sort().pop() || null;
  s._materialCount = changes.filter(c => c.material && !c.flap && !c.transition).length;
  s._minorCount = changes.filter(c => !c.material || c.flap || c.transition).length;
  s._primaryStatus = state.urls?.[primaryKey]?.status || 'unknown';
  s._stale = !!(s.verified_on && s._lastMaterial && s._lastMaterial.slice(0, 8) > String(s.verified_on).replace(/-/g, ''));
}
all.sort((a, b) => b.ts.localeCompare(a.ts));
const material = all.filter(c => c.material && !c.flap && !c.transition);
const firstDate = all.length ? all[all.length - 1].date : TODAY;
const llmEvents = (llm.events || []).filter(e => e.type === 'price' && !(e.flags || []).length).sort((a, b) => b.date.localeCompare(a.date));
// First-party model vendors lead the main feed; resellers and clouds (DeepInfra, OpenRouter, Bedrock, Vertex, Azure) have their own pages.
const PRIMARY = new Set(['openai', 'anthropic', 'gemini', 'mistral', 'deepseek', 'xai', 'groq', 'cohere', 'together_ai', 'fireworks_ai', 'perplexity', 'cerebras', 'ai21', 'voyage', 'elevenlabs', 'deepgram', 'assemblyai']);
const llmPrimary = llmEvents.filter(e => PRIMARY.has(e.provider));

// ---------- helpers ----------
const kindLabel = { price: 'Price', limits: 'Limits', plans: 'Plans', copy: 'Wording' };
function fmtDate(d) { return d; }
function svcUrl(s) { return u(`/s/${s.slug}/`); }
function catUrl(c) { return u(`/c/${c}/`); }
function waybackUrl(c) { return c.source === 'wayback' ? `https://web.archive.org/web/${c.ts}/${c.url}` : null; }
function statusText(st) { return { unreachable: ' · could not be fetched on the last check', suspicious: ' · last capture looked incomplete and was ignored', pending: ' · a change is awaiting confirmation' }[st] || ''; }
function short(str, n = 120) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }

function highlight(line, tokens) {
  // wrap each numeric token (in order) in <mark>
  let out = ''; let rest = line;
  for (const t of tokens) {
    if (t === null || t === undefined) continue;
    const i = rest.indexOf(t);
    if (i < 0) continue;
    out += esc(rest.slice(0, i)) + `<mark>${esc(t)}</mark>`;
    rest = rest.slice(i + t.length);
  }
  return out + esc(rest);
}

function renderDeltas(c) {
  const pairs = (c.pairs || []).slice(0, 6).filter(p => (p.deltas || []).length);
  if (!pairs.length) return '';
  return `<ol class="deltas">${pairs.map(p => `<li><span class="was">${highlight(short(p.before), p.deltas.map(d => d.before))}</span><span class="now">${highlight(short(p.after), p.deltas.map(d => d.after))}</span></li>`).join('')}</ol>`;
}

function renderDiff(c) {
  const removed = c.removed || [], added = c.added || [];
  const morePairs = (c.pairs || []).slice(6);
  if (!removed.length && !added.length && !morePairs.length) return '';
  const rows = [
    ...morePairs.flatMap(p => [`<div class="del">− ${esc(p.before)}</div>`, `<div class="add">+ ${esc(p.after)}</div>`]),
    ...removed.map(l => `<div class="del">− ${esc(l)}</div>`),
    ...added.map(l => `<div class="add">+ ${esc(l)}</div>`),
  ];
  const t = c.totals || {};
  return `<details class="diff"><summary>Diff: ${t.removed ?? removed.length} lines removed, ${t.added ?? added.length} added${(t.removed > removed.length || t.added > added.length) ? ' (showing lines with prices or limits)' : ''}</summary><div class="diff-body">${rows.join('')}</div></details>`;
}

function renderChange(c, { showService = true, id = true } = {}) {
  const s = c.service;
  const wb = waybackUrl(c);
  return `<article class="change kind-${c.kind}${c.flap ? ' flap' : ''}"${id ? ` id="${esc(c.id)}"` : ''}>
  <div class="change-meta"><time datetime="${esc(tsToIso(c.ts))}">${fmtDate(c.date)}</time>${showService ? ` <a class="svc" href="${svcUrl(s)}">${esc(s.name)}</a>` : ''} <span class="kind">${kindLabel[c.kind] || c.kind}</span>${c.flap ? ' <span class="kind flap">reverted</span>' : ''}${c.transition ? ' <span class="kind flap" title="First live capture after archived history; may include rendering differences rather than vendor changes">archive → live baseline</span>' : ''}</div>
  <h3 class="change-title">${esc(c.headline)}</h3>
  ${renderDeltas(c)}
  ${renderDiff(c)}
  <div class="change-foot"><a href="${esc(c.url)}" rel="nofollow">${esc(c.url.replace(/^https?:\/\/(www\.)?/, ''))}</a>${wb ? ` · <a href="${esc(wb)}" rel="nofollow">archived capture</a>` : ' · live check'}${c.prevTs ? ` · compared with ${c.source === 'wayback' ? `<a href="https://web.archive.org/web/${c.prevTs}/${esc(c.url)}" rel="nofollow">${c.prevTs.slice(0, 4)}-${c.prevTs.slice(4, 6)}-${c.prevTs.slice(6, 8)}</a>` : `${c.prevTs.slice(0, 4)}-${c.prevTs.slice(4, 6)}-${c.prevTs.slice(6, 8)}`}` : ''}</div>
</article>`;
}

function freeStatus(s) {
  const f = s.free_tier; if (!f) return { label: 'Not verified yet', cls: 'unknown' };
  return { free: { label: 'Free plan', cls: 'free' }, trial: { label: 'Trial only', cls: 'trial' }, credits: { label: 'Free credits', cls: 'credits' }, none: { label: 'No free tier', cls: 'none' }, unknown: { label: 'Unknown', cls: 'unknown' } }[f.status] || { label: f.status, cls: 'unknown' };
}
function paidFrom(s) {
  const p = s.paid_from; if (!p || !p.price) return null;
  const per = p.period && p.period !== 'usage' && p.period !== 'one-time' ? `/${p.period === 'month' ? 'mo' : p.period === 'year' ? 'yr' : p.period}` : '';
  const unit = p.unit && p.unit !== 'flat' && p.unit !== 'usage' ? ` ${p.unit}` : '';
  return `${p.price}${per}${unit}${p.plan_name ? ` · ${p.plan_name}` : ''}`;
}

function renderFacts(s) {
  const f = s.free_tier;
  const st = freeStatus(s);
  const src = (s.sources && s.sources[0]) || s.track_urls[0];
  if (!f) return `<section class="facts" aria-labelledby="facts-h"><h2 id="facts-h">Price Facts</h2><p class="facts-sub">${esc(s.name)}</p><div class="rule thick"></div><p class="facts-empty">Structured facts for this service have not been verified yet. The change history below is automatic and complete.</p></section>`;
  const limits = (f.limits || []);
  return `<section class="facts" aria-labelledby="facts-h">
  <h2 id="facts-h">Price Facts</h2>
  <p class="facts-sub">${esc(s.name)} · verified ${esc(s.verified_on)}</p>
  <div class="rule thick"></div>
  <div class="row big"><span>Free tier</span><strong class="status-${st.cls}">${st.label}${f.plan_name && f.status !== 'none' ? ` <em>“${esc(f.plan_name)}”</em>` : ''}</strong></div>
  ${f.status === 'trial' && f.trial_length ? `<div class="row"><span>Trial length</span><strong>${esc(f.trial_length)}</strong></div>` : ''}
  ${f.status === 'credits' && f.credit_amount ? `<div class="row"><span>Credits</span><strong>${esc(f.credit_amount)}</strong></div>` : ''}
  <div class="row"><span>Credit card required</span><strong>${f.credit_card_required === true ? 'Yes' : f.credit_card_required === false ? 'No' : 'Not stated'}</strong></div>
  ${limits.length ? `<div class="rule thick"></div><div class="row head"><span>Included${f.status === 'trial' ? ' in the trial' : f.status === 'credits' ? ' with credits' : ' free'}</span><span>Amount</span></div>
  ${limits.map(l => `<div class="row"><span>${esc(l.metric)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</span><strong>${esc(l.value)}</strong></div>`).join('')}` : ''}
  <div class="rule thick"></div>
  <div class="row big"><span>Paid from</span><strong>${paidFrom(s) ? esc(paidFrom(s)) : 'No public price'}</strong></div>
  ${(f.notes || []).length ? `<ul class="facts-notes">${f.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  <div class="rule mid"></div>
  <p class="facts-foot">Values as printed on <a href="${esc(src)}" rel="nofollow">${esc(src.replace(/^https?:\/\/(www\.)?/, ''))}</a> on ${esc(s.verified_on)}. ${s._stale ? `<strong>The page changed on ${s._lastMaterial.slice(0, 4)}-${s._lastMaterial.slice(4, 6)}-${s._lastMaterial.slice(6, 8)}, after verification; check the diff below.</strong>` : 'No price or limit changes detected since.'}</p>
</section>`;
}

function sponsorSlot() {
  const sp = site.sponsor || {};
  if (sp.enabled && sp.name && sp.url) return `<aside class="sponsor" aria-label="Sponsor"><span class="sponsor-k">Sponsor</span><a href="${esc(sp.url)}" rel="sponsored">${esc(sp.name)}</a><span class="sponsor-t">${esc(sp.tagline || '')}</span></aside>`;
  return `<aside class="sponsor open" aria-label="Sponsor"><span class="sponsor-k">Sponsor</span><a href="${u('/sponsor/')}">This slot is open</a><span class="sponsor-t">Reach developers comparing infrastructure pricing.</span></aside>`;
}

function layout({ title, description, path: p, body, feed, wide = false, ogImage, jsonLd }) {
  const fullTitle = p === '/' ? `${site.name} · ${site.tagline}` : `${title} · ${site.name}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<link rel="canonical" href="${esc(abs(p))}">
<link rel="icon" href="${u('/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${u('/styles.css')}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}: all price and limit changes" href="${u('/feed.xml')}">
${feed ? `<link rel="alternate" type="application/rss+xml" title="${esc(feed.title)}" href="${u(feed.href)}">` : ''}
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(abs(p))}">
<meta property="og:image" content="${esc(abs(ogImage || '/og/default.png'))}">
<meta name="twitter:card" content="summary_large_image">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="${u('/')}"><span class="brand-mark" aria-hidden="true">Δ$</span>${esc(site.name)}</a>
  <nav aria-label="Primary">
    <a href="${u('/changes/')}">Changes</a>
    <a href="${u('/digest/')}">Weekly</a>
    <a href="${u('/services/')}">Services</a>
    <a href="${u('/llm/')}">LLM prices</a>
    <a href="${u('/data/')}">Data</a>
    <a href="${u('/about/')}">About</a>
  </nav>
</header>
<main id="main" class="${wide ? 'wide' : ''}">
${body}
</main>
<footer class="foot">
  <p>${esc(site.name)} tracks ${services.length} developer services. ${material.length} price and limit changes recorded since ${firstDate}.${runs ? ` Last check ${runs.ranAt.slice(0, 10)}.` : ''}</p>
  <p><a href="${u('/feed.xml')}">RSS</a> · <a href="${u('/data/')}">JSON &amp; CSV</a> · <a href="${u('/sponsor/')}">Sponsor</a> · <a href="${esc(site.repo)}">Source on GitHub</a> · <a href="${u('/about/#corrections')}">Report an error</a></p>
  <p class="fine">Prices and limits are quoted from vendors' public pages and may be wrong or out of date. Not affiliated with any vendor. <a href="${u('/about/#disclosure')}">Referral disclosure</a>.</p>
</footer>
</body>
</html>`;
}

async function write(p, content) {
  const file = path.join(DIST, p.endsWith('/') ? p + 'index.html' : p);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

// ---------- pages ----------
const pages = [];
function page(p, opts) { pages.push(p); return write(p, layout({ ...opts, path: p })); }

function statsStrip() {
  const week = material.filter(c => c.ts >= tsMinusDays(7)).length;
  const month = material.filter(c => c.ts >= tsMinusDays(30)).length;
  return `<div class="stats" role="list">
    <div role="listitem"><strong>${services.length}</strong><span>services tracked</span></div>
    <div role="listitem"><strong>${material.length}</strong><span>changes since ${firstDate.slice(0, 4)}</span></div>
    <div role="listitem"><strong>${month}</strong><span>in the last 30 days</span></div>
    <div role="listitem"><strong>${week}</strong><span>this week</span></div>
  </div>`;
}
function tsMinusDays(n) { return new Date(Date.now() - n * 86400000).toISOString().replace(/[-:T]/g, '').slice(0, 14); }

// Home
{
  const latest = material.slice(0, 25);
  const body = `
<section class="lede">
  <h1>${esc(site.tagline)}</h1>
  <p>Every change to the pricing pages of ${services.length} developer and infrastructure services, with the actual diff. Checked daily, history back to ${firstDate.slice(0, 4)} from archived captures. <a href="${u('/feed.xml')}">RSS</a> and <a href="${u('/data/')}">open JSON</a> for all of it. No account, no newsletter wall.</p>
  ${statsStrip()}
</section>
<div class="cols">
<section class="feed" aria-labelledby="latest-h">
  <h2 id="latest-h">Latest changes</h2>
  ${latest.length ? latest.map(c => renderChange(c)).join('\n') : '<p class="empty">No changes recorded yet. The first daily check will populate this feed.</p>'}
  <p class="more"><a href="${u('/changes/')}">All ${material.length} changes →</a></p>
</section>
<aside class="side">
  ${sponsorSlot()}
  <nav class="cats" aria-labelledby="cats-h">
    <h2 id="cats-h">Categories</h2>
    <ul>${Object.entries(CATEGORIES).map(([k, c]) => { const n = services.filter(s => s.category === k).length; return n ? `<li><a href="${catUrl(k)}">${esc(c.name)}</a><span>${n}</span></li>` : ''; }).join('')}</ul>
  </nav>
  <section class="llm-mini" aria-labelledby="llm-h">
    <h2 id="llm-h">LLM API prices</h2>
    ${llmPrimary.length ? `<ul class="llm-list">${llmPrimary.slice(0, 6).map(e => `<li><time>${e.date}</time> <a href="${u(`/llm/${esc(e.provider)}/`)}">${esc(PROVIDERS[e.provider] || e.provider)}</a> <code>${esc(e.model)}</code> ${fmtLlmDelta(e)}</li>`).join('')}</ul><p class="more"><a href="${u('/llm/')}">All model price changes →</a></p>` : `<p>Per-model price history from a structured source, updated daily. <a href="${u('/llm/')}">See the timeline →</a></p>`}
  </section>
  <section class="subscribe" aria-labelledby="sub-h">
    <h2 id="sub-h">Follow</h2>
    <p><a href="${u('/feed.xml')}">All changes (RSS)</a> · every service and category page has its own feed. Works with any reader, Slack’s <code>/feed</code>, or Zapier.</p>
  </section>
</aside>
</div>`;
  await page('/', { title: site.name, body, wide: true });
}

function fmtLlmDelta(e) {
  const parts = [];
  if (e.before.input !== e.after.input) parts.push(`in $${e.before.input ?? '∅'}→<mark>$${e.after.input ?? '∅'}</mark>`);
  if (e.before.output !== e.after.output) parts.push(`out $${e.before.output ?? '∅'}→<mark>$${e.after.output ?? '∅'}</mark>`);
  return `<span class="llm-delta">${parts.join(' · ')} <small>per 1M tokens</small></span>`;
}

// Changes: all, by year
{
  const years = [...new Set(material.map(c => c.date.slice(0, 4)))].sort().reverse();
  const nav = (cur) => `<nav class="subnav" aria-label="Years"><a href="${u('/changes/')}"${!cur ? ' aria-current="page"' : ''}>Recent</a>${years.map(y => `<a href="${u(`/changes/${y}/`)}"${cur === y ? ' aria-current="page"' : ''}>${y}</a>`).join('')}<a href="${u('/changes/minor/')}"${cur === 'minor' ? ' aria-current="page"' : ''}>Wording-only edits</a></nav>`;
  const monthGroups = (list) => {
    const groups = new Map();
    for (const c of list) { const m = c.date.slice(0, 7); if (!groups.has(m)) groups.set(m, []); groups.get(m).push(c); }
    return [...groups.entries()].map(([m, cs]) => `<h2 class="month">${m}</h2>${cs.map(c => renderChange(c)).join('\n')}`).join('\n');
  };
  await page('/changes/', { title: 'All price and limit changes', description: `Every detected price, limit and plan change across ${services.length} developer services, newest first.`, body: `<h1>Changes</h1><p class="lede-p">Price, limit and plan changes detected on tracked pricing pages, newest first. Wording-only edits are listed separately.</p>${nav()}${monthGroups(material.slice(0, 150))}${material.length > 150 ? `<p class="more">Older changes are grouped by year above.</p>` : ''}`, wide: true });
  for (const y of years) {
    const list = material.filter(c => c.date.startsWith(y));
    await page(`/changes/${y}/`, { title: `Price and limit changes in ${y}`, description: `${list.length} price, limit and plan changes detected across developer services in ${y}.`, body: `<h1>Changes in ${y}</h1>${nav(y)}${monthGroups(list)}`, wide: true });
  }
  const minor = all.filter(c => !c.material || c.flap || c.transition).slice(0, 200);
  await page('/changes/minor/', { title: 'Wording-only edits and reverted changes', description: 'Pricing page edits where no price or limit change was detected, plus changes that were reverted.', body: `<h1>Wording-only edits</h1><p class="lede-p">Edits where the detector found no changed price or limit, changes that reverted within a capture or two (often A/B tests), and the first live capture after archived history (which can differ in rendering rather than substance). Kept for completeness; not in the main feed.</p>${nav('minor')}${minor.map(c => renderChange(c)).join('\n') || '<p class="empty">Nothing here yet.</p>'}`, wide: true });
}

// Weekly digests: one page per ISO week with at least one material change.
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - 3);
  return { key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, monday: monday.toISOString().slice(0, 10) };
}
{
  const weeks = new Map();
  for (const c of material) { const w = isoWeek(c.date); if (!weeks.has(w.key)) weeks.set(w.key, { ...w, changes: [] }); weeks.get(w.key).changes.push(c); }
  const list = [...weeks.values()].sort((a, b) => b.key.localeCompare(a.key));
  for (const w of list) {
    const byKind = { price: 0, limits: 0, plans: 0 }; for (const c of w.changes) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    const svcs = [...new Set(w.changes.map(c => c.service.name))];
    await page(`/digest/${w.key}/`, { title: `Developer pricing changes, week of ${w.monday}`, description: `${w.changes.length} price, limit and plan changes across ${svcs.length} developer services in the week of ${w.monday}: ${svcs.slice(0, 8).join(', ')}.`, body: `<p class="crumbs"><a href="${u('/digest/')}">Weekly digests</a></p><h1>Week of ${w.monday} <span class="h-sub">${w.key}</span></h1><p class="lede-p">${w.changes.length} change${w.changes.length === 1 ? '' : 's'} across ${svcs.length} service${svcs.length === 1 ? '' : 's'}: ${byKind.price} price, ${byKind.limits} limit, ${byKind.plans} plan-name. Services: ${svcs.map(n => esc(n)).join(', ')}.</p>${w.changes.map(c => renderChange(c)).join('\n')}`, wide: true });
  }
  await page('/digest/', { title: 'Weekly digests', description: 'Developer pricing changes grouped by week.', body: `<h1>Weekly digests</h1><p class="lede-p">Every week with at least one detected price, limit or plan change. The <a href="${u('/feed.xml')}">RSS feed</a> carries the same entries as they happen.</p><ul class="digest-list">${list.map(w => `<li><a href="${u(`/digest/${w.key}/`)}">Week of ${w.monday}</a> <span>${w.changes.length} change${w.changes.length === 1 ? '' : 's'} · ${[...new Set(w.changes.map(c => c.service.name))].slice(0, 5).map(n => esc(n)).join(', ')}${new Set(w.changes.map(c => c.service.name)).size > 5 ? ', …' : ''}</span></li>`).join('')}</ul>` });
}

// Services index
{
  const groups = Object.entries(CATEGORIES).map(([k, c]) => {
    const list = services.filter(s => s.category === k);
    if (!list.length) return '';
    return `<section class="svc-group" aria-labelledby="g-${k}"><h2 id="g-${k}"><a href="${catUrl(k)}">${esc(c.name)}</a></h2><ul class="svc-list">${list.map(s => `<li><a href="${svcUrl(s)}">${esc(s.name)}</a> <span class="pill status-${freeStatus(s).cls}">${freeStatus(s).label}</span>${s._lastMaterial ? `<span class="last">changed ${s._lastMaterial.slice(0, 4)}-${s._lastMaterial.slice(4, 6)}-${s._lastMaterial.slice(6, 8)}</span>` : ''}</li>`).join('')}</ul></section>`;
  }).join('');
  await page('/services/', { title: 'All tracked services', description: `Pricing history and free tier facts for ${services.length} developer services.`, body: `<h1>Services</h1><p class="lede-p">${services.length} services, grouped by category. Each page has the current free tier facts, every detected pricing change since ${firstDate.slice(0, 4)}, and its own RSS feed.</p><p class="filter-wrap"><label for="q">Filter</label> <input id="q" type="search" placeholder="Type a service name" autocomplete="off"></p>${groups}<script>document.documentElement.classList.add('js');const q=document.getElementById('q');q.addEventListener('input',()=>{const v=q.value.trim().toLowerCase();document.querySelectorAll('.svc-list li').forEach(li=>{li.hidden=v&&!li.textContent.toLowerCase().includes(v)});document.querySelectorAll('.svc-group').forEach(g=>{g.hidden=![...g.querySelectorAll('li')].some(li=>!li.hidden)})});</script>`, wide: true });
}

// Category pages
for (const [k, c] of Object.entries(CATEGORIES)) {
  const list = services.filter(s => s.category === k);
  if (!list.length) continue;
  const rows = list.map(s => {
    const st = freeStatus(s);
    const lim = (s.free_tier?.limits || []).slice(0, 3).map(l => `${esc(l.metric)}: <strong>${esc(l.value)}</strong>`).join('<br>');
    return `<tr><th scope="row"><a href="${svcUrl(s)}">${esc(s.name)}</a><br><small>${esc(s.tagline || '')}</small></th><td><span class="pill status-${st.cls}">${st.label}</span>${s.free_tier?.plan_name && s.free_tier.status !== 'none' ? `<br><small>${esc(s.free_tier.plan_name)}</small>` : ''}</td><td class="limits">${lim || '<span class="muted">not stated</span>'}</td><td class="num">${paidFrom(s) ? esc(paidFrom(s)) : '<span class="muted">not stated</span>'}</td><td class="num">${s._lastMaterial ? `<a href="${svcUrl(s)}#history">${s._lastMaterial.slice(0, 4)}-${s._lastMaterial.slice(4, 6)}-${s._lastMaterial.slice(6, 8)}</a>` : '<span class="muted">none yet</span>'}</td></tr>`;
  }).join('');
  const recent = material.filter(x => x.service.category === k).slice(0, 15);
  await page(catUrl(k).replace(BASE, ''), { title: `${c.name}: free tiers and pricing changes`, description: `${c.blurb} Free tier limits, entry prices and every detected pricing change for ${list.length} services.`, feed: { title: `${c.name} pricing changes`, href: `/c/${k}/feed.xml` }, body: `<h1>${esc(c.name)}</h1><p class="lede-p">${esc(c.blurb)} ${list.length} services. <a href="${u(`/c/${k}/feed.xml`)}">RSS for this category</a>.</p>
<div class="table-wrap"><table class="compare"><thead><tr><th scope="col">Service</th><th scope="col">Free tier</th><th scope="col">Key limits</th><th scope="col" class="num">Paid from</th><th scope="col" class="num">Last change</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Recent changes in ${esc(c.name.toLowerCase())}</h2>${recent.map(x => renderChange(x)).join('\n') || '<p class="empty">No price or limit changes detected yet in this category.</p>'}`, wide: true });
}

// Service pages
for (const s of services) {
  const mat = s._changes.filter(c => c.material && !c.flap && !c.transition).sort((a, b) => b.ts.localeCompare(a.ts)).map(c => ({ ...c, service: s }));
  const minor = s._changes.filter(c => !c.material || c.flap || c.transition).sort((a, b) => b.ts.localeCompare(a.ts)).map(c => ({ ...c, service: s }));
  const st = s._state.urls || {};
  const related = services.filter(x => x.category === s.category && x.slug !== s.slug).slice(0, 8);
  const status = Object.values(st).some(x => x.status === 'unreachable') ? `<p class="notice">One of this service’s pages could not be fetched on the last check; history continues from the last good capture.</p>` : '';
  const visit = s.referral ? `<a class="btn" href="${esc(s.referral)}" rel="sponsored nofollow">Try ${esc(s.name)} <small>(referral link)</small></a>` : `<a class="btn" href="${esc(s.website)}" rel="nofollow">Visit ${esc(s.name)}</a>`;
  const body = `
<div class="svc-head">
  <p class="crumbs"><a href="${u('/services/')}">Services</a> / <a href="${catUrl(s.category)}">${esc(CATEGORIES[s.category].name)}</a></p>
  <h1>${esc(s.name)} <span class="h-sub">pricing history</span></h1>
  <p class="tagline">${esc(s.tagline || '')}</p>
  <p class="svc-links">${visit} <a class="btn ghost" href="${u(`/s/${s.slug}/feed.xml`)}">RSS</a> <a class="btn ghost" href="${u(`/api/services/${s.slug}.json`)}">JSON</a></p>
</div>
<div class="cols svc-cols">
<div>
  ${renderFacts(s)}
  <section class="tracked" aria-labelledby="tracked-h"><h2 id="tracked-h">Tracked pages</h2><ul>${s.track_urls.map(url => { const x = st[urlKey(url)] || {}; return `<li><a href="${esc(url)}" rel="nofollow">${esc(url.replace(/^https?:\/\/(www\.)?/, ''))}</a><small>${x.lastChecked ? `${x.lastSource === 'wayback' ? 'last archived capture' : 'checked'} ${x.lastChecked.slice(0, 4)}-${x.lastChecked.slice(4, 6)}-${x.lastChecked.slice(6, 8)}` : 'not checked yet'}${statusText(x.status)}${x.firstTs ? ` · history from ${x.firstTs.slice(0, 4)}-${x.firstTs.slice(4, 6)}` : ''}</small></li>`; }).join('')}</ul></section>
</div>
<div>
  ${status}
  <section id="history" aria-labelledby="hist-h">
    <h2 id="hist-h">Changes <span class="count">${mat.length}</span></h2>
    ${mat.length ? mat.map(c => renderChange(c, { showService: false })).join('\n') : `<p class="empty">No price or limit changes detected on ${esc(s.name)}’s pricing page since tracking began${st[s._urlKeys[0]]?.firstTs ? ` in ${st[s._urlKeys[0]].firstTs.slice(0, 4)}-${st[s._urlKeys[0]].firstTs.slice(4, 6)}` : ''}. When one happens it will appear here and in the feed within a day.</p>`}
    ${minor.length ? `<details class="minor"><summary>${minor.length} wording-only, reverted, or baseline edit${minor.length === 1 ? '' : 's'}</summary>${minor.map(c => renderChange(c, { showService: false })).join('\n')}</details>` : ''}
  </section>
  ${related.length ? `<nav class="related" aria-labelledby="rel-h"><h2 id="rel-h">Also in ${esc(CATEGORIES[s.category].name.toLowerCase())}</h2><ul>${related.map(r => `<li><a href="${svcUrl(r)}">${esc(r.name)}</a> <span class="pill status-${freeStatus(r).cls}">${freeStatus(r).label}</span></li>`).join('')}</ul></nav>` : ''}
</div>
</div>`;
  const desc = s.free_tier ? `${s.name} free tier: ${freeStatus(s).label}${(s.free_tier.limits || []).slice(0, 3).map(l => `, ${l.metric} ${l.value}`).join('')}. Paid from ${paidFrom(s) || 'n/a'}. ${mat.length} pricing changes recorded.` : `${s.name} pricing history: ${mat.length} detected price and limit changes, with diffs.`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Services', item: abs('/services/') },
    { '@type': 'ListItem', position: 2, name: CATEGORIES[s.category].name, item: abs(`/c/${s.category}/`) },
    { '@type': 'ListItem', position: 3, name: s.name, item: abs(`/s/${s.slug}/`) } ] };
  await page(`/s/${s.slug}/`, { title: `${s.name} pricing history and free tier`, description: desc, feed: { title: `${s.name} pricing changes`, href: `/s/${s.slug}/feed.xml` }, ogImage: `/og/${s.slug}.png`, body, wide: true, jsonLd });
}

// LLM pages
{
  const provs = Object.keys(PROVIDERS).filter(p => Object.values(llm.models).some(m => m.provider === p && !m.removed));
  const table = (rows) => `<div class="table-wrap"><table class="llm"><thead><tr><th scope="col">Date</th><th scope="col">Provider</th><th scope="col">Model</th><th scope="col" class="num">Input $/1M</th><th scope="col" class="num">Output $/1M</th></tr></thead><tbody>${rows.map(e => `<tr><td><time>${e.date}</time></td><td><a href="${u(`/llm/${esc(e.provider)}/`)}">${esc(PROVIDERS[e.provider] || e.provider)}</a></td><td><code>${esc(e.model)}</code></td><td class="num">${e.before.input === e.after.input ? `$${e.after.input ?? '∅'}` : `<s>$${e.before.input ?? '∅'}</s> <mark>$${e.after.input ?? '∅'}</mark>${pct(e.pct.input)}`}</td><td class="num">${e.before.output === e.after.output ? `$${e.after.output ?? '∅'}` : `<s>$${e.before.output ?? '∅'}</s> <mark>$${e.after.output ?? '∅'}</mark>${pct(e.pct.output)}`}</td></tr>`).join('')}</tbody></table></div>`;
  function pct(p) { return p === null || p === undefined ? '' : ` <small class="${p < 0 ? 'down' : 'up'}">${p > 0 ? '+' : ''}${p}%</small>`; }
  const shown = llmEvents.filter(e => PROVIDERS[e.provider]);
  const shownPrimary = llmPrimary;
  await page('/llm/', { title: 'LLM API price changes', description: 'A dated log of every per-token price change for OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek and other model APIs, from a structured source.', feed: { title: 'LLM API price changes', href: '/llm/feed.xml' }, body: `<h1>LLM API price changes</h1><p class="lede-p">Per-model input and output prices, in dollars per million tokens, from the community-maintained <a href="https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json">LiteLLM price table</a>, sampled weekly back through its git history and checked daily. Dates are when the table was updated, which can lag a vendor announcement by days. Corrections that revert within 45 days are hidden. ${Object.keys(llm.models).length} models, ${shown.length} price changes; the table below lists first-party vendors (${shownPrimary.length}), and clouds and resellers are on their own pages. <a href="${u('/llm/feed.xml')}">RSS</a> · <a href="${u('/api/llm-events.json')}">JSON</a>.</p>
<nav class="subnav" aria-label="Providers">${provs.map(p => `<a href="${u(`/llm/${p}/`)}">${esc(PROVIDERS[p])}</a>`).join('')}</nav>
${shownPrimary.length ? table(shownPrimary.slice(0, 300)) : '<p class="empty">The price history has not been generated yet.</p>'}`, wide: true });
  for (const p of provs) {
    const evs = shown.filter(e => e.provider === p);
    const models = Object.entries(llm.models).filter(([, m]) => m.provider === p && !m.removed && (m.mode === 'chat' || m.mode === 'responses')).sort((a, b) => (b[1].lastSeen || '').localeCompare(a[1].lastSeen || '') || a[0].localeCompare(b[0]));
    await page(`/llm/${p}/`, { title: `${PROVIDERS[p]} API price history`, description: `Current per-token prices and every recorded price change for ${PROVIDERS[p]} models.`, body: `<p class="crumbs"><a href="${u('/llm/')}">LLM prices</a></p><h1>${esc(PROVIDERS[p])} <span class="h-sub">API price history</span></h1>
<h2>Price changes <span class="count">${evs.length}</span></h2>${evs.length ? table(evs) : '<p class="empty">No price changes recorded for this provider yet.</p>'}
<h2>Current prices <span class="count">${models.length}</span></h2><div class="table-wrap"><table class="llm"><thead><tr><th scope="col">Model</th><th scope="col" class="num">Input $/1M</th><th scope="col" class="num">Output $/1M</th><th scope="col" class="num">Context</th><th scope="col">Since</th></tr></thead><tbody>${models.map(([id, m]) => `<tr><td><code>${esc(id)}</code></td><td class="num">${m.current.input ?? '—'}</td><td class="num">${m.current.output ?? '—'}</td><td class="num">${m.context ? m.context.toLocaleString('en-US') : '—'}</td><td><time>${m.history[m.history.length - 1].date}</time></td></tr>`).join('')}</tbody></table></div>`, wide: true });
  }
}

// Data, About, Sponsor
await page('/data/', { title: 'Open data: JSON and CSV', description: 'Download every tracked service, change and LLM price event as JSON or CSV. CC BY 4.0.', jsonLd: { '@context': 'https://schema.org', '@type': 'Dataset', name: `${site.name} developer pricing changes`, description: site.description, url: abs('/data/'), license: 'https://creativecommons.org/licenses/by/4.0/', creator: { '@type': 'Organization', name: site.name, url: abs('/') }, distribution: [ { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: abs('/api/changes.json') }, { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: abs('/api/changes.csv') }, { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: abs('/api/llm-prices.json') } ] }, body: `<h1>Data</h1><p class="lede-p">Everything on this site is generated from files you can download. Licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>: use it, credit ${esc(site.name)}.</p>
<dl class="api">
<dt><a href="${u('/api/services.json')}">/api/services.json</a></dt><dd>All ${services.length} services with category, tracked pages, free tier facts, entry price and verification date.</dd>
<dt><a href="${u('/api/changes.json')}">/api/changes.json</a></dt><dd>All ${material.length} price and limit changes with paired before/after lines and removed/added lines.</dd>
<dt><a href="${u('/api/changes.csv')}">/api/changes.csv</a></dt><dd>One row per change: date, service, kind, headline, url.</dd>
<dt><code>/api/services/&lt;slug&gt;.json</code></dt><dd>One service, its facts and full change history, e.g. <a href="${u(`/api/services/${services[0]?.slug}.json`)}">${esc(services[0]?.slug)}</a>.</dd>
<dt><a href="${u('/api/llm-prices.json')}">/api/llm-prices.json</a></dt><dd>Per-model price history for ${Object.keys(llm.models).length} LLM API models.</dd>
<dt><a href="${u('/api/llm-events.json')}">/api/llm-events.json</a></dt><dd>Dated LLM price change events.</dd>
<dt><a href="${u('/feed.xml')}">/feed.xml</a>, <code>/s/&lt;slug&gt;/feed.xml</code>, <code>/c/&lt;category&gt;/feed.xml</code>, <a href="${u('/llm/feed.xml')}">/llm/feed.xml</a></dt><dd>RSS 2.0 feeds.</dd>
</dl>
<h2>How it is collected</h2><p>A scheduled job fetches each tracked page daily, extracts the visible text, and diffs it against the previous capture. Lines containing prices, quantities with units, or plan names count as material; other edits are filed as wording-only. A change is published only after it is seen on two consecutive days, to filter A/B tests. History before tracking began comes from monthly Wayback Machine captures. Source code is on <a href="${esc(site.repo)}">GitHub</a>.</p>` });

await page('/about/', { title: 'About and methodology', description: `How ${site.name} detects pricing changes, what it gets wrong, and how to report corrections.`, body: `<h1>About</h1>
<p class="lede-p">${esc(site.name)} exists because pricing pages change quietly. Plans get renamed, free tiers shrink, a per-seat price moves by five dollars, and the only record is a screenshot someone posted. This site keeps the record automatically.</p>
<h2>What counts as a change</h2><p>Each tracked page is reduced to its visible text lines. A line is <em>material</em> when it contains a currency amount, a quantity with a unit (GB, requests, seats, minutes, and so on), or a plan name. When material lines change between two captures, the change is classified as a <strong>price</strong> change (a currency amount moved), a <strong>limits</strong> change (a quantity moved), or a <strong>plans</strong> change (a plan name appeared or disappeared). Lines that change without touching a price or limit are filed as wording-only edits and kept off the main feed.</p>
<h2>What it gets wrong</h2><ul><li>Pages that render prices only with JavaScript or behind region or currency selectors may be captured with fewer prices than a person would see. The tracker falls back to a headless browser, then to the latest archived capture.</li><li>Archived history is monthly, so a change dated 2024-05-06 happened at some point between the previous capture and that date.</li><li>Marketing copy that contains numbers ("trusted by 20,000 teams") can be misread as a limit. Common patterns are filtered; some slip through.</li><li>Structured facts are verified by hand on the date shown and can go stale. When the page changes after that date, the facts panel says so.</li></ul>
<h2 id="corrections">Corrections</h2><p>Open an issue or a pull request on <a href="${esc(site.repo)}">GitHub</a>. Each service is a small YAML file; fixing a limit is a one-line change.</p>
<h2 id="disclosure">Referral disclosure</h2><p>Some "Try" links on service pages are referral links. If you sign up through one, the vendor may pay this site a commission at no cost to you. Referral links never affect what is tracked, how changes are classified, or which services are listed. Every referral link is marked as such next to the link.</p>
<h2>Contact</h2><p>${site.contactEmail ? `<a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>` : `Via <a href="${esc(site.repo)}/issues">GitHub issues</a>.`}</p>` });

await page('/sponsor/', { title: 'Sponsor', description: `Sponsor ${site.name} and reach developers comparing infrastructure pricing.`, body: `<h1>Sponsor ${esc(site.name)}</h1>
<p class="lede-p">One sponsor at a time, shown on every page and in the RSS feed description. Readers are developers and founders actively comparing hosting, database, AI and tooling prices.</p>
<h2>What you get</h2><ul><li>Your name, one line of text and a link in the sponsor slot on every page of the site (all ${services.length} service pages, every category and changelog page) for the month.</li><li>A line in the site’s RSS feed description.</li><li>No tracking pixels, no popups. The slot is plain text and clearly labeled.</li></ul>
<h2>What it costs</h2><p>Priced monthly. ${site.sponsor?.checkoutUrl ? `<a class="btn" href="${esc(site.sponsor.checkoutUrl)}">Book the slot</a>` : `Get in touch ${site.contactEmail ? `at <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>` : `via <a href="${esc(site.repo)}/issues/new?title=Sponsorship">GitHub</a>`} and you will get current traffic numbers and the price.`}</p>
<h2>What is not for sale</h2><p>Listings, classifications and facts. Sponsors cannot be removed from tracking, and sponsorship is never mentioned in change entries.</p>` });

// 404
await write('/404.html', layout({ title: 'Not found', path: '/404.html', body: `<h1>Not found</h1><p class="lede-p">That page does not exist. Try the <a href="${u('/services/')}">services list</a> or the <a href="${u('/changes/')}">changelog</a>.</p>` }));

// ---------- feeds ----------
function rss({ title, link, description, items }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(title)}</title>
<link>${esc(link)}</link>
<atom:link href="${esc(link.replace(/\/$/, ''))}${esc(items.href)}" rel="self" type="application/rss+xml"/>
<description>${esc(description)}</description>
<language>en</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.list.map(i => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.link)}</link>
<guid isPermaLink="false">${esc(i.guid)}</guid>
<pubDate>${new Date(i.iso).toUTCString()}</pubDate>
<description>${esc(i.summary)}</description>
<content:encoded><![CDATA[${i.html}]]></content:encoded>
</item>`).join('\n')}
</channel>
</rss>`;
}
function changeItem(c) {
  const s = c.service;
  return { title: `${s.name}: ${c.headline}`, link: abs(`/s/${s.slug}/#${c.id}`), guid: `${s.slug}/${c.id}`, iso: tsToIso(c.ts), summary: `${s.name}: ${c.headline}`, html: `<p><a href="${abs(`/s/${s.slug}/`)}">${esc(s.name)}</a> · ${kindLabel[c.kind]} · ${c.date}</p>${renderDeltas(c)}${renderDiff(c).replace(/<details class="diff">|<\/details>|<summary>.*?<\/summary>/g, '')}` };
}
const sponsorLine = site.sponsor?.enabled && site.sponsor.name ? ` Sponsored by ${site.sponsor.name}.` : '';
await write('/feed.xml', rss({ title: `${site.name}: developer pricing changes`, link: abs('/'), description: site.description + sponsorLine, items: { href: '/feed.xml', list: material.slice(0, 100).map(changeItem) } }));
for (const s of services) await write(`/s/${s.slug}/feed.xml`, rss({ title: `${s.name} pricing changes · ${site.name}`, link: abs(`/s/${s.slug}/`), description: `Price, limit and plan changes detected on ${s.name}'s pricing page.` + sponsorLine, items: { href: `/s/${s.slug}/feed.xml`, list: material.filter(c => c.service.slug === s.slug).slice(0, 50).map(changeItem) } }));
for (const k of Object.keys(CATEGORIES)) if (services.some(s => s.category === k)) await write(`/c/${k}/feed.xml`, rss({ title: `${CATEGORIES[k].name} pricing changes · ${site.name}`, link: abs(`/c/${k}/`), description: CATEGORIES[k].blurb + sponsorLine, items: { href: `/c/${k}/feed.xml`, list: material.filter(c => c.service.category === k).slice(0, 100).map(changeItem) } }));
await write('/llm/feed.xml', rss({ title: `LLM API price changes · ${site.name}`, link: abs('/llm/'), description: 'Per-model price changes for LLM APIs.' + sponsorLine, items: { href: '/llm/feed.xml', list: llmPrimary.slice(0, 100).map(e => ({ title: `${PROVIDERS[e.provider]} ${e.model}: input $${e.before.input}→$${e.after.input}, output $${e.before.output}→$${e.after.output} per 1M tokens`, link: abs(`/llm/${e.provider}/`), guid: `llm/${e.model}/${e.date}`, iso: `${e.date}T12:00:00Z`, summary: `${e.model} price change on ${e.date}`, html: `<p>${esc(e.model)} (${esc(PROVIDERS[e.provider])}) on ${e.date}: input $${e.before.input} → $${e.after.input}, output $${e.before.output} → $${e.after.output} per 1M tokens.</p>` })) } }));

// ---------- JSON / CSV ----------
const pub = s => ({ slug: s.slug, name: s.name, category: s.category, website: s.website, tagline: s.tagline || null, track_urls: s.track_urls, free_tier: s.free_tier || null, paid_from: s.paid_from || null, verified_on: s.verified_on || null, sources: s.sources || null, url: abs(`/s/${s.slug}/`) });
const pubChange = c => ({ id: c.id, service: c.service.slug, date: c.date, ts: c.ts, kind: c.kind, material: c.material, flap: !!c.flap, headline: c.headline, url: c.url, source: c.source, pairs: c.pairs, added: c.added, removed: c.removed, counts: c.counts, totals: c.totals });
await write('/api/services.json', JSON.stringify({ generated: new Date().toISOString(), license: 'CC BY 4.0', count: services.length, services: services.map(pub) }, null, 1));
await write('/api/changes.json', JSON.stringify({ generated: new Date().toISOString(), license: 'CC BY 4.0', count: material.length, changes: material.map(pubChange) }, null, 1));
await write('/api/changes.csv', 'date,service,kind,headline,url\n' + material.map(c => [c.date, c.service.slug, c.kind, `"${c.headline.replace(/"/g, '""')}"`, c.url].join(',')).join('\n') + '\n');
for (const s of services) await write(`/api/services/${s.slug}.json`, JSON.stringify({ ...pub(s), changes: s._changes.map(c => pubChange({ ...c, service: s })) }, null, 1));
await write('/api/llm-prices.json', JSON.stringify({ generated: new Date().toISOString(), license: 'CC BY 4.0', source: 'https://github.com/BerriAI/litellm', unit: 'USD per 1M tokens', models: llm.models }, null, 0));
await write('/api/llm-events.json', JSON.stringify({ generated: new Date().toISOString(), license: 'CC BY 4.0', unit: 'USD per 1M tokens', events: llm.events || [] }, null, 0));

// ---------- static, sitemap, robots ----------
await fs.cp(path.join(ROOT, 'site/static'), DIST, { recursive: true });
await fs.copyFile(path.join(ROOT, 'site/styles.css'), path.join(DIST, 'styles.css'));
await write('/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `<url><loc>${esc(abs(p))}</loc></url>`).join('\n')}\n</urlset>\n`);
await write('/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('/sitemap.xml')}\n`);

// ---------- OG images (optional, needs Playwright) ----------
if (args.og) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const og = (title, sub, big) => `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#fbfbfc;color:#1a1c22;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:64px;box-sizing:border-box;border:14px solid #1a1c22"><div style="font-size:30px;font-weight:700;letter-spacing:-.01em"><span style="background:#ffe14d;padding:2px 10px;border-radius:6px;margin-right:14px">Δ$</span>${esc(site.name)}</div><div><div style="font-size:${big ? 88 : 64}px;font-weight:900;line-height:1.02;letter-spacing:-.03em;max-width:1000px">${esc(title)}</div><div style="font-size:32px;margin-top:22px;color:#3a3d47">${esc(sub)}</div></div><div style="font-size:26px;color:#3a3d47">${esc(site.url.replace(/^https?:\/\//, ''))}</div></body></html>`;
  await fs.mkdir(path.join(DIST, 'og'), { recursive: true });
  await pg.setContent(og(site.tagline, `Every change to ${services.length} developer pricing pages, with the diff.`, false));
  await pg.screenshot({ path: path.join(DIST, 'og', 'default.png') });
  for (const s of services) {
    await pg.setContent(og(`${s.name} pricing history`, s.free_tier ? `${freeStatus(s).label}${paidFrom(s) ? ` · paid from ${paidFrom(s)}` : ''} · ${s._materialCount} changes recorded` : `${s._materialCount} pricing changes recorded`, true));
    await pg.screenshot({ path: path.join(DIST, 'og', `${s.slug}.png`) });
  }
  await browser.close();
}

console.log(`built ${pages.length} pages, ${services.length} services, ${material.length} material changes, ${llmEvents.length} LLM events → dist/`);
