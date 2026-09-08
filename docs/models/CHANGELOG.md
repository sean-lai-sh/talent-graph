# Model spec changelog

Append-only. One entry per `ModelSpec` version (see `src/models/registry.ts`).

A weight, multiplier, threshold, or model-form change **must** ship as a new
spec version with an entry here — never as an edit to an existing version.
Each entry records what changed, why, the drift report summary, and the PR.
