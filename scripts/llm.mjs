// LLM API price history from LiteLLM's community-maintained price table (git history) — structured, no scraping.
// Usage:
//   node scripts/llm.mjs --backfill --repo /path/to/litellm [--every 7]   # sample one commit per N days
//   node scripts/llm.mjs                                                  # daily update from raw.githubusercontent.com
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJson, writeJson } from './lib/store.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const FILE = 'model_prices_and_context_window.json';
const RAW = `https://raw.githubusercontent.com/BerriAI/litellm/main/${FILE}`;
const OUT = path.join(ROOT, 'data', 'llm', 'prices.json');

// Providers shown on the site, with display names. Everything else is kept in the data but not rendered.
export const PROVIDERS = {
  openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', mistral: 'Mistral', deepseek: 'DeepSeek', xai: 'xAI',
  groq: 'Groq', cohere: 'Cohere', together_ai: 'Together AI', fireworks_ai: 'Fireworks AI', perplexity: 'Perplexity',
  cerebras: 'Cerebras', 'openrouter': 'OpenRouter', bedrock: 'Amazon Bedrock', vertex_ai: 'Google Vertex AI', azure: 'Azure OpenAI',
  'azure_ai': 'Azure AI', 'anyscale': 'Anyscale', 'deepinfra': 'DeepInfra', 'ai21': 'AI21', 'nvidia_nim': 'NVIDIA NIM', 'sambanova': 'SambaNova',
  'voyage': 'Voyage AI', 'elevenlabs': 'ElevenLabs', 'deepgram': 'Deepgram', 'assemblyai': 'AssemblyAI', 'replicate': 'Replicate', 'cloudflare': 'Cloudflare Workers AI',
};

// Collapse LiteLLM's provider variants onto the display providers.
export function normProvider(p) {
  if (!p) return 'unknown';
  if (p.startsWith('vertex_ai')) return 'vertex_ai';
  if (p.startsWith('bedrock')) return 'bedrock';
  if (p.startsWith('azure') && p !== 'azure_ai') return 'azure';
  return p;
}
const perM = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1e6 * 1e6) / 1e6 : null; // $/token → $/1M tokens, 6dp

export function normalize(table) {
  const out = {};
  for (const [id, m] of Object.entries(table)) {
    if (id === 'sample_spec' || !m || typeof m !== 'object') continue;
    const provider = normProvider(m.litellm_provider);
    const mode = m.mode || 'chat';
    if (!['chat', 'completion', 'embedding', 'audio_transcription', 'audio_speech', 'image_generation', 'rerank', 'responses'].includes(mode)) continue;
    const input = perM(m.input_cost_per_token), output = perM(m.output_cost_per_token);
    if (input === null && output === null) continue;
    out[id] = {
      provider, mode,
      input, output,
      cachedInput: perM(m.cache_read_input_token_cost),
      context: m.max_input_tokens || m.max_tokens || null,
      maxOutput: m.max_output_tokens || null,
    };
  }
  return out;
}

function fmt(v) { return v === null || v === undefined ? '∅' : `$${v}`; }

// Apply one dated table to the accumulated history; returns events created.
export function applySnapshot(store, date, table, source) {
  const norm = normalize(table);
  const events = [];
  store.models ||= {};
  const seen = new Set();
  for (const [id, cur] of Object.entries(norm)) {
    seen.add(id);
    const rec = store.models[id];
    if (!rec) {
      store.models[id] = { provider: cur.provider, mode: cur.mode, context: cur.context, maxOutput: cur.maxOutput, cachedInput: cur.cachedInput, current: { input: cur.input, output: cur.output }, firstSeen: date, lastSeen: date, history: [{ date, input: cur.input, output: cur.output }] };
      if (store.initialized) events.push({ date, model: id, provider: cur.provider, type: 'added', input: cur.input, output: cur.output, source });
      continue;
    }
    rec.lastSeen = date; rec.context = cur.context ?? rec.context; rec.maxOutput = cur.maxOutput ?? rec.maxOutput; rec.cachedInput = cur.cachedInput ?? rec.cachedInput; rec.provider = cur.provider; rec.mode = cur.mode;
    if (rec.removed) { delete rec.removed; events.push({ date, model: id, provider: cur.provider, type: 're-added', input: cur.input, output: cur.output, source }); }
    if (rec.current.input !== cur.input || rec.current.output !== cur.output) {
      const ev = { date, model: id, provider: cur.provider, type: 'price', before: { ...rec.current }, after: { input: cur.input, output: cur.output }, source };
      const pct = (a, b) => (a && b) ? Math.round(((b - a) / a) * 1000) / 10 : null;
      ev.pct = { input: pct(rec.current.input, cur.input), output: pct(rec.current.output, cur.output) };
      events.push(ev);
      rec.current = { input: cur.input, output: cur.output };
      rec.history.push({ date, input: cur.input, output: cur.output });
    }
  }
  for (const [id, rec] of Object.entries(store.models)) {
    if (!seen.has(id) && !rec.removed) { rec.removed = date; if (store.initialized) events.push({ date, model: id, provider: rec.provider, type: 'removed', source }); }
  }
  store.events ||= [];
  store.events.push(...events);
  store.initialized = true;
  store.lastDate = date;
  store.lastSource = source;
  return events;
}

