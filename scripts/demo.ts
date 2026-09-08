#!/usr/bin/env bun
/**
 * bun run demo — prints the dashboard and the "Alice"-style report for the
 * six personas from the seed dataset, so the Referral Signal ≠ Relative
 * Capability distinction is visually checkable without a UI.
 */

import { buildDashboard, formatDashboard, personReport } from "../src/analysis/dashboard.ts";
import { underRecognitionGaps } from "../src/analysis/underRecognition.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";
import { PERSONA_IDS } from "../src/seed/personas.ts";

const data = generateSeed();
const signals = computeAllReferralSignals(data.people, data.referrals);
const capRun = computeCapabilityVectors(data.people, data.comparisons);
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
  `Referral Signal spec ${signals.get(PERSONA_IDS[0] as string)?.specVersion} · Bradley–Terry spec ${capRun.options.specVersion}`,
);
