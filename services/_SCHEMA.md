# Service file schema (services/<slug>.yaml)

One YAML file per tracked service. Everything in `free_tier` and `paid_from` must come from the
service's own pricing page (or docs page listed in `sources`) as it reads on `verified_on`.
Never guess. If the page does not state something, use `null` or `unknown`.

```yaml
slug: neon                        # must equal the file name
name: Neon
category: databases               # one of: hosting compute databases storage ai gpu auth email backend cicd observability analytics cms tools flags
website: https://neon.com
tagline: Serverless Postgres with branching and scale-to-zero   # <= 12 words, factual, no marketing adjectives
track_urls:                       # pages snapshotted daily; first one is the pricing page
  - https://neon.com/pricing
free_tier:
  status: free                    # free = permanent free plan | trial = time-limited trial only | credits = free credits only | none = no free option | unknown
  plan_name: Free                 # name of the free plan/tier as the page calls it (null if none)
  credit_card_required: false     # true | false | null (null when the page does not say)
  limits:                         # 3-8 decision-relevant limits, values exactly as stated, with units; [] if no free tier
    - metric: Projects
      value: "10"
    - metric: Storage
      value: 0.5 GB per project
    - metric: Compute
      value: 100 CU-hours per month
      note: scales to zero after 5 minutes idle     # optional
  trial_length: null              # e.g. "14 days" when status is trial
  credit_amount: null             # e.g. "$5 per month" or "$300 for 90 days" when status is credits
  notes: []                       # up to 3 short factual caveats from the page
paid_from:
  price: "$19"                    # cheapest paid price as shown (string). For usage pricing use the headline unit price, e.g. "$0.20 per 1M requests"
  period: month                   # month | year | usage | one-time | null
  unit: flat                      # flat | per user | per seat | per site | per project | usage | null
  plan_name: Launch               # null for pure usage pricing
verified_on: "2026-09-02"
sources:
  - https://neon.com/pricing
referral: null                    # filled later by the site owner (affiliate/referral URL)
```

Conventions
- Quote every number as a string ("10", "$19").
- `limits[].value` keeps the page's units ("1 TB", "100 GB-hours/month", "1M requests/month", "unlimited").
- Prefer the limits a developer decides on: bandwidth, storage, compute hours, requests, seats/users, projects, retention, rate limits.
- For usage-priced clouds with an always-free allowance (AWS Lambda, S3, Cloud Run): status `free`, limits list the always-free allowances, paid_from is the headline usage price.
- For AI APIs: if the tracked docs page lists free-tier rate limits (RPM/RPD/TPM), include them as limits.
- If a service only offers a trial: status `trial`, `trial_length` set, limits may describe the trial.
- If there is no free option: status `none`, plan_name null, limits [], and paid_from filled in.