// Annotate events that are not real price changes: a field appearing/disappearing, or a value that
// reverts within 45 days (a correction to the table rather than a vendor change).
export function postProcess(store) {
  const price = (store.events || []).filter(e => e.type === 'price');
  for (const e of price) {
    e.flags = [];
    if ([e.before.input, e.before.output, e.after.input, e.after.output].some(v => v === null || v === undefined)) e.flags.push('null-field');
  }
  const byModel = {};
  for (const e of price) (byModel[e.model] ||= []).push(e);
  for (const list of Object.values(byModel)) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const days = (new Date(b.date) - new Date(a.date)) / 86400000;
      if (days <= 45 && a.before.input === b.after.input && a.before.output === b.after.output) { a.flags.push('correction'); b.flags.push('correction'); }
    }
  }
  return store;
}

async function backfill() {
  const repo = args.repo;
  if (!repo) throw new Error('--repo required');
  const every = Number(args.every || 7);
  const log = execFileSync('git', ['log', '--reverse', '--format=%H %cs', '--', FILE], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString().trim().split('\n').map(l => { const [sha, date] = l.split(' '); return { sha, date }; });
  console.log(`${log.length} commits touch ${FILE}; ${log[0].date} → ${log[log.length - 1].date}`);
  // keep the last commit of each N-day bucket
  const picked = [];
  let bucket = null;
  for (const c of log) {
    const b = Math.floor(new Date(c.date).getTime() / (every * 86400000));
    if (bucket !== null && b !== bucket) picked.push(last);
    bucket = b; var last = c;
  }
  picked.push(log[log.length - 1]);
  console.log(`sampling ${picked.length} commits (one per ${every} days)`);
  const store = { models: {}, events: [], initialized: false };
  let n = 0;
  for (const c of picked) {
    let raw;
    try { raw = execFileSync('git', ['show', `${c.sha}:${FILE}`], { cwd: repo, maxBuffer: 256 * 1024 * 1024 }).toString(); } catch (e) { console.log(`  ${c.date} ${c.sha.slice(0, 7)}: cannot read (${e.message.split('\n')[0].slice(0, 60)})`); continue; }
    let table; try { table = JSON.parse(raw); } catch { console.log(`  ${c.date}: invalid JSON, skipped`); continue; }
    const ev = applySnapshot(store, c.date, table, `litellm@${c.sha.slice(0, 7)}`);
    n++;
    if (ev.length) console.log(`  ${c.date}: ${ev.filter(e => e.type === 'price').length} price changes, ${ev.filter(e => e.type === 'added').length} added, ${ev.filter(e => e.type === 'removed').length} removed`);
  }
  postProcess(store);
  await writeJson(OUT, store);
  console.log(`done: ${Object.keys(store.models).length} models, ${store.events.length} events from ${n} snapshots → ${path.relative(ROOT, OUT)}`);
}

async function update() {
  const store = await readJson(OUT, { models: {}, events: [], initialized: false });
  const r = await fetch(RAW);
  if (!r.ok) throw new Error(`fetch ${RAW}: ${r.status}`);
  const table = await r.json();
  const date = new Date().toISOString().slice(0, 10);
  const ev = applySnapshot(store, date, table, 'litellm@main');
  postProcess(store);
  await writeJson(OUT, store);
  console.log(`${date}: ${ev.length} events (${ev.filter(e => e.type === 'price').length} price changes)`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === decodeURIComponent(new URL(import.meta.url).pathname);
async function post() { const store = await readJson(OUT); postProcess(store); await writeJson(OUT, store); console.log('post-processed', store.events.length, 'events'); }
if (isMain) (args.backfill ? backfill() : args.post ? post() : update()).catch(e => { console.error(e); process.exit(1); });
