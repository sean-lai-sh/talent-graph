# Demo dashboard

`bun run demo` opens with a plain-text dashboard over the seed: headcount, top Referral Signals, top Relative Capability Estimates (with pool size and confidence), and exploratory under-recognition gaps. The two channels are listed separately. Nothing is merged into one score.

## Sub-features

- `dash-header` prints `Talent Graph — dashboard` and people/referral/comparison counts.
- `dash-referral` lists `Top Referral Signal:` with names and `/ 100` values.
- `dash-capability` lists `Top Relative Capability Estimates:` with a dimension, percentile, and `pool: N people, … confidence`.
- `dash-gap` lists `Under-Recognition Gap (Exploratory):`.
- `dash-no-merge` never prints banned phrases (`Talent Score`, `Capability Score`, `Intelligence Score`, `Objective Rank`, `Human Value`).

## How to get to it (user POV)

- Run `bun run demo` from the repository root.
- Or run `.cursor/skills/verify-engine/helpers/demo.sh demo-dashboard`.

## Driving it with verify-engine

Preconditions:

- Doctor is clean.
- `TG_*` unset (the helper unsets them).

- **Run demo.** `.cursor/skills/verify-engine/helpers/demo.sh demo-dashboard`. Exit code `0`. stderr empty or only bun noise.
- **Header.** `stdout.txt` starts with `Talent Graph — dashboard` and a `People` line that includes `candidates`, `members`, `archived`, `referrals`, `comparisons`, and `rubric evaluations`.
- **Referral channel.** A block titled `Top Referral Signal:` lists seed names and values like `NN / 100 · N referrals`. Dev Raman is first at **100 / 100**. Bram Okafor appears at **77 / 100** (this is V0; Club's UI 62 is V2). Cleo is not on this top-10 — do not invent her here.
- **Capability channel.** A block titled `Top Relative Capability Estimates:` includes `percentile`, `comparisons`, and `pool:` on each row.
- **Gap channel.** A block titled `Under-Recognition Gap (Exploratory):` lists names and signed gaps. Cleo Marsh appears here.
- **No merge.** stdout contains neither a combined score column nor any banned phrase.
- **Read-only.** `git status` after the command does not show new tracked files outside `evidence/` / `runs/`.
- **Proof.** Keep the full `stdout.txt` and a `notes.md` that quotes the header plus one line from each of the three blocks.

## Gotchas

- The dashboard is the **first** section of demo. Person reports come later. Do not grep a person-report `7 / 100` and call the dashboard verified.
- `Top Relative Capability Estimates:` is the literal heading (product name plus `s`).
- `TG_*` in the environment retags versions `+env` and can change who appears in the top lists. Unset them.
- `bun test tests/dashboard.test.ts` is not this feature.
