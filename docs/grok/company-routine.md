# Company Hiring Evidence routine (Grok Bot)

This routine researches the employers behind Jev hire claims and returns `company_seed` entries for `config.yml` (SEA-64). `career_evidence@1.2.4` sends those sourced facts to the model as `company_context` (SEA-74). Only company names, titles, and hire dates go to Grok. No resume text does.

## 1. Create the routine

In Grok Bot, create a saved routine and paste this as its instructions:

```text
Create a saved routine named "Company Hiring Evidence".

Trigger: a webhook call. The request body is JSON:
{ "runId": string, "worklist": [ { "org": string, "titles": string[], "startedAt": "YYYY-MM-DD" | null } ], "callbackUrl": string, "callbackToken": string, "delivery": string }

Tools: web search. Do not use X search.

Task: for each org in the worklist, research sourced, checkable facts about how selective it was to be hired there around startedAt. Cite a specific https page for every fact. Do not rate prestige, brand, or reputation. Never estimate or infer a number. If a page you can cite does not state it, leave it out.

The result is ONLY this JSON object, no prose:
{
  "runId": <echo the runId>,
  "companies": [
    {
      "name": string,
      "aliases": string[],
      "source": string,
      "currentStage": "pre_seed_seed" | "series_a_b" | "growth_late" | "public_large",
      "rounds": [ { "date": "YYYY-MM-DD", "stage": <same enum>, "investors": string[], "source": string } ],
      "publishedRate": null | { "rate": number, "upperBound": boolean, "labels": string[], "source": string },
      "hiringBar": null | { "note": string, "source": string }
    }
  ],
  "investors": [ { "name": string, "aliases": string[], "tier": 1 | 2 | 3, "source": string, "publishedRates": [] } ],
  "unresolved": [ { "org": string, "reason": string } ]
}

Rules:
- Stages: pre_seed_seed = pre-seed or seed; series_a_b = Series A or B; growth_late = Series C or later, still private; public_large = publicly traded, or a large established employer (government, university, 10,000+ staff).
- For public_large companies, include the IPO or direct listing as a round: its exact listing date (always published, so never omit it), stage "public_large", investors [], and a source. Then focus on publishedRate and hiringBar for the role family in "titles" (for example the internship program's acceptance rate for an intern title).
- publishedRate.rate is the fraction accepted (0.02 = 2%). upperBound is true when the page says "under X%". labels are whole words that appear in the job titles the rate applies to, such as "Intern" or "New Grad" (not "internship"). A rate is used only for a hire whose title contains one of its labels. If the rate applies to all hiring, omit the labels key entirely. Never send an empty labels list.
- hiringBar.note is one sentence quoting a stated hiring bar (applicants per hire, interview pass rate). Use null if no page states one.
- Private round dates are the announced date. Month only: use the 1st. Year only: omit the round.
- In rounds.investors, write a known investor exactly as it is named in the list below (for example "Sequoia", not "Sequoia Capital"). The investors list holds only new investors named in rounds. Tier 1 = angel or small seed fund. Tier 2 = recognized institutional VC. Tier 3 = top-tier fund or Y Combinator. Already known, do not list: Y Combinator, Sequoia, Andreessen Horowitz, Benchmark, Accel, Greylock, Index Ventures, Precursor Ventures, Hustle Fund.
- Blogs, forum posts, and aggregators without a primary citation do not count as sources.
- Merge duplicate orgs into one entry with both names in aliases.
- Any org you cannot identify with confidence goes in unresolved.

Delivery: POST the JSON object to callbackUrl with Content-Type application/json and the header X-Grok-Callback-Token set to callbackToken. The POST is the delivery; a chat reply alone is not enough.
```

## 2. Store the trigger and callback key

Copy the routine's webhook trigger URL and an API key allowed to trigger it. Store both in Doppler `talent-graph/dev`:

```sh
doppler secrets set GROK_ROUTINE_WEBHOOK_URL="<trigger url>" --project talent-graph --config dev
doppler secrets set GROK_ROUTINE_KEY="<api key>" --project talent-graph --config dev
doppler secrets --only-names --project talent-graph --config dev | grep GROK_ROUTINE
```

The last command must list both names. Never paste the key into chat, a ticket, or git.

The routine posts its result to the club Convex deployment at `POST /grok/company-research?runId=<runId>` (`apps/club/convex/grokCompanyResearch.ts`), and `--research` reads it back from `GET` on the same path. Both check a token derived from `GROK_CALLBACK_MASTER_KEY` and the runId: `HMAC-SHA256(key, runId)` to post, `HMAC-SHA256(key, "read:" + runId)` to read. The same key must be in Doppler and in the deployment env. To set or rotate it without printing it:

```sh
KEY=$(openssl rand -hex 32)
doppler secrets set GROK_CALLBACK_MASTER_KEY="$KEY" --project talent-graph --config dev --silent
(cd apps/club && doppler run --project talent-graph --config dev -- bunx convex env set GROK_CALLBACK_MASTER_KEY "$KEY" >/dev/null)
unset KEY
```

`--research` also reads `NEXT_PUBLIC_CONVEX_SITE_URL` from Doppler to build the callback URL.

## 3. Run it

From the repo root, with the private resume items file:

```sh
# Optional: see which orgs will be researched and which are already seeded.
bun run scripts/jev-company-worklist.ts --items <items.json>

# Ask the routine about every unseeded org, 10 per call. Writes validated proposals.
doppler run --project talent-graph --config dev -- \
  bun run scripts/jev-company-worklist.ts --research <items.json> --out <proposals.json>

# Merge the proposals into config.yml and update the seed pin.
bun run scripts/jev-company-worklist.ts --apply <proposals.json>
bun run check:config
```

The research step prints each rejected org with the reason (for example a fact without an https source), each org Grok could not resolve, each worklist org that no returned company names by name or alias (it stays unseeded), and any new investors. New investors are not applied automatically. Add each one to `company_seed.investors` by hand after checking its tier. If a batch fails, the proposals from earlier batches are still written and the step says which batch stopped it.

Keep `<items.json>` and `<proposals.json>` under the gitignored `sea-35-private/` path until the proposals are reviewed.

## The routine runs asynchronously

The webhook answers at once with only `{ "success": true, "runUuid": "…" }`. No documented API returns a run's output by `runUuid`, so `--research` sends each batch a `callbackUrl` and a per-run `callbackToken`, then polls the callback every 20 seconds for up to 30 minutes. The trigger body also carries a `delivery` field with the POST instruction, so the routine posts back even if its saved text predates the callback. A probe on 2026-09-29 (Grok run `610a2442-fb11-4a28-ad1b-152cffee8a1b`, synthetic Stripe intern entry) posted a valid reply 101 seconds after the trigger.

If a batch times out, the reply may still be in the Bot's chat. Save it and validate it offline:

```sh
bun run scripts/jev-company-worklist.ts --from <grok-reply.json> --out <proposals.json>
```

## Then test

Run 3 live smoke runs each of `career_evidence@1.2.3` and `@1.2.4` on the two SEA-35 resumes, and compare review per run and hire selectivity per job (SEA-74 acceptance):

```sh
doppler run --project talent-graph --config dev -- \
  bun run scripts/jev-claim-smoke.ts --items <items.json> --rubric career_evidence@1.2.4 --out <run-dir>
```
