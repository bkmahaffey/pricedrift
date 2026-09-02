import { loadServices, CATEGORIES } from './lib/catalog.mjs';
const services = await loadServices();
const byCat = {};
for (const s of services) byCat[s.category] = (byCat[s.category] || 0) + 1;
const missingFacts = services.filter(s => !s.free_tier).map(s => s.slug);
console.log(`${services.length} valid services. Categories: ${Object.entries(byCat).map(([k, v]) => `${CATEGORIES[k].name} ${v}`).join(', ')}`);
if (missingFacts.length) console.log(`Without free_tier facts: ${missingFacts.join(', ')}`);
