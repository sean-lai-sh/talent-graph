# Demo longitudinal progress

The engine demo shows an immutable 180-day case checkpoint and reports
opportunity-adjusted residual slope separately from capability and Referral
Signal.

## Sub-features

- `checkpoint` — prints the sample case horizon and exact due date.
- `defined-slope` — prints signed residual slope when both cutoffs have evidence.
- `insufficient-slope` — names insufficient early evidence instead of treating it as zero.
- `reporting-only` — labels the section as reporting only.

## How to get to it (user POV)

- Run `bun run demo` from the repository root.

## Driving it with verify-engine

Preconditions: launch and doctor pass with `TG_*` unset.

- **Checkpoint and slope report:** run
  `.cursor/skills/verify-engine/helpers/demo.sh longitudinal-progress`.
  Stdout contains `Longitudinal progress checkpoints (reporting only):`,
  `180-day checkpoint due`, `residual slope`, and `insufficient early`; exit is
  `0`.

## Gotchas

- This is a reporting path; it does not apply scout gain to Referral Signal.
- A positive residual slope is not a scalar capability score.
- The seed-only CLI does not make live TypeSafe, GitHub, ORCID, X, or Grok calls.
