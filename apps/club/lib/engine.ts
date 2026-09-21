/**
 * Council view over the algorithm core. No scoring lives here — this file
 * only serialises club state and calls `compute*` from `src/`.
 *
 * The engine is split into modules under `lib/engine/`, all of them reachable
 * from here so callers keep importing `lib/engine.ts` and nothing else:
 *
 *   - `engine/pass.ts`         — one `advance()` per view, plus the scored
 *                                referral index the view reads R_uv from.
 *   - `engine/computeView.ts`   — the orchestrator that assembles a `ClubView`.
 *   - `engine/personView.ts`    — the per-person dossier builder.
 *   - `engine/transitions.ts`   — the pure (state, input) → result mutations.
 *
 * What stays here: the state constructors. `/demo` starts from `generateSeed()`
 * via `initialState()`; `/example` redirects there. `/` is the chips landing.
 * `/club` persists domain inputs and calls the same helpers. Persisted orgs use
 * `emptyState()` / wall clock; the example keeps EXAMPLE_T_END.
 */

import type { Dimension } from "../../../src/domain/types.ts";
import { generateSeed } from "../../../src/seed/generate.ts";
import { computeView } from "./engine/computeView.ts";
import { dueAtFor } from "./review.ts";
import {
  comparisonToClub,
  defaultReviewConfig,
  EXAMPLE_T_END,
  evaluationToClub,
  opportunityToClub,
  outcomeToClub,
  personToClub,
  referralToClub,
} from "./serialize.ts";
import type { ClubState, EngineResult, IsoDate, ReviewStatus } from "./types.ts";

export { INTERESTING_GAP } from "../../../src/analysis/dashboard.ts";
export { computeView } from "./engine/computeView.ts";
export { OWNER_EVALUATOR_ID, OWNER_NAME } from "./engine/shared.ts";
export {
  addComparison,
  addEvaluation,
  addPerson,
  addReferral,
  decide,
  queueBuckets,
  recordFeedback,
  requestFeedback,
  setReviewConfig,
  setStatus,
} from "./engine/transitions.ts";
export { EXAMPLE_T_END, EXAMPLE_T_START } from "./serialize.ts";

const HOUR = 3_600_000;

/** Required dimensions for the public example round. */
export const EXAMPLE_REQUIRED_DIMENSIONS: readonly Dimension[] = [
  "problem_solving",
  "agency",
  "output",
];

function shiftHours(iso: IsoDate, hours: number): IsoDate {
  return new Date(new Date(iso).getTime() + hours * HOUR).toISOString();
}

/** Wall clock for persisted orgs. Example seed keeps EXAMPLE_T_* via initialState(). */
export function wallClockNow(): string {
  return new Date().toISOString();
}

/** Empty persisted-org inputs. Clock is wall time, not EXAMPLE_T_END. */
export function emptyState(now: string = wallClockNow()): ClubState {
  return {
    people: [],
    referrals: [],
    comparisons: [],
    evaluations: [],
    outcomes: [],
    opportunities: [],
    snapshots: [],
    feedbackRequests: [],
    config: defaultReviewConfig(),
    now,
  };
}

/**
 * The public example: the seed plus a small council layer (review statuses,
 * three feedback requests, a three-dimension round) so every state on the
 * page is visible on load. Engine inputs are the seed, unchanged.
 */
export function initialState(): ClubState {
  const data = generateSeed();
  const state: ClubState = {
    people: data.people.map(personToClub),
    referrals: data.referrals.map(referralToClub),
    comparisons: data.comparisons.map(comparisonToClub),
    evaluations: data.evaluations.map(evaluationToClub),
    outcomes: data.outcomes.map(outcomeToClub),
    opportunities: data.opportunities.map(opportunityToClub),
    snapshots: [],
    feedbackRequests: [],
    config: { requiredDimensions: [...EXAMPLE_REQUIRED_DIMENSIONS] },
    now: EXAMPLE_T_END,
  };
  for (const p of state.people) {
    const slug = p.name.toLowerCase().replace(/[^a-z]+/g, "");
    p.linkedin ??= `https://www.linkedin.com/in/${slug}`;
    p.resume ??= `https://example.com/resume/${p.id}`;
  }
  const idOf = (name: string) => state.people.find((p) => p.name === name)?.id;
  const setReview = (id: string | undefined, review: ReviewStatus) => {
    const p = state.people.find((row) => row.id === id);
    if (p) p.reviewStatus = review;
  };

  // Cleo: under review, one pending request to a calibrated judge who compared her.
  const tomas = idOf("Tomas Lindqvist");
  if (tomas) {
    setReview("p-cleo", "under_review");
    const requestedAt = shiftHours(EXAMPLE_T_END, -20);
    state.feedbackRequests.push({
      id: "fb-example-cleo",
      candidateId: "p-cleo",
      memberId: tomas,
      requestedAt,
      dueAt: dueAtFor(requestedAt),
      note: "You compared her on problem solving. What did you see on agency and output?",
      respondedAt: null,
      evaluationId: null,
    });
  }
  // Dev: council asked for more data; the request is a day overdue.
  const kai = idOf("Kai Duval");
  if (kai) {
    setReview("p-dev", "needs_data");
    const requestedAt = shiftHours(EXAMPLE_T_END, -72);
    state.feedbackRequests.push({
      id: "fb-example-dev",
      candidateId: "p-dev",
      memberId: kai,
      requestedAt,
      dueAt: dueAtFor(requestedAt),
      note: "One referral, no comparisons on any dimension. Anything firsthand?",
      respondedAt: null,
      evaluationId: null,
    });
  }
  // Bram: a request that was answered — linked to his one seed evaluation.
  const bramEval = state.evaluations.find((e) => e.candidateId === "p-bram");
  if (bramEval) {
    setReview("p-bram", "under_review");
    const requestedAt = shiftHours(bramEval.createdAt, -24);
    state.feedbackRequests.push({
      id: "fb-example-bram",
      candidateId: "p-bram",
      memberId: bramEval.evaluatorId,
      requestedAt,
      dueAt: dueAtFor(requestedAt),
      note: "Loud referrals, middling compares. Rubric, please.",
      respondedAt: bramEval.createdAt,
      evaluationId: bramEval.id,
    });
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * Entry points — the example round, loaded and reset.
 * ------------------------------------------------------------------ */

export function loadClub(): EngineResult {
  const state = initialState();
  return { state, view: computeView(state) };
}

export function resetClub(): EngineResult {
  return loadClub();
}
