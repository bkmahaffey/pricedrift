# Launch kit

Copy, adjust the numbers to what the site shows on launch day, post. Total time: about an hour,
spread over a week. Post findings, not the site: a specific diff travels further than "I built a tracker".

## Show HN (post on a Tuesday-Thursday, 8-10am US Eastern)

**Title:** Show HN: A changelog of developer pricing pages, with the actual diffs

**Text:**

I got tired of finding out about pricing changes from angry Reddit threads three weeks late, so I
built a tracker that snapshots the pricing pages of ~220 developer services every day (Vercel,
Netlify, Supabase, Neon, Cloudflare, Railway, Fly, Sentry, the LLM APIs, and so on), diffs the
visible text, and publishes every price, limit, or plan change with the before/after lines.

History goes back to 2023 using monthly Wayback Machine captures, so you can see, for example,
Netlify's Starter plan disappearing in July 2025 and the credits overhaul that September.

A few things I tried to get right:

- It shows the diff, not a summary. If the detector is wrong you can see it.
- Every service and category has its own RSS feed, and everything is available as JSON/CSV (CC BY 4.0).
- Live changes are published only after they are seen on two consecutive days, to filter A/B tests.
- LLM API prices come from a structured source (LiteLLM's price table, replayed through its git
  history), not scraped marketing pages.
- No account, no newsletter wall, no tracking.

What it gets wrong: pages that only render prices client-side, marketing numbers that look like
limits, and dates from monthly archive captures are "sometime in the previous month". Details on
the About page. Source is on GitHub; adding a service is one YAML file.

**First comment to post yourself:** the three most surprising diffs currently on the site, each
with a direct link to the entry.

## Reddit (r/webdev, r/devops, r/selfhosted; flair: "Resource" or "Showoff Saturday" where required)

**Title:** I built a free changelog of developer pricing pages: 220 services, diffs back to 2023, RSS for each one

**Body:** two or three of the most interesting recent changes as bullet points with links, one
paragraph on how it works, the RSS angle ("subscribe to just the services you pay for"), and a
request for services to add.

## dev.to / Hashnode article (evergreen, for search)

**Title:** What 220 developer pricing pages changed in the last year

Structure: the ten biggest changes with diffs, the patterns (credits replacing fixed plans, free
tiers shrinking, per-seat to usage), then how the tracker works in 300 words. Link every claim to
its entry on the site.

## Newsletter pitch (TLDR, Bytes, Console, Changelog News)

Subject: A pricing change your readers probably missed

Two sentences: the single most surprising diff of the month with the link, and "the site tracks
220 developer pricing pages daily and publishes every change with the diff; free, RSS, open data."
No ask beyond "in case it is useful for the next issue".

## Ongoing (10 minutes, weekly)

Skim `/changes/`. If something is notable, post the entry link with one sentence of context to
X/Bluesky/Mastodon and the relevant subreddit. That is the whole marketing plan.
