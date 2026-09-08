# Model spec changelog

Append-only. One entry per `ModelSpec` version (see `src/models/registry.ts`).

A weight, multiplier, threshold, or model-form change **must** ship as a new
spec version with an entry here — never as an edit to an existing version.
Each entry records what changed, why, the drift report summary, and the PR.

Run `bun run drift -- --kind <kind> --before <version> --after <version>` on
the seed dataset and paste the summary line into the entry.

---

## referral_signal@0.1.0 — initial

- **What:** `X_uv = 0.50·n(conviction) + 0.30·n(confidence) + 0.20·n(relationshipDepth)`;
  `m_e = { firsthand_work 1.00, firsthand_personal 0.90, artifact 0.85, reputation 0.60, other 0.70 }`;
  `S_v = mean(Top5 R_uv)`.
- **Why:** Values taken verbatim from the MVP prompt §9. Judge reliability `p_u`
  is fixed at 1.
- **Drift:** n/a (first version).
- **PR:** initial import.

## bradley_terry@1.0.0 — initial

- **What:** `L(θ) = −Σ logσ(θ_w − θ_l) + 0.1·Σ θ_i²`, zero-mean per component,
  `maxIterations 500`, `tolerance 1e-6`, `minComparisons 3`, `minOpponents 2`,
  `tieHandling "ignore"`, `anchorStrength 0`.
- **Why:** λ = 0.1 is a modest default that keeps single-comparison nodes near
  0 on the seed data. It is not tuned and not theoretically optimal.
- **Drift:** n/a (first version).
- **PR:** initial import.
