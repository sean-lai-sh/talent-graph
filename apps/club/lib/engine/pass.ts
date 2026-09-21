/**
 * The seam between the club view and the algorithm core: one call to
 * `advance()` per view.
 *
 * `computeView` used to hand-sequence the pipeline — V0 signals, judge
 * calibration, V2 signals, capability vectors — in an order written nowhere
 * else. That order is `src/pipeline/advance.ts`'s to own: it is the only
 * place **calibration → weights → signal** is spelled out, so the Club now
 * runs the same pass the demo and the drift scripts run, and reads the runs
 * off the result. Nothing is computed differently; `tests/club-engine.test.ts`
 * pins the pass's V0 / V2 / calibration against the hand-sequenced calls it
 * replaced, and `tests/club-provenance.test.ts` hashes the whole `ClubView`.
 *
 * A pass also produces what the Club never recorded before: the `ModelRun` id
 * of every run behind the view, and the spec version each kind ran under.
 * `transitions.ts` freezes those onto a decision snapshot.
 *
 * What is NOT here, deliberately:
 *
 *   - the as-of filter (`referralsAsOf`). It is a club-only reading of "what
 *     existed at T" and stays with the orchestrator in `computeView.ts`; this
 *     function takes whatever referral set the caller decided on, and asks
 *     `advance` for an as-of pass over it so the rule is stated, not implied.
 *   - any spec default. `specs` is required, so a historical view reproduces
 *     its own numbers rather than following a moved current spec.
 *
 * The one thing computed beside the pass is the scored referral index. Every
 * R_uv the *view* draws — a referral row's strength, a neighbourhood edge —
 * is read from this one index rather than re-derived per person, which is
 * what it was built for; the pass scores its own graph internally, for its
 * own signals.
 */

import type { LoadedSpecs } from "../../../../src/config.ts";
import type {
  Comparison,
  Opportunity,
  Outcome,
  Person,
  Referral,
} from "../../../../src/domain/types.ts";
import type { CapabilityRun } from "../../../../src/inference/capabilityVector.ts";
import type { JudgeCalibrationRun } from "../../../../src/judges/reliability.ts";
import {
  advance,
  baselineReferralRun,
  judgeWeightedReferralRun,
  requireRun,
} from "../../../../src/pipeline/advance.ts";
import type { ReferralSignalResult } from "../../../../src/scoring/referralSignal.ts";
import {
  type ScoredReferralGraph,
  scoreReferralGraph,
} from "../../../../src/scoring/scoredGraph.ts";
import type { ClubSpecVersions } from "../types.ts";

/** What a decision snapshot records about the pass it was taken on. */
export interface ClubProvenance {
  /** Every run of the pass, in evaluation order. Never empty. */
  modelRunIds: string[];
  specVersions: ClubSpecVersions;
}

export interface ClubPass {
  /** The one scored index. Every R_uv in the view comes from here, computed once. */
  scored: ScoredReferralGraph;
  /** Unweighted Referral Signal per person id (V0). */
  v0: Map<string, ReferralSignalResult>;
  /** Judge-weighted Referral Signal per person id (V2). */
  v2: Map<string, ReferralSignalResult>;
  calibration: JudgeCalibrationRun;
  /** Relative Capability Estimates of the same pass. */
  capability: CapabilityRun;
  provenance: ClubProvenance;
}

export interface ClubPassInput {
  people: readonly Person[];
  /** Already filtered to the view's `now` by the caller. */
  referrals: readonly Referral[];
  comparisons: readonly Comparison[];
  outcomes: readonly Outcome[];
  opportunities: readonly Opportunity[];
  now: Date;
  specs: LoadedSpecs;
}

/**
 * One pass of the engine over the club's observations, plus the scored index
 * the view reads R_uv from.
 *
 * No previous state is handed to `advance`: a club view is recomputed from
 * the stored inputs every time, so there is no prior fit to anchor on and no
 * pass to drift against — `drift: false` says so rather than letting an empty
 * report list imply it.
 */
export function runClubPass(input: ClubPassInput): ClubPass {
  const { people, referrals, comparisons, outcomes, opportunities, now, specs } = input;
  const result = advance(
    null,
    { people, referrals, comparisons, outcomes, opportunities },
    specs,
    now,
    // `asOf` is idempotent on an already-filtered set; it is passed so the
    // pass states the club's "what existed at T" rule instead of depending on
    // the caller having applied it.
    { asOf: true, drift: false },
  );
  const calibration = requireRun(result.state, "judge_reliability");
  const capability = requireRun(result.state, "bradley_terry");
  const baseline = baselineReferralRun(result);
  const weighted = judgeWeightedReferralRun(result);
  // `"score"` is the V0 dangling rule, spelled out rather than inherited from
  // a default that could move — the same rule `computeAllReferralSignals`
  // applies inside the pass.
  const scored = scoreReferralGraph(people, referrals, specs.referral_signal, {
    dangling: "score",
  });
  return {
    scored,
    v0: baseline.outputs,
    v2: weighted.outputs,
    calibration: calibration.outputs,
    capability: capability.outputs,
    provenance: {
      modelRunIds: result.runs.map((run) => run.id),
      specVersions: {
        referral_signal: baseline.specVersion,
        bradley_terry: capability.specVersion,
        judge_reliability: calibration.specVersion,
      },
    },
  };
}
