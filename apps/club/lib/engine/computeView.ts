/**
 * The council view, assembled once per call.
 *
 * This is the orchestrator: it revives the stored inputs, builds the one
 * scored referral index (`engine/referralModel.ts`), runs the capability and
 * queue passes, hands that shared context to `engine/personView.ts` for the
 * per-person dossiers, and rolls the result up into counts, candidate rows and
 * member options. No scoring lives here — every number comes from `src/`.
 *
 * Judge calibration numbers (p̂, Ē, bias) are folded into a categorical
 * track-record label here and never reach the view.
 */

import { buildReviewQueue, type ReviewEntry } from "../../../../src/analysis/reviewQueue.ts";
import { underRecognitionGaps } from "../../../../src/analysis/underRecognition.ts";
import { type LoadedSpecs, loadSpecs } from "../../../../src/config.ts";
import type { Dimension } from "../../../../src/domain/types.ts";
import { computeCapabilityVectors } from "../../../../src/inference/capabilityVector.ts";
import { judgeTrackRecord, TRACK_RECORD_ORDER } from "../../../../src/judges/trackRecord.ts";
import { defaultReviewStatus, underConsideration } from "../review.ts";
import {
  clubToComparison,
  clubToEvaluation,
  clubToOpportunity,
  clubToOutcome,
  clubToPerson,
  clubToReferral,
  reviveState,
} from "../serialize.ts";
import type {
  CandidateRow,
  ClubPerson,
  ClubState,
  ClubView,
  MemberOption,
  PersonView,
  ReviewStatus,
  TrackRecordView,
} from "../types.ts";
import { buildPersonViews } from "./personView.ts";
import { buildReferralModel } from "./referralModel.ts";

const NOT_SCORED: TrackRecordView = { label: "not_scored", evaluatedCount: 0, trust: null };

/** Score / draw only referrals that exist at T. Judge calibration already time-filters. */
function referralsAsOf<T extends { createdAt: Date }>(rows: T[], now: Date): T[] {
  const t = now.getTime();
  return rows.filter((row) => row.createdAt.getTime() <= t);
}

export function computeView(input: ClubState, specs: LoadedSpecs = loadSpecs()): ClubView {
  const state = reviveState(input);
  const people = state.people.map(clubToPerson);
  const referrals = state.referrals.map(clubToReferral);
  const comparisons = state.comparisons.map(clubToComparison);
  const evaluations = state.evaluations.map(clubToEvaluation);
  const outcomes = state.outcomes.map(clubToOutcome);
  const opportunities = state.opportunities.map(clubToOpportunity);
  const now = new Date(state.now);
  const referralsNow = referralsAsOf(referrals, now);
  const required = new Set<Dimension>(state.config.requiredDimensions);
  const byId = new Map(state.people.map((p) => [p.id, p] as const));
  const reviewOf = (p: ClubPerson): ReviewStatus => p.reviewStatus ?? defaultReviewStatus(p.status);

  // One scored index for the whole view: R_uv per referral is computed once
  // here and every strength below is read from it.
  const {
    scored,
    v0,
    v2,
    calibration: cal,
  } = buildReferralModel({
    people,
    referrals: referralsNow,
    outcomes,
    opportunities,
    now,
    specs,
  });
  const cap = computeCapabilityVectors(people, comparisons, { spec: specs.bradley_terry });
  const gaps = underRecognitionGaps(v2, cap);
  const queue = new Map<string, ReviewEntry>(
    buildReviewQueue({ people, signals: v2, capRun: cap, gaps }).map((e) => [e.personId, e]),
  );

  const windowMs = specs.judge_reliability.observationWindowDays * 86_400_000;
  const earliestReferral = Math.min(...referralsNow.map((r) => r.createdAt.getTime()));
  const windowOpen =
    Number.isFinite(earliestReferral) && now.getTime() - earliestReferral >= windowMs;

  const trackOf = (id: string): TrackRecordView => {
    const e = cal.estimates.get(id);
    if (!e) return NOT_SCORED;
    const t = judgeTrackRecord(e, specs.judge_reliability);
    return {
      label: t.label,
      evaluatedCount: t.evaluatedCount,
      trust: e.evaluatedCount === 0 ? null : e.reliability,
    };
  };
  const trackRank = (t: TrackRecordView) => TRACK_RECORD_ORDER[t.label];

  const personViews: PersonView[] = buildPersonViews({
    state,
    specs,
    byId,
    required,
    comparisons,
    evaluations,
    v0,
    v2,
    scored,
    cap,
    gaps,
    queue,
    reviewOf,
    trackOf,
    trackRank,
  });

  const candidates: CandidateRow[] = personViews
    .map((p) => {
      const estimated: CandidateRow["estimated"] = {};
      for (const d of p.dimensions) {
        if (
          d.state === "estimated" &&
          d.percentile !== null &&
          d.poolSize !== null &&
          d.poolConfidence !== null
        ) {
          estimated[d.dimension] = {
            percentile: d.percentile,
            poolSize: d.poolSize,
            poolConfidence: d.poolConfidence,
          };
        }
      }
      return {
        personId: p.id,
        name: p.name,
        affiliation: p.affiliation,
        status: p.status,
        reviewStatus: p.reviewStatus,
        bucket: p.queue?.bucket ?? null,
        flags: p.queue?.flags ?? [],
        v2Signal: p.v2Signal,
        incomingCount: p.incomingCount,
        firsthandCount: p.firsthandCount,
        evaluationCount: p.evaluations.length,
        comparisonCount: p.comparisonHistory.length,
        estimated,
        pendingFeedback: p.feedback.filter((f) => f.state === "pending").length,
        overdueFeedback: p.feedback.filter((f) => f.state === "overdue").length,
        daysInReview: p.daysInReview,
        createdAt: p.createdAt,
        persona: p.persona,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const withEvidence = new Set<string>();
  for (const r of referralsNow) withEvidence.add(r.referrerId);
  for (const c of comparisons) withEvidence.add(c.evaluatorId);
  for (const e of evaluations) withEvidence.add(e.evaluatorId);
  const members: MemberOption[] = state.people
    .filter((p) => p.status === "member" || withEvidence.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, status: p.status, trackRecord: trackOf(p.id) }))
    .sort(
      (a, b) => trackRank(a.trackRecord) - trackRank(b.trackRecord) || a.name.localeCompare(b.name),
    );

  const reviews = state.people.map(reviewOf);
  const allFeedback = personViews.flatMap((p) => p.feedback);

  return {
    counts: {
      people: state.people.length,
      underConsideration: reviews.filter(underConsideration).length,
      needsData: reviews.filter((r) => r === "needs_data").length,
      admitted: reviews.filter((r) => r === "admitted").length,
      denied: reviews.filter((r) => r === "denied").length,
      referrals: state.referrals.length,
      comparisons: state.comparisons.length,
      evaluations: state.evaluations.length,
      pendingFeedback: allFeedback.filter((f) => f.state === "pending").length,
      overdueFeedback: allFeedback.filter((f) => f.state === "overdue").length,
    },
    now: state.now,
    calibration: {
      observationWindowDays: specs.judge_reliability.observationWindowDays,
      windowOpen,
      evaluatedReferrals: cal.options.evaluatedReferrals,
      judgesWithEvidence: cal.options.judgesWithEvidence,
    },
    config: { requiredDimensions: [...state.config.requiredDimensions] },
    members,
    candidates,
    people: personViews.sort((a, b) => a.name.localeCompare(b.name)),
    snapshots: state.snapshots,
  };
}
