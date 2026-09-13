# Demo person report

Demo prints one block per seeded persona. Each block names Referral Signal and Relative Capability Estimate as separate sections. Rubric lines, when present, say they feed no score. This is the unweighted (V0) run — Cleo's report is `12 / 100`, not the Club board's V2 `7`.

## Sub-features

- `report-six` prints blocks for Alice Tanaka, Bram Okafor, Cleo Marsh, Dev Raman, Ember Liu, and Fox Delacroix.
- `report-channels` prints `Referral Signal` then a `/ 100` (or no-referral copy) and later `Relative Capability Estimate`.
- `report-cleo-v0` shows Cleo's unweighted signal `12 / 100` and `1 incoming referral`.
- `report-insufficient` uses `Insufficient Evidence` on dimensions that are not estimated — never `0`.
- `report-rubric` prints `Structured Evidence (rubric, feeds no score)` when a persona has rubric rows.

## How to get to it (user POV)

- Run `bun run demo` from the repository root and read the persona blocks after the review queue (separated by `----` rules).
- Or run `.cursor/skills/verify-engine/helpers/demo.sh demo-person-report`.

## Driving it with verify-engine

Preconditions:

- Doctor is clean.
- `TG_*` unset.

- **Run demo.** `.cursor/skills/verify-engine/helpers/demo.sh demo-person-report`. Exit code `0`.
- **Six names.** stdout contains each of the six persona names as a block lead-in.
- **Cleo V0.** In the block that starts with `Cleo Marsh` (before the next `----` rule), stdout contains `Referral Signal`, then `12 / 100`, and `1 incoming referral`. It does not show `7 / 100` in that block.
- **Capability section.** The same Cleo block contains `Relative Capability Estimate` and at least one dimension line. Agency is estimated on the seed; some dimensions may say `Insufficient Evidence`.
- **Gap callout.** Cleo's block includes `Interesting signal:` and `Exploratory` when the under-recognition gap is large.
- **Rubric.** A later line `Structured Evidence (rubric, feeds no score)` appears for a persona who has evaluations (Cleo has Output).
- **Proof.** Quote Cleo's name, `12 / 100`, and the capability heading in `notes.md`. Keep full stdout.

## Gotchas

- Club at `/` shows Cleo as **7** (V2 at the example clock). Demo person reports are V0. Do not fail this feature because 7 is missing here; that number is in the V0→V2 table (`demo-judge-calibration`).
- `Insufficient Evidence` is the missing-value label. A `0 / 100` would be a product bug.
- Do not import `personReport()` from `src/analysis/dashboard.ts` and print it yourself.
