import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT } from './store.mjs';

export const CATEGORIES = {
  hosting:      { name: 'Hosting & deployment', blurb: 'Static hosting, app platforms, serverless and edge runtimes.' },
  compute:      { name: 'Cloud & VPS',          blurb: 'Virtual machines, hyperscaler free tiers, bare metal.' },
  databases:    { name: 'Databases',            blurb: 'Postgres, MySQL, document, key-value, vector and search.' },
  storage:      { name: 'Storage, CDN & media', blurb: 'Object storage, CDNs, image and video pipelines.' },
  ai:           { name: 'AI APIs & tools',      blurb: 'Model APIs, inference platforms, coding assistants.' },
  gpu:          { name: 'GPU & ML compute',     blurb: 'GPU rental, notebooks, model serving.' },
  auth:         { name: 'Auth & identity',      blurb: 'Login, user management, SSO.' },
  email:        { name: 'Email & messaging',    blurb: 'Transactional email, newsletters, SMS, push.' },
  backend:      { name: 'Backend & APIs',       blurb: 'Backend-as-a-service, realtime, queues, workflows, payments.' },
  cicd:         { name: 'Code, CI & containers', blurb: 'Git hosting, CI/CD, registries, build tooling.' },
  observability:{ name: 'Monitoring & logs',    blurb: 'Errors, metrics, logs, uptime, session replay.' },
  analytics:    { name: 'Analytics',            blurb: 'Web and product analytics.' },
  cms:          { name: 'CMS & site builders',  blurb: 'Headless CMS, blogging, visual builders.' },
  tools:        { name: 'Developer tools',      blurb: 'Editors, API clients, collaboration, networking.' },
  flags:        { name: 'Feature flags & config', blurb: 'Flags, experiments, remote config.' },
};

export async function loadServices() {
  const dir = path.join(ROOT, 'services');
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const services = [];
  for (const f of files) {
    const doc = yaml.load(await fs.readFile(path.join(dir, f), 'utf8'));
    const errors = validateService(doc, f);
    if (errors.length) throw new Error(`Invalid service ${f}:\n  ${errors.join('\n  ')}`);
    services.push(doc);
  }
  services.sort((a, b) => a.name.localeCompare(b.name));
  return services;
}

export function validateService(s, file = '?') {
  const e = [];
  if (!s || typeof s !== 'object') return [`${file}: not an object`];
  for (const k of ['slug', 'name', 'category', 'website', 'track_urls']) if (!s[k]) e.push(`missing ${k}`);
  if (s.slug && !/^[a-z0-9-]+$/.test(s.slug)) e.push(`bad slug ${s.slug}`);
  if (s.slug && file !== '?' && file.replace(/\.ya?ml$/, '') !== s.slug) e.push(`file name should be ${s.slug}.yaml`);
  if (s.category && !CATEGORIES[s.category]) e.push(`unknown category ${s.category}`);
  if (s.track_urls && (!Array.isArray(s.track_urls) || !s.track_urls.length)) e.push('track_urls must be a non-empty list');
  for (const u of s.track_urls || []) { try { new URL(u); } catch { e.push(`bad url ${u}`); } }
  if (s.free_tier) {
    if (!['free', 'trial', 'credits', 'none', 'unknown'].includes(s.free_tier.status)) e.push(`free_tier.status must be free|trial|credits|none|unknown`);
    for (const l of s.free_tier.limits || []) if (!l.metric || l.value === undefined) e.push(`free_tier.limits entries need metric and value`);
  }
  if (s.verified_on && !/^\d{4}-\d{2}-\d{2}$/.test(String(s.verified_on))) e.push('verified_on must be YYYY-MM-DD');
  return e;
}
