# Demo judge calibration

The tail of `bun run demo` prints judge track-record labels at a fixed date and a table of Referral Signal V0 (every judge weight 1) versus V2 (judge-weighted). Labels are display copy, not weights. Cleo's seed pin is `12 → 7`.

## Sub-features

- `cal-header` prints `Judge calibration at T = 2026-12-31 (V2, Exploratory)`.
- `cal-labels` lists judges with a track-record phrase (`calibrated`, `tends to underrate`, `unproven`, …) and a scored count.
- `cal-v0v2` prints `Referral Signal, V0 (all judges = 1) vs V2 (judge-weighted):`.
- `cal-cleo` includes `Cleo Marsh` with `12 →   7  (-5)`.
- `cal-spec-line` ends with Referral Signal spec `0.1.0`, Bradley–Terry spec `1.0.0`, and Judge reliability spec `2.0.0` when `TG_*` is unset.

## How to get to it (user POV)

- Run `bun run demo` from the repository root and read the last sections after the persona reports.
- Or run `.cursor/skills/verify-engine/helpers/demo.sh demo-judge-calibration`.

## Driving it with verify-engine

Preconditions:

- Doctor is clean.
- `TG_*` unset.

- **Run demo.** `.cursor/skills/verify-engine/helpers/demo.sh demo-judge-calibration`. Exit code `0`.
- **Header.** stdout contains `Judge calibration at T = 2026-12-31 (V2, Exploratory)` and the sentence that track record is a display label, not a weight.
- **Labels.** At least one judge line includes `calibrated` or `tends to underrate` and `scored`. Raw `reliability` / `bias` numbers are not printed as a weight.
- **V0 vs V2.** stdout contains `Referral Signal, V0 (all judges = 1) vs V2 (judge-weighted):`.
- **Cleo pin.** A line for `Cleo Marsh` matches `12 →   7  (-5)` (spacing may pad the numbers; the three values are 12, 7, and -5).
- **Spec footer.** The last non-empty line names specs `0.1.0`, `1.0.0`, and `2.0.0` and does **not** say `(TG_* env overrides applied)`.
- **Proof.** Quote the calibration header, the Cleo V0→V2 line, and the spec footer in `notes.md`.

## Gotchas

- This is the only demo section that should show Cleo as **7**. The person-report block above it is 12.
- If the spec footer contains `+env` or `TG_* env overrides applied`, the shell was dirty. Rerun with the helper (it unsets `TG_*`).
- Do not call `computeJudgeCalibration` from a scratch file.
