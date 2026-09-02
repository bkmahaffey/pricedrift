# Validation: why Pricedrift, and what the research said

Date: 2026-09-02. Everything below came from live research (search, fetching competitor sites,
HN/Reddit APIs, Google autocomplete, vendor pages) done before any code was written. Scores are
1-10; higher is better.

## Constraints from the brief

No money spent, ever. Semi-passive after launch. Not a generic AI wrapper or a content mill.
Buildable end to end now, on free infrastructure, by one person.

## Ideas considered

| Idea | Demand | Gap | Passive | $0 feasible | Verdict |
|---|---|---|---|---|---|
| SaaS pricing-page change tracker (all SaaS) | 6 | 2 | 4 | 5 | Rejected as scoped: PricingSaaS (3,000+ pages, sponsor-funded, LinkedIn-gated) and SaaS Price Pulse (260 tools, Wayback-backfilled) already do it |
| Niche job board aggregated from ATS APIs | 4 | 3 | 6 | 8 | Rejected: aggregation is commoditized (freehire, OpenPostings); revenue depends on employer trust and marketing time |
| Paid API on Cloudflare Workers via RapidAPI | 3 | 2 | 3 | 4 | Rejected: RapidAPI cut rose to 25% with PayPal-only payouts; every $0-buildable category is already free/open source |
| Compliance deadline calendar (EU AI Act etc.) | 4 | 3 | 2 | 4 | Rejected: dates move (the AI Act omnibus postponed high-risk obligations to 2027); needs legal monitoring and carries liability |
| Fitment database (lens mounts) with affiliate links | 6 | 6 | 7 | 5 | Runner-up: only niche with an open dataset (Wikidata), but Amazon Associates hurdles and zero revenue evidence |
| Developer free-tier changelog | 5 | 2 | 3 | 6 | Rejected as a standalone: freetier.co (Jan 2026) already has structured limits, a changelog and RSS |
| LLM API price history | 5 | 6 | 7 | 8 | Adopted as a section: partially served (llm-prices.com sparse JSON, pricepertoken chart, datafloe.dev's $29/mo API); nobody combines changelog + RSS + open JSON |

## What was adopted, and why it is different

**Pricedrift: the changelog of developer pricing.** A devtools/infra-only tracker whose product is
the *diff itself*, published openly. Every incumbent found publishes curated entries behind a
signup (PricingSaaS requires LinkedIn plus work-email verification; freetier.co curates closed
entries; datafloe.dev sells history). None shows the raw before/after lines, none offers per-service
RSS plus JSON without an account, and none has a structured LLM price timeline alongside.

Demand evidence:
- Google autocomplete already contains "netlify pricing change", "cursor pricing change",
  "github copilot pricing changes", "slack price increase", "twilio price increase",
  "aws free tier removed", "gemini free tier removed".
- Hacker News stories about silent pricing changes routinely top the front page: GitHub Actions
  pricing (802 points), AWS GPU price rise (755), Hetzner (553), Microsoft 365 (477), Heroku free
  tier removal (908); a data site about LLM prices got 339 points as a Show HN.
- Willingness to pay exists at the data layer: datafloe.dev charges $29/month for LLM price
  history; PricingSaaS runs on seven sponsors.

Technical validation done before building:
- 50 of 55 developer pricing pages fetch with plain HTTP; the rest need a headless browser or the
  archive fallback (openai.com returns 403 to bots). Wayback Machine CDX has monthly captures of
  these pages back to 2023.
- A prototype diff on Netlify's archived captures surfaced its July 2025 Starter-plan removal and
  the September 2025 credits overhaul ($19 → $20; "$5 / 200 credits" → "$5 / 500 credits").
- LiteLLM's price table has 1,960 commits of history and OpenRouter serves 423 models without a
  key, so LLM prices need no scraping.

## Platform facts that shaped the build

- Vercel Hobby explicitly bans ads, affiliate links and billing integrations; GitHub Pages forbids
  stores/SaaS but allows donation and sponsor links; Cloudflare Pages Free and Netlify Free permit
  monetized content sites. Built for GitHub Pages first (zero extra accounts), Cloudflare Pages next.
- GitHub Actions: unlimited free minutes on public repos; a daily 20-minute Playwright job is normal use.
- Payments with no upfront cost: Stripe Payment Links (2.9% + 30¢), Ko-fi (0% on tips), GitHub
  Sponsors (0%); Lemon Squeezy 5% + 50¢ as merchant of record for subscriptions later.
- Referral programs open to content sites: DigitalOcean ($25 CPA), Bunny.net ($20), Backblaze
  (10% recurring), Notion, hosting providers. Hetzner ended its program in 2026.

## Honest risks

1. Traffic takes months; year-one revenue is likely $0-300/month unless a launch post lands.
2. Bot walls will grow; the fallback chain (HTTP → Chromium → latest archive capture) keeps history
   continuous but a few pages may lag by weeks.
3. Text-diff classification is heuristic. Marketing numbers can be misread as limits; the site
   states this and files uncertain edits as wording-only.
4. Hand-verified facts go stale; the panel self-flags when the page changes after verification.
