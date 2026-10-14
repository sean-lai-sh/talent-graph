# Evidence snapshots

When a member refers a candidate with a resume PDF, Club extracts the resume's claim lines, scores each with Jev (career_evidence 1.2), and stores those records. A daily cron freezes the candidate's evidence into snapshots (`s0` first) and never edits a frozen row. Evidence that predates a cutoff but arrives after it writes a new correction row, and the newest row wins. This recipe runs against a local Convex backend only, because it reads and edits backend tables.

## Sub-features

- `intake-lines` stores a resume version with its claim lines when a referral carries a resume PDF.
- `jev-records` stores one Jev 1.2 record per claim in `jevJudgments`, with `author` set (`candidate` for resume claims, `system` for GitHub claims), the spec id and the config hash.
- `skip-labelling` sends no labelling request for a resume whose bullets all sit under dated headers.
- `s0-cron` writes an `s0` row in `evidenceSnapshots` once the candidate is due (referral + 60 days).
- `cron-idempotent` writes nothing the second time the cron or a check runs.
- `late-correction` adds a correction row (`correctsSnapshotId` set) when evidence dated before the cutoff arrives after `s0` froze. The original row stays byte-identical.

## How to get to it (user POV)

- A signed-in member refers a new candidate with a resume PDF (`generateResumeUploadUrl`, upload, `registerResumeUpload`, `submitReferralSignup`). Intake runs right after the signup.
- An admin adds a person (`addPerson`). Intake runs the same way, but the form takes no PDF, so this recipe uses the member path.
- The daily cron `evidence snapshots` (09:00 UTC) runs `evidence:daily`, which schedules `evidence:check` for each candidate that is due.
- Late evidence today comes from GitHub: a public artifact older than the cutoff that first appears after `s0` froze. No UI edits a candidate's GitHub profile yet, so the recipe edits that one field on the local backend.

## Driving it with cursor-ide-browser

This feature has no UI yet. Drive it with `helpers/evidence-proof.sh`, which refuses to run unless `apps/club/.env.local` selects a `local:` or `anonymous:` deployment and both Convex URLs are loopback.

Preconditions:

- A local backend from this checkout, on ports that no other session uses: `cd apps/club && CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3310 --local-site-port 3311`. Its state is this checkout's `apps/club/.convex/local/`. Back up `apps/club/.env.local` first, because this command points it at the local deployment. Restore it afterwards.
- Export these in the shell: `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3310`, `NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3311`, `EVIDENCE_DIR=.cursor/skills/verify-club/evidence/<run>/evidence-snapshots`, plus `SEED_DEV_PASSWORD` and `ADMIN_PROVISION_SECRET` (any local values). Do not print them.
- Jev: `FAKE_JEV_LOG=$EVIDENCE_DIR/fake-jev.jsonl bun .cursor/skills/verify-club/helpers/fake-jev.ts` serves Jev's `/v1/systemone` on `127.0.0.1:3320`. It returns the same answers as the test suite's fake and logs every request. For real Jev, set `TYPESAFE_API_KEY` on the local deployment yourself and unset `TYPESAFE_BASE_URL` after the env step.

Steps:

- **Env.** `helpers/evidence-proof.sh env`. It prints the variable names only: `TYPESAFE_BASE_URL`, `TYPESAFE_API_KEY`, `SITE_URL`, `CLUB_DEV_SEED`, `ADMIN_PROVISION_SECRET`.
- **Seed.** `cd apps/club && CLUB_DEV_SEED=1 bun run seed:dev`. Expect `seed:dev target anonymous:anonymous-agent` (or your `local:` name) and `clubPeople 32`.
- **Refer with a resume.** `helpers/evidence-proof.sh signup proof.candidate@example.test`. It signs in as `ada.quill@example.test`, uploads a generated PDF (saved as `$EVIDENCE_DIR/resume.pdf`) and prints the new person id `p-…`.
- **Intake (`intake-lines`, `jev-records`, `skip-labelling`).** `helpers/evidence-proof.sh state <person>`. Expect one resume version with `normalized:false` and `lineCount:5`, five lines, and five records with `source:"resume"`, `author:"candidate"` and `specId` `career_evidence@1.2.4:…`. With the fake, expect `fake jev requests: 5 claim` and no `label` requests.
- **Make s0 due.** `helpers/evidence-proof.sh backdate <person> 70` moves the referral 70 days back. It changes that candidate's `evidenceIntakes` row only.
- **Cron (`s0-cron`).** `helpers/evidence-proof.sh cron run1`. Expect `{"due":N,"scheduled":N}`. The seeded candidates are due too and get thin `s0` rows. The candidate has one `s0` with `claimCount:5`, `evidenceCutoff` = referral + 30 days, and `classYear:null`. The backend log warns `… s0 snapshot … has no class year`.
- **Cron again (`cron-idempotent`).** `helpers/evidence-proof.sh cron run2`, then `helpers/evidence-proof.sh diff run1 run2`. Expect `{"due":0,"scheduled":0}` and `0 added, 0 changed or removed`. Then `helpers/evidence-proof.sh check <person> run3` and `diff run2 run3`. Expect `"scored":0,"snapshots":0` and no Jev requests.
- **Late evidence (`late-correction`).** `helpers/evidence-proof.sh set-github <person> https://github.com/octocat`, then `helpers/evidence-proof.sh check <person> run4` and `diff run3 run4`. Expect `1 added, 0 changed or removed`. The added row is an `s0` with `correctsSnapshotId` = the first `s0` id and a larger `claimCount`. `state <person>` shows GitHub records with `author:"system"`, `tier:"self_reported"` and the artifacts' own dates (2011 onward), never the fetch date.
- **Correction is idempotent.** `helpers/evidence-proof.sh check <person> run5` and `diff run4 run5`. Expect `0 added, 0 changed or removed`.
- **Teardown.** Stop `convex dev` and the fake Jev. Restore `apps/club/.env.local`. Delete `apps/club/.convex/local/` if you don't need the data. Keep `$EVIDENCE_DIR`.

## Gotchas

- Never run this against the shared dev deployment or production. The helper refuses any deployment that isn't `local:` or `anonymous:`. The edits (`backdate`, `set-github`) rewrite tables with `convex import --replace`.
- Another session may already run a local backend on `3210`/`3211`. Use other ports, and run from your own checkout, so the state directory is yours.
- `apps/club/.convex/` is not gitignored. Don't commit it.
- Jev and Grok keys on the shared dev deployment are secrets. Don't copy them to the local backend without the owner's go-ahead. Without Grok env, the check logs `company research: Grok routine env is not set; nothing requested`. That is expected, and company research is unverified in such a run.
- `cron` waits `EVIDENCE_SETTLE_SECONDS` (default 20) for the scheduled checks. Raise it if `run1` has fewer rows than `scheduled`.
- GitHub calls are live and unauthenticated unless `GITHUB_TOKEN` is set on the deployment (60 requests an hour).
- A repo's `updated_at` moves on stars and other metadata changes, so octocat's description versions are dated a day or two before the run. They land after the `s0` cutoff, which is why the correction counts 11 claims and not 15.
