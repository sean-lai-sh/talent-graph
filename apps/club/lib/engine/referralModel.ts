/**
 * The seam between the club view and the algorithm core.
 *
 * `computeView` used to derive the same referral facts five different ways in
 * one pass: V0 signals, V2 signals, judge calibration, a per-referral strength
 * fallback and a per-neighbour strength — each one re-deriving R_uv, two of
 * them with an O(P·R) scan over every referral per person. This module runs the
 * scoring side exactly once and hands the view a single index to read from.
 *
 * Nothing is computed differently here. `scoreReferralGraph(..., { dangling:
 * "score" })` is the V0 admission rule spelled out (the club's own `knownPerson`
 * guard means no dangling edge ever reaches it, so `scored.dangling` is empty in
 * practice — pinned by a test on the seed), `v0` is the unweighted pass and `v2`
 * the judge-weighted one, both over that one index. Displayed numbers are
 * byte-identical to the pre-seam engine; `tests/referralGolden.test.ts` is the
 * proof.
 *
 * What is NOT here, deliberately:
 *
 *   - the as-of filter (`referralsAsOf`). It is a club-only reading of "what
 *     existed at T" and stays in `engine.ts`; this function takes whatever
 *     referral set the caller decided on.
 *   - capability vectors. Bradley–Terry is not referral evidence and has no
 *     business sharing this index; it stays in `computeView`.
 *   - any spec default. `specs` is required, so a historical view reproduces
 *     its own numbers rather than following a moved current spec.
 */

import type { LoadedSpecs } from "../../../../src/config.ts";
import type { Opportunity, Outcome, Person, Referral } from "../../../../src/domain/types.ts";
import {
  computeJudgeCalibration,
  type JudgeCalibrationRun,
  judgeWeightOptions,
} from "../../../../src/judges/reliability.ts";
import {
  computeSignalsFromGraph,
  type ReferralSignalResult,
} from "../../../../src/scoring/referralSignal.ts";
import {
  type ScoredReferralGraph,
  scoreReferralGraph,
} from "../../../../src/scoring/scoredGraph.ts";

export interface ReferralModel {
  /** The one scored index. Every R_uv in the view comes from here, computed once. */
  scored: ScoredReferralGraph;
  /** Unweighted Referral Signal per person id (V0). */
  v0: Map<string, ReferralSignalResult>;
  /** Judge-weighted Referral Signal per person id (V2). */
  v2: Map<string, ReferralSignalResult>;
  calibration: JudgeCalibrationRun;
}

export interface ReferralModelInput {
  people: readonly Person[];
  /** Already filtered to the view's `now` by the caller. */
  referrals: readonly Referral[];
  outcomes: readonly Outcome[];
  opportunities: readonly Opportunity[];
  now: Date;
  specs: LoadedSpecs;
}

/**
 * Score the referral graph once, then read V0, the judge calibration and V2 off
 * that same index.
 *
 * Order matters only in that V2 needs the calibration; V0 and the calibration
 * are independent of each other and of V2.
 */
export function buildReferralModel(input: ReferralModelInput): ReferralModel {
  const { people, referrals, outcomes, opportunities, now, specs } = input;
  // `"score"` is the V0 dangling rule, spelled out rather than inherited from a
  // default that could move.
  const scored = scoreReferralGraph(people, referrals, specs.referral_signal, {
    dangling: "score",
  });
  const v0 = computeSignalsFromGraph(scored, {});
  const calibration = computeJudgeCalibration({
    people,
    referrals,
    outcomes,
    opportunities,
    now,
    spec: specs.judge_reliability,
    referralSpec: specs.referral_signal,
  });
  const v2 = computeSignalsFromGraph(scored, judgeWeightOptions(calibration));
  return { scored, v0, v2, calibration };
}
