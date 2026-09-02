# Pricedrift

**The changelog of developer pricing.** Every change to the pricing pages of 200+ developer and
infrastructure services, with the actual diff, tracked daily, with history back to 2023 from
Wayback Machine captures. Plus a per-model price history for LLM APIs built from a structured
source. RSS and open JSON for everything. No accounts.

Live site: see `config/site.json` → `url`.

## How it works

```
services/*.yaml        one file per service: pages to track + hand-verified "Price Facts"
scripts/track.mjs      daily: fetch each page (HTTP → headless Chromium → latest Wayback capture),
                       extract visible text, diff against the last capture, classify, confirm next day
scripts/backfill.mjs   one-off: replay monthly Wayback captures through the same pipeline
scripts/llm.mjs        LLM API prices from LiteLLM's price table; git history for the backfill
scripts/build.mjs      static site → dist/ (pages, RSS feeds, JSON/CSV API, OG images)
data/                  snapshots (text), detected changes, tracker state, run summaries
.github/workflows      daily cron: track → commit data → build → deploy to GitHub Pages
```

A change is **material** when a line containing a price, a quantity with a unit, or a plan name
changed. Everything else is a wording-only edit and stays off the main feed. A live-detected
change is published only after it is seen on two consecutive days (A/B test guard); a change that
exactly reverses the previous one is marked as reverted.

## Local use

```bash
npm install
npx playwright install chromium        # only needed for the browser fallback
npm test
node scripts/validate.mjs              # check services/*.yaml
node scripts/track.mjs --only vercel   # check one service
node scripts/build.mjs && npm run serve
```

Backfill history for a new service: `node scripts/backfill.mjs --only <slug> --from 2023-01`.

## Adding or fixing a service

Copy any file in `services/`, follow `services/_SCHEMA.md`, run `node scripts/validate-file.mjs services/<slug>.yaml`,
then `node scripts/backfill.mjs --only <slug>`. Facts must come from the vendor's page as it reads
on `verified_on`; the tracker flags the panel as possibly stale once the page changes after that date.

## Data license

Code: MIT. Data (`data/`, `services/`): CC BY 4.0. Prices and limits are quoted from vendors'
public pages and can be wrong or out of date; the site says so on every page.
