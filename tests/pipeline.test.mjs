import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { observe } from '../scripts/lib/pipeline.mjs';
import { DATA } from '../scripts/lib/store.mjs';

const svc = { slug: 'zz-test-service', name: 'Test' };
const url = 'https://example.test/pricing';
const long = Array.from({ length: 60 }, (_, i) => `Feature ${i} costs $${i + 1} per month`);
const short = ['Pricing', '$5 per month', 'Contact us'];

test('a much shorter capture is ignored twice, then accepted as a baseline on the third sighting', async () => {
  await fs.rm(path.join(DATA, 'snapshots', svc.slug), { recursive: true, force: true });
  await fs.rm(path.join(DATA, 'state', `${svc.slug}.json`), { force: true });
  await fs.rm(path.join(DATA, 'changes', `${svc.slug}.json`), { force: true });
  assert.equal((await observe(svc, url, '20260101000000', long, 'http')).status, 'first');
  assert.equal((await observe(svc, url, '20260102000000', short, 'http')).status, 'skipped');
  assert.equal((await observe(svc, url, '20260103000000', short, 'http')).status, 'skipped');
  const r = await observe(svc, url, '20260104000000', short, 'http');
  assert.equal(r.status, 'changed');
  assert.ok(!r.change.transition, 'same environment: a real page change, not a baseline transition');
  assert.equal(r.change.material, true);
  await fs.rm(path.join(DATA, 'snapshots', svc.slug), { recursive: true, force: true });
  await fs.rm(path.join(DATA, 'state', `${svc.slug}.json`), { force: true });
  await fs.rm(path.join(DATA, 'changes', `${svc.slug}.json`), { force: true });
});
