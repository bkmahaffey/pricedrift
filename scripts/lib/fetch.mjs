// Fetch chain for a tracked page: plain HTTP → headless Chromium → latest Wayback snapshot.
import { htmlToLines, isMaterialLine } from './text.mjs';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache' };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function goodEnough(lines, minLines = 15, minMaterial = 1) {
  return lines.length >= minLines && lines.filter(isMaterialLine).length >= minMaterial;
}

export async function fetchPlain(url, timeoutMs = 30000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: ctrl.signal });
    const html = await r.text();
    return { ok: r.ok, status: r.status, html, finalUrl: r.url };
  } finally { clearTimeout(t); }
}

let browserPromise = null;
export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
    })();
  }
  return browserPromise;
}
export async function closeBrowser() { if (browserPromise) { const b = await browserPromise; await b.close(); browserPromise = null; } }

export async function fetchRendered(url, { timeoutMs = 45000, settleMs = 2500 } = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' });
  try {
    await ctx.route('**/*', route => {
      const t = route.request().resourceType();
      if (['image', 'media', 'font', 'websocket', 'manifest'].includes(t)) return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch {}
    await page.waitForTimeout(settleMs);
    const html = await page.content();
    return { ok: !!resp && resp.ok(), status: resp ? resp.status() : 0, html, finalUrl: page.url() };
  } finally { await ctx.close(); }
}

export async function waybackLatest(url) {
  const q = new URLSearchParams({ url, output: 'json', filter: 'statuscode:200', limit: '-1', fl: 'timestamp' });
  const r = await fetch(`https://web.archive.org/cdx/search/cdx?${q}`, { headers: { 'User-Agent': UA } });
  const body = await r.text();
  if (!r.ok || !body.trim().startsWith('[')) return null;
  const rows = JSON.parse(body);
  if (rows.length < 2) return null;
  const ts = rows[rows.length - 1][0];
  const snap = await fetch(`https://web.archive.org/web/${ts}id_/${url}`, { headers: { 'User-Agent': UA } });
  if (!snap.ok) return null;
  const html = await snap.text();
  if (html.includes('Internet Archive: Temporarily Offline')) return null;
  return { ok: true, status: 200, html, finalUrl: url, waybackTs: ts };
}

// Returns {lines, source, status, note, waybackTs?}
export async function fetchPage(url, opts = {}) {
  const { minLines = 15, minMaterial = 1, allowBrowser = true, allowWayback = true, expectLines = 0 } = opts;
  const notes = [];
  // A capture far shorter than the last accepted one is probably client-rendered or partially blocked:
  // keep it as a fallback but try the browser first.
  const looksTruncated = lines => expectLines && lines.length < expectLines * 0.4;
  let fallback = null;
  try {
    const r = await fetchPlain(url);
    if (r.ok) {
      const lines = htmlToLines(r.html);
      if (goodEnough(lines, minLines, minMaterial)) {
        if (!looksTruncated(lines) || !allowBrowser) return { lines, source: 'http', status: r.status, notes };
        fallback = { lines, source: 'http', status: r.status, notes };
        notes.push(`http: ${lines.length} lines, expected ~${expectLines}`);
      } else notes.push(`http: only ${lines.length} lines`);
    } else notes.push(`http ${r.status}`);
  } catch (e) { notes.push(`http error: ${e.message.slice(0, 80)}`); }
  if (allowBrowser) {
    try {
      const r = await fetchRendered(url);
      const lines = htmlToLines(r.html);
      if (goodEnough(lines, minLines, minMaterial) && (!fallback || lines.length > fallback.lines.length)) return { lines, source: 'browser', status: r.status, notes };
      notes.push(`browser: ${r.status}, ${lines.length} lines`);
    } catch (e) { notes.push(`browser error: ${e.message.slice(0, 80)}`); }
  }
  if (fallback) return fallback;
  if (allowWayback) {
    try {
      const r = await waybackLatest(url);
      if (r) {
        const lines = htmlToLines(r.html);
        if (goodEnough(lines, minLines, minMaterial)) return { lines, source: 'wayback', status: 200, waybackTs: r.waybackTs, notes };
        notes.push(`wayback: ${lines.length} lines`);
      } else notes.push('wayback: no snapshot');
    } catch (e) { notes.push(`wayback error: ${e.message.slice(0, 80)}`); }
  }
  return { lines: null, source: null, status: 0, notes };
}
