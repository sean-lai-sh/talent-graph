#!/usr/bin/env bun
/**
 * bun run demo — prints the dashboard and the "Alice"-style report for the
 * six personas from the seed dataset, so the Referral Signal ≠ Relative
 * Capability distinction is visually checkable without a UI.
 *
 * `TG_*` env overrides apply here through `loadSpecs()`; the math functions
 * themselves never read the environment.
 */

import { buildDashboard, formatDashboard, personReport } from "../src/analysis/dashboard.ts";
import { underRecognitionGaps } from "../src/analysis/underRecognition.ts";
import { loadSpecs } from "../src/config.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";
import { PERSONA_IDS } from "../src/seed/personas.ts";

const specs = loadSpecs();
const data = generateSeed();
const signals = computeAllReferralSignals(data.people, data.referrals, {
  spec: specs.referral_signal,
});
const capRun = computeCapabilityVectors(data.people, data.comparisons, {
  spec: specs.bradley_terry,
});
const gaps = underRecognitionGaps(signals, capRun);

console.log(formatDashboard(buildDashboard(data, signals, capRun, gaps), data.people));
console.log();
console.log("=".repeat(72));

for (const id of PERSONA_IDS) {
  console.log();
  console.log(personReport(id, data, signals, capRun, gaps));
  console.log();
  console.log("-".repeat(72));
}

console.log();
console.log(
  `Referral Signal spec ${specs.referral_signal.version} · Bradley–Terry spec ${specs.bradley_terry.version}` +
    (specs.referral_signal.version.includes("+env") || specs.bradley_terry.version.includes("+env")
      ? " (TG_* env overrides applied)"
      : ""),
);
