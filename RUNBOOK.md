# Runbook: running Pricedrift with about 15 minutes a week

This file is for the site owner. It covers what runs by itself, what needs a hand, and how the
money side is wired. Nothing here costs money unless marked.

## What runs by itself

- **Daily at 06:17 UTC** the GitHub Actions workflow checks every tracked page, confirms
  yesterday's pending changes, updates LLM prices, commits `data/`, rebuilds and deploys the site.
  Public repo → unlimited free Actions minutes.
- **Unreachable pages** are collected into one GitHub issue labeled `unreachable` (updated by
  comment, never spammed). History continues from the last good capture, so nothing breaks.
- **Stale facts** flag themselves: when a pricing page changes after a service's `verified_on`
  date, the Price Facts panel says so and links to the diff.

## Weekly (5-15 minutes)

1. Glance at the latest Actions run. Green = done.
2. Open the `unreachable` issue if it has new comments. If a vendor moved its pricing page,
   edit `track_urls` in that service's YAML (1 line) and run `node scripts/backfill.mjs --only <slug>`.
3. If a service page shows the stale-facts banner and the diff is real, update its limits in the
   YAML and bump `verified_on`. Skip it if you are busy; the banner is honest on its own.

## Turning on revenue (one-time setup, all free)

1. **Sponsor slot.** Create a Stripe Payment Link (no monthly fee, 2.9% + 30¢) for "Pricedrift
   sponsor slot, 1 month". Put the link in `config/site.json` → `sponsor.checkoutUrl`. When
   someone pays, fill `sponsor.name`, `sponsor.url`, `sponsor.tagline`, set `enabled: true`, commit.
   Ko-fi (0% on tips) or GitHub Sponsors (0% fee) work too if you prefer not to run Stripe.
   Pricing guidance: start at $150-300/month once the site has ~5,000 monthly visitors; devtool
   newsletters charge roughly $25-40 CPM. Until then, leave the slot "open": it is a live ad for
   the offer.
2. **Referral links.** Join the programs that pay content sites, then paste each URL into
   `referral:` in the service's YAML. The site marks every referral link and explains it on
   `/about/#disclosure`. Programs verified during research (2026-09):
   - DigitalOcean affiliates via Impact: $25 per paying customer, 90-day cookie, $10 payout floor
     (digitalocean.com/affiliates).
   - Bunny.net: $20 per paying customer, uncapped (bunny.net/affiliate).
   - Backblaze: 10% recurring, 30-day cookie.
   - Notion (PartnerStack): reported up to $50 per signup plus 20% of first-year revenue.
   - Vercel: reported $100 flat per Pro referral (confirm in their partner program).
   - Supabase: reported 10-20% recurring (confirm at supabase.com/partners).
   - Hostinger, Kinsta, Cloudways and most web hosts pay $50-500 per sale; Kinsta and Hostinger
     are already tracked here.
   - Hetzner discontinued its referral program in 2026; skip it.
   Amazon Associates is not needed and not recommended for this audience.
3. **Contact email.** Put an address in `config/site.json` → `contactEmail` so sponsor and
   correction inquiries reach you. Leave empty to route everything through GitHub issues.

## Launch checklist (once, ~1 hour total)

- [ ] Buy a domain (~$10/year, the only thing worth paying for). Point it at Cloudflare Pages or
      keep GitHub Pages with a custom domain; update `config/site.json` (`url`, `basePath: ""`).
      Cloudflare Pages Free explicitly allows commercial sites; GitHub Pages tolerates a content
      site with sponsor/donation links but not a store. Vercel Hobby bans monetized sites; do not use it.
- [ ] Submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools.
- [ ] Post "Show HN: A changelog of developer pricing pages, with diffs" on Hacker News on a
      weekday morning (US), linking the `/changes/` page. Answer comments for an hour.
- [ ] Post to r/webdev, r/devops, r/selfhosted (flair as a free tool), and dev.to.
- [ ] Share individual findings, not the site: "Netlify's Starter plan disappeared on 2025-07-01,
      here is the diff" gets more clicks than "I built a tracker".
- [ ] Email two or three devtool newsletters (TLDR, Bytes, Console) with one surprising diff.

## What to expect

Content sites earn on traffic, and traffic takes months. Realistic year-one range for a site like
this: $0-300/month, with sponsor revenue arriving after the first Hacker News or newsletter spike.
The asset that appreciates is the data: three years of dated diffs that nobody else publishes
openly. Paid options later, if the audience is there: a paid alerts tier (email/Slack on selected
services), and a paid API tier of the history (datafloe.dev charges $29/month for LLM price
history alone).

## Migrating hosting to Cloudflare Pages (optional, ~10 minutes)

1. Create a free Cloudflare account, Pages → "Connect to Git" → this repo, build command
   `node scripts/build.mjs --og`, output directory `dist`, Node 22.
2. Set `basePath` to "" and `url` to the new domain in `config/site.json`.
3. Keep the GitHub Actions cron (it still commits data daily; Cloudflare rebuilds on each commit).
