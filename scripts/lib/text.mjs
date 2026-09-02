// Text extraction and normalization for pricing pages.
// Goal: turn HTML into a stable list of visible text lines that can be diffed
// day over day without noise from scripts, styles, navigation, or Wayback chrome.
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

const BLOCK_TAGS = new Set(['p','div','li','h1','h2','h3','h4','h5','h6','tr','td','th','section','article','dt','dd','button','a','label','ul','ol','table','br','summary','details','figcaption','blockquote','pre','option','legend','fieldset','main','aside']);
const REMOVE_SELECTORS = [
  'script','style','noscript','svg','iframe','template','head','canvas','video','audio','object','embed',
  'nav','footer','header',
  '#wm-ipp-base','#wm-ipp-print','#donato','#wm-ipp','.wb-autocomplete-suggestions',
  '[id*="cookie" i]','[class*="cookie" i]','[id*="consent" i]','[class*="consent" i]','[aria-label*="cookie" i]',
].join(',');

export function htmlToLines(html) {
  const $ = cheerio.load(html);
  $(REMOVE_SELECTORS).remove();
  const out = [];
  function walk(node) {
    for (const child of node.childNodes || []) {
      if (child.type === 'text') {
        const t = child.data.replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      } else if (child.type === 'tag') {
        walk(child);
        if (BLOCK_TAGS.has(child.name)) out.push('\n');
      }
    }
  }
  const root = $('body')[0] || $.root()[0];
  walk(root);
  const text = out.join(' ').replace(/ ?\n ?/g, '\n');
  const lines = text.split('\n').map(normalizeLine).filter(Boolean);
  return lines.filter((l, i) => l !== lines[i - 1]);
}

export function normalizeLine(s) {
  return s
    .replace(/[    ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s([,.;:!?)])/g, '$1')
    .replace(/^[.,;:]\s+/, '')
    .trim()
    .slice(0, 500);
}

// Currency amounts: $20, $0.15, €4.99, £10, 20 USD, US$5
export const CURRENCY_RE = /(?:(?:US|CA|AU|NZ|SG|HK)?\$|€|£|¥|₹|CHF|USD|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|CHF)\b/i;
// Quantities with units that pricing pages use for limits.
export const UNIT_RE = /\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|b|gb|tb|mb|kb|pb|gib|tib|mib|ms|s|sec|min|mins|minutes?|hours?|hrs?|days?|weeks?|months?|years?|vcpus?|cpus?|cores?|ram|gpus?|cu|cu-hours?|compute hours?|requests?|reqs?|req|invocations?|executions?|runs?|builds?|deploys?|deployments?|sites?|projects?|apps?|databases?|dbs?|branches?|repos?|repositories?|seats?|users?|members?|editors?|collaborators?|teammates?|maus?|dau|monthly active users?|events?|sessions?|pageviews?|page views|visitors?|emails?|messages?|sms|contacts?|subscribers?|records?|rows?|documents?|objects?|files?|images?|videos?|tokens?|characters?|chars|words?|credits?|queries?|operations?|ops|reads?|writes?|transactions?|connections?|domains?|environments?|workers?|functions?|cron jobs?|jobs?|webhooks?|logs?|traces?|spans?|metrics?|alerts?|monitors?|checks?|uptime|bandwidth|egress|storage|transfer|rpm|rpd|tpm|tpd|qps|rps|per second|per minute|per day|per month|\/\s?(?:mo|month|yr|year|day|hour|hr|min|sec|user|seat|site|project|gb|tb|k|m|1k|1m|million|1,000|1000|1,000,000))\b/i;
export const FREE_RE = /\b(?:free|free trial|unlimited|no credit card|always free)\b/i;
// Leading enumeration like "04 I went over my credit" or "1. Create a project" is not a quantity.
// Only a leading zero ("04 I went over…"), punctuation ("1. Create a project"), or a sentence-shaped
// line ("12 Why did my bill go up?") marks an ordinal; "60 compute hours" and "10 projects" are limits.
const LEADING_ORDINAL_RE = /^\s*(?:step\s*)?(?:0\d|\d{1,2}[.)])\s+(?=[A-Za-z])/i;
const LEADING_SENTENCE_RE = /^\s*\d{1,2}\s+(?=[A-Z][a-z]+\s)/;
export function stripOrdinal(line) {
  if (LEADING_ORDINAL_RE.test(line)) return line.replace(LEADING_ORDINAL_RE, '');
  if (line.length > 40 && /[?!.]$/.test(line) && LEADING_SENTENCE_RE.test(line)) return line.replace(LEADING_SENTENCE_RE, '');
  return line;
}

