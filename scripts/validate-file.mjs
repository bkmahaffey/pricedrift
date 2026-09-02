// Validate one or more service YAML files: node scripts/validate-file.mjs services/neon.yaml ...
import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateService } from './lib/catalog.mjs';
let bad = 0;
for (const f of process.argv.slice(2)) {
  try {
    const doc = yaml.load(await fs.readFile(f, 'utf8'));
    const errs = validateService(doc, path.basename(f));
    if (!doc.free_tier) errs.push('missing free_tier');
    if (!doc.verified_on) errs.push('missing verified_on');
    if (!doc.paid_from && doc.free_tier?.status !== 'unknown') errs.push('missing paid_from (use price: null with a note if there is no public price)');
    if (errs.length) { bad++; console.log(`✗ ${f}\n  ${errs.join('\n  ')}`); } else console.log(`✓ ${f}`);
  } catch (e) { bad++; console.log(`✗ ${f}: ${e.message}`); }
}
process.exit(bad ? 1 : 0);
