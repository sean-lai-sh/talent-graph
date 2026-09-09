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
import { computeJudgeCalibration, judgeWeightOptions } from "../src/judges/reliability.ts";
import { computeAllReferralSignals, displayReferralSignal } from "../src/scoring/referralSignal.ts";
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

// V2 — judge calibration at a fixed time step T (a year after the base date).
const T = new Date("2026-12-31T00:00:00.000Z");
const calibration = computeJudgeCalibration({
  people: data.people,
  referrals: data.referrals,
  outcomes: data.outcomes,
  opportunities: data.opportunities,
  now: T,
  spec: specs.judge_reliability,
  referralSpec: specs.referral_signal,
});
const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? id;
const judged = [...calibration.estimates.values()]
  .filter((e) => e.evaluatedCount > 0)
  .sort((a, b) => b.reliability - a.reliability || (a.judgeId < b.judgeId ? -1 : 1));

console.log();
console.log(
  `Judge calibration at T = ${T.toISOString().slice(0, 10)} (judge_reliability@${specs.judge_reliability.version}, scoutHook ${specs.judge_reliability.scoutHook === true ? "on" : "off"})`,
);
console.log(
  `${calibration.options.evaluatedReferrals} referrals scored against ${calibration.truths.size} people with outcomes · ${judged.length} judges with evidence · others stay at prior ${specs.judge_reliability.priorReliability}`,
);
console.log(
  "Two numbers, not one — Judge Reliability p̂ (intensity) and Scout Information Gain Ĝ (slope). They are not added. scoutHook off ⇒ Referral Signal stays bit-for-bit V2.",
);
for (const e of judged) {
  const scout = calibration.scout.get(e.judgeId);
  const gain = scout?.gain ?? 0;
  const scoutN = scout?.evaluatedCount ?? 0;
  console.log(
    `  ${nameOf(e.judgeId).padEnd(18)} Judge Reliability p̂ ${e.reliability.toFixed(2)} · Scout Information Gain Ĝ ${gain.toFixed(3)} (${scoutN} scout-eligible) · Ē ${(e.meanSquaredError ?? 0).toFixed(3)} · bias ${e.bias >= 0 ? "+" : ""}${e.bias.toFixed(2)} · ${e.evaluatedCount} scored`,
  );
}

const weighted = computeAllReferralSignals(data.people, data.referrals, {
  spec: specs.referral_signal,
  ...judgeWeightOptions(calibration),
});
console.log();
console.log("Referral Signal, V0 (all judges = 1) vs V2 (judge-weighted):");
for (const id of PERSONA_IDS) {
  const a = signals.get(id);
  const b = weighted.get(id);
  if (!a || !b) continue;
  const delta = displayReferralSignal(b) - displayReferralSignal(a);
  console.log(
    `  ${nameOf(id).padEnd(18)} ${String(displayReferralSignal(a)).padStart(3)} → ${String(displayReferralSignal(b)).padStart(3)}  (${delta >= 0 ? "+" : ""}${delta})`,
  );
}

console.log();
console.log(
  `Referral Signal spec ${specs.referral_signal.version} · Bradley–Terry spec ${specs.bradley_terry.version} · Judge reliability spec ${specs.judge_reliability.version}` +
    (specs.referral_signal.version.includes("+env") || specs.bradley_terry.version.includes("+env")
      ? " (TG_* env overrides applied)"
      : ""),
);
