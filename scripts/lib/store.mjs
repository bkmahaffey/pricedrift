import { promises as fs } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const DATA = path.join(ROOT, 'data');

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n');
}
export function urlKey(url) {
  const u = new URL(url);
  const s = (u.host + u.pathname).replace(/^www\./, '').replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return s.slice(0, 80);
}
export function snapshotPath(slug, url, ts) {
  return path.join(DATA, 'snapshots', slug, urlKey(url), `${ts}.txt`);
}
export async function writeSnapshot(slug, url, ts, lines) {
  const p = snapshotPath(slug, url, ts);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, lines.join('\n') + '\n');
  return path.relative(ROOT, p);
}
export async function readSnapshot(slug, url, ts) {
  const txt = await fs.readFile(snapshotPath(slug, url, ts), 'utf8');
  return txt.split('\n').filter(Boolean);
}
export async function listSnapshots(slug, url) {
  const dir = path.join(DATA, 'snapshots', slug, urlKey(url));
  try { return (await fs.readdir(dir)).filter(f => f.endsWith('.txt')).map(f => f.replace('.txt', '')).sort(); } catch { return []; }
}
export const statePath = slug => path.join(DATA, 'state', `${slug}.json`);
export const changesPath = slug => path.join(DATA, 'changes', `${slug}.json`);
export async function readState(slug) { return (await readJson(statePath(slug), { slug, urls: {} })); }
export async function writeState(slug, st) { return writeJson(statePath(slug), st); }
export async function readChanges(slug) { return (await readJson(changesPath(slug), [])); }
export async function writeChanges(slug, ch) { return writeJson(changesPath(slug), ch); }

// Timestamps use the Wayback format YYYYMMDDhhmmss so live and archived snapshots sort together.
export function tsNow(d = new Date()) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}
export function tsToDate(ts) {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}
export function tsToIso(ts) {
  return `${tsToDate(ts)}T${ts.slice(8, 10) || '00'}:${ts.slice(10, 12) || '00'}:${ts.slice(12, 14) || '00'}Z`;
}