export function isMaterialLine(line) {
  if (line.length > 320) return false; // long prose paragraphs are not price tables
  return CURRENCY_RE.test(line) || UNIT_RE.test(line) || FREE_RE.test(line);
}

// Lines that change every day without meaning anything: dates, counters, copyright.
const VOLATILE_RES = [
  /^(?:©|copyright|\(c\))/i,
  /\b(?:last )?(?:updated|modified|effective)\b.*\b20\d\d\b/i,
  /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?,? \w+ \d{1,2},? 20\d\d/i,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm|utc|gmt)?\b/i,
  /^\d+ (?:days?|hours?|minutes?|seconds?) ago$/i,
  /^(?:[\d,.]+[kKmM]?\+?)$/,
  /\b(?:trusted by|join|used by|loved by)\b.*\b[\d,.]+[kKmM]?\+?\b/i,
  /\b[\d,.]+[kKmM]?\+? (?:developers|companies|customers|teams|users|businesses|startups) (?:trust|use|love|rely|build|ship)/i,
  /^\s*(?:x|×|close|menu|skip to (?:main )?content|loading\.{0,3})\s*$/i,
  /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|20\d\d-\d\d-\d\d)$/,
  /\b(?:ends|expires?|until|through|valid) (?:on |in |at )?(?:\w+ \d{1,2}|\d{1,2} \w+|\d+ (?:days?|hours?))/i,
  /\b\d+ ?(?:days?|hours?|minutes?)\s?(?:left|remaining)\b/i,
];
export function isVolatileLine(line) {
  return VOLATILE_RES.some(r => r.test(line));
}

export function stableLines(lines) {
  return lines.filter(l => !isVolatileLine(l));
}

export function hashLines(lines) {
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16);
}

// Extract the numeric/currency tokens in a line, in order.
export function numericTokens(line) {
  const re = /(?:(?:US|CA|AU)?\$|€|£|¥|₹)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:%|k|m|b|gb|tb|mb|kb|pb|gib|tib|mib)?\b/gi;
  return (stripOrdinal(line).match(re) || []).map(t => t.replace(/\s+/g, ''));
}
// A bare 1-2 digit integer with no unit or currency is a weak signal (FAQ numbers, steps, footnotes).
export function isWeakToken(tok, line) {
  if (/[$€£¥₹%]|[a-z]/i.test(tok)) return false;
  if (/[.,]/.test(tok) || tok.length >= 3) return false;
  return !UNIT_RE.test(line);
}

// Replace numbers with a placeholder so two versions of the same line can be matched.
export function shape(line) {
  return stripOrdinal(line)
    .replace(/(?:(?:US|CA|AU)?\$|€|£|¥|₹)\s?\d[\d,]*(?:\.\d+)?/gi, '¤')
    .replace(/\d[\d,]*(?:\.\d+)?/g, '#')
    .toLowerCase()
    .replace(/[^a-z#¤ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a numeric token into a comparable value: "$2.50" → {v:2.5,c:'$'}, "5K" → {v:5000}, "1,000" → {v:1000}, "100GB" → {v:100,u:'gb'}
export function parseToken(tok) {
  if (tok === null || tok === undefined) return null;
  const m = String(tok).replace(/\s+/g, '').match(/^([$€£¥₹]|US\$|CA\$|AU\$)?([\d,]*\.?\d+)(%|k|m|b|gb|tb|mb|kb|pb|gib|tib|mib)?$/i);
  if (!m) return { raw: String(tok) };
  let v = parseFloat(m[2].replace(/,/g, ''));
  const suf = (m[3] || '').toLowerCase();
  if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'b') v *= 1e9;
  return { v, c: m[1] ? '$' : '', u: ['k', 'm', 'b'].includes(suf) ? '' : suf };
}
export function sameValue(a, b) {
  const pa = parseToken(a), pb = parseToken(b);
  if (!pa || !pb) return a === b;
  if (pa.raw !== undefined || pb.raw !== undefined) return pa.raw === pb.raw;
  return pa.v === pb.v && pa.c === pb.c && pa.u === pb.u;
}
// Signature of the numbers in a line, independent of wording: used to cancel moved or reworded lines.
export function numericSignature(line) {
  return numericTokens(line).map(t => { const p = parseToken(t); return p.raw !== undefined ? p.raw : `${p.c}${p.v}${p.u}`; }).sort().join('|');
}
