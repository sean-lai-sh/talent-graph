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
import {
  buildReviewQueue,
  groupReviewQueue,
  REVIEW_BUCKET_COPY,
} from "../src/analysis/reviewQueue.ts";
import { summarizeEvaluations } from "../src/analysis/rubricSummary.ts";
import { underRecognitionGaps } from "../src/analysis/underRecognition.ts";
import { loadSpecs } from "../src/config.ts";
import { DIMENSIONS, SCALE_LABELS } from "../src/domain/constants.ts";
import { computeCapabilityVectors, dimensionLabel } from "../src/inference/capabilityVector.ts";
import { computeJudgeCalibration, judgeWeightOptions } from "../src/judges/reliability.ts";
import {
  judgeTrackRecord,
  TRACK_RECORD_COPY,
  TRACK_RECORD_ORDER,
} from "../src/judges/trackRecord.ts";
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

const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? id;

// Review queue — categorical buckets over both channels, no merged number.
console.log();
console.log("Review queue (candidates, by evidence state):");
const queue = buildReviewQueue({ people: data.people, signals, capRun, gaps });
for (const group of groupReviewQueue(queue)) {
  console.log(`  ${REVIEW_BUCKET_COPY[group.bucket].label}`);
  for (const e of group.entries) {
    console.log(`    ${nameOf(e.personId).padEnd(18)} ${e.reasons.join(" · ")}`);
  }
}
console.log();
console.log("=".repeat(72));

for (const id of PERSONA_IDS) {
  console.log();
  console.log(personReport(id, data, signals, capRun, gaps));
  const rubric = summarizeEvaluations(data.evaluations.filter((e) => e.candidateId === id));
  const written = DIMENSIONS.filter((d) => rubric[d].scored + rubric[d].notObserved > 0);
  if (written.length > 0) {
    console.log();
    console.log("Structured Evidence (rubric, feeds no score)");
    for (const d of written) {
      const r = rubric[d];
      const mean =
        r.mean === null
          ? SCALE_LABELS.rubricNotObserved
          : `${r.mean.toFixed(1)} / 4 · ${SCALE_LABELS.rubric[Math.round(r.mean) as 0 | 1 | 2 | 3 | 4]}`;
      console.log(
        `${dimensionLabel(d).padEnd(20)}${mean} · ${r.scored} scored · ${r.notObserved} not observed · ${r.evaluators} evaluator${r.evaluators === 1 ? "" : "s"}`,
      );
    }
  }
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
const judged = [...calibration.estimates.values()]
  .filter((e) => e.evaluatedCount > 0)
  .map((e) => ({ e, track: judgeTrackRecord(e, specs.judge_reliability) }))
  .sort(
    (a, b) =>
      TRACK_RECORD_ORDER[a.track.label] - TRACK_RECORD_ORDER[b.track.label] ||
      b.e.evaluatedCount - a.e.evaluatedCount ||
      (a.e.judgeId < b.e.judgeId ? -1 : 1),
  );

console.log();
console.log(`Judge calibration at T = ${T.toISOString().slice(0, 10)} (V2, Exploratory)`);
console.log(
  `${calibration.options.evaluatedReferrals} referrals scored against ${calibration.truths.size} people with outcomes · ${judged.length} judges with evidence · track record is a display label, not a weight`,
);
for (const { e, track } of judged) {
  console.log(
    `  ${nameOf(e.judgeId).padEnd(18)} ${TRACK_RECORD_COPY[track.label].padEnd(18)} · ${e.evaluatedCount} scored`,
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
