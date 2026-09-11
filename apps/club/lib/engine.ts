/**
 * Council view over the algorithm core. No scoring lives here — this file
 * only serialises club state and calls `compute*` from `src/`.
 *
 * `/` and `/example` start from `generateSeed()` via `initialState()`.
 * `/club` persists domain inputs in Convex and calls the same helpers.
 * Persisted orgs use `emptyState()` / wall clock; the example keeps EXAMPLE_T_END.
 *
 * Judge calibration numbers (p̂, Ē, bias) are folded into a categorical
 * track-record label here and never reach the view.
 */

import { INTERESTING_GAP } from "../../../src/analysis/dashboard.ts";
import {
  buildReviewQueue,
  type ReviewBucket,
  type ReviewEntry,
} from "../../../src/analysis/reviewQueue.ts";
import { summarizeEvaluations } from "../../../src/analysis/rubricSummary.ts";
import { underRecognitionGaps } from "../../../src/analysis/underRecognition.ts";
import { type LoadedSpecs, loadSpecs } from "../../../src/config.ts";
import { DIMENSION_PROMPTS, DIMENSIONS, SCALE_LABELS } from "../../../src/domain/constants.ts";
import type {
  Comparison,
  Dimension,
  Evaluation,
  Person,
  PersonStatus,
  Referral,
  RubricScore,
} from "../../../src/domain/types.ts";
import {
  isDimension,
  validateComparison,
  validateEvaluation,
  validateReferral,
} from "../../../src/domain/validate.ts";
import { buildReferralGraph, referredBy, referrersOf } from "../../../src/graph/referralGraph.ts";
import {
  computeCapabilityVectors,
  dimensionLabel,
} from "../../../src/inference/capabilityVector.ts";
import { computeJudgeCalibration, judgeWeightOptions } from "../../../src/judges/reliability.ts";
import { judgeTrackRecord, TRACK_RECORD_ORDER } from "../../../src/judges/trackRecord.ts";
import {
  computeAllReferralSignals,
  displayReferralSignal,
  type ReferralSignalResult,
} from "../../../src/scoring/referralSignal.ts";
import { referralStrength } from "../../../src/scoring/referralStrength.ts";
import { generateSeed } from "../../../src/seed/generate.ts";
import { PERSONA_IDS } from "../../../src/seed/personas.ts";
import {
  daysBetween,
  defaultReviewStatus,
  dueAtFor,
  feedbackState,
  nextReviewStatus,
  statusForReview,
  underConsideration,
} from "./review.ts";
import {
  clubToComparison,
  clubToEvaluation,
  clubToOpportunity,
  clubToOutcome,
  clubToPerson,
  clubToReferral,
  comparisonToClub,
  defaultReviewConfig,
  EXAMPLE_T_END,
  evaluationToClub,
  opportunityToClub,
  outcomeToClub,
  personToClub,
  referralToClub,
  reviveState,
} from "./serialize.ts";
import type {
  AddComparisonInput,
  AddEvaluationInput,
  AddPersonInput,
  AddReferralInput,
  CandidateRow,
  ClubEvaluation,
  ClubFeedbackRequest,
  ClubPerson,
  ClubSnapshot,
  ClubState,
  ClubView,
  ComparisonResult,
  Decision,
  DimensionView,
  EngineResult,
  EvidenceItem,
  FeedbackView,
  IsoDate,
  JudgeEvidenceGroup,
  MemberOption,
  MissingEvidenceItem,
  NetworkHint,
  PersonView,
  RecordFeedbackInput,
  ReferralView,
  RequestFeedbackInput,
  ReviewStatus,
  RubricSummaryRow,
  SetReviewConfigInput,
  SuggestedMember,
  TrackRecordView,
} from "./types.ts";

export { EXAMPLE_T_END, EXAMPLE_T_START } from "./serialize.ts";

/** The signed-in council member when nobody else is named as evaluator. */
export const OWNER_EVALUATOR_ID = "example-admin";
export const OWNER_NAME = "Admin";

/** Required dimensions for the public example round. */
export const EXAMPLE_REQUIRED_DIMENSIONS: readonly Dimension[] = [
  "problem_solving",
  "agency",
  "output",
];

const personaSet = new Set<string>(PERSONA_IDS);
const HOUR = 3_600_000;
const NOT_SCORED: TrackRecordView = { label: "not_scored", evaluatedCount: 0, trust: null };

function networkHintFor(
  status: PersonStatus,
  referrers: { status: PersonStatus }[],
  bucket: ReviewBucket | null,
  incomingCount: number,
): NetworkHint | null {
  if (status === "member") return { lean: "invite", text: "Already in the club." };
  if (status === "archived") return { lean: "hold", text: "Previously declined." };
  const members = referrers.filter((r) => r.status === "member").length;
  if (bucket === "under_recognized" && members >= 1) {
    return {
      lean: "look",
      text: `Quiet on paper, but ${members === 1 ? "a member" : `${members} members`} in the graph referred them.`,
    };
  }
  if (bucket === "ready_to_decide" && members >= 2) {
    return {
      lean: "invite",
      text: `${members} members already sit next to them in the referral graph.`,
    };
  }
  if (bucket === "ready_to_decide") {
    return { lean: "invite", text: "The observed network has already spoken more than once." };
  }
  if (incomingCount <= 1) {
    return { lean: "hold", text: "Thin graph so far. One edge is not enough to invite." };
  }
  if (members >= 2) {
    return { lean: "look", text: `${members} members are in their neighbourhood.` };
  }
  if (incomingCount === 0) {
    return { lean: "hold", text: "No edges from the club yet." };
  }
  return { lean: "look", text: "Some signal in the graph; not enough to lean invite." };
}

/** Display integer, or null when there is no incoming referral (not a score of 0). */
function measuredSignal(result: ReferralSignalResult): number | null {
  if (result.incomingCount < 1) return null;
  return displayReferralSignal(result);
}

function nameOf(state: ClubState, id: string): string {
  if (id === OWNER_EVALUATOR_ID) return OWNER_NAME;
  return state.people.find((p) => p.id === id)?.name ?? id;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function shiftHours(iso: IsoDate, hours: number): IsoDate {
  return new Date(new Date(iso).getTime() + hours * HOUR).toISOString();
}

function rubricAnchor(score: RubricScore | null): string {
  return score === null ? SCALE_LABELS.rubricNotObserved : SCALE_LABELS.rubric[score];
}

function comparisonResult(c: Comparison, personId: string): ComparisonResult {
  if (c.outcome === "tie") return "tie";
  if (c.outcome === "skip") return "skip";
  if (c.outcome === "insufficient_observation") return "not_observed";
  return c.winnerId === personId ? "won" : "lost";
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

  const v0 = computeAllReferralSignals(people, referralsNow, { spec: specs.referral_signal });
  const cap = computeCapabilityVectors(people, comparisons, { spec: specs.bradley_terry });
  const cal = computeJudgeCalibration({
    people,
    referrals: referralsNow,
    outcomes,
    opportunities,
    now,
    spec: specs.judge_reliability,
    referralSpec: specs.referral_signal,
  });
  const v2 = computeAllReferralSignals(people, referralsNow, {
    spec: specs.referral_signal,
    ...judgeWeightOptions(cal),
  });
  const gaps = underRecognitionGaps(v2, cap);
  const queue = new Map<string, ReviewEntry>(
    buildReviewQueue({ people, signals: v2, capRun: cap, gaps }).map((e) => [e.personId, e]),
  );
  const graph = buildReferralGraph(people, referralsNow);

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

  const evaluationsOf = new Map<string, Evaluation[]>();
  for (const e of evaluations) {
    const list = evaluationsOf.get(e.candidateId);
    if (list) list.push(e);
    else evaluationsOf.set(e.candidateId, [e]);
  }
  const comparisonsOf = new Map<string, Comparison[]>();
  for (const c of comparisons) {
    for (const id of [c.personAId, c.personBId]) {
      const list = comparisonsOf.get(id);
      if (list) list.push(c);
      else comparisonsOf.set(id, [c]);
    }
  }
  const feedbackOf = new Map<string, ClubFeedbackRequest[]>();
  for (const f of state.feedbackRequests) {
    const list = feedbackOf.get(f.candidateId);
    if (list) list.push(f);
    else feedbackOf.set(f.candidateId, [f]);
  }

  const personViews: PersonView[] = state.people.map((p) => {
    const s0 = v0.get(p.id);
    const s2 = v2.get(p.id);
    const vector = cap.vectors.get(p.id);
    const review = reviewOf(p);
    const entry = queue.get(p.id);
    const myEvaluations = evaluationsOf.get(p.id) ?? [];
    const myComparisons = comparisonsOf.get(p.id) ?? [];
    const myReferrals = referralsNow.filter((r) => r.candidateId === p.id);
    const contributingIds = new Set((s2?.contributing ?? []).map((c) => c.referral.id));
    const rubric = summarizeEvaluations(myEvaluations);

    const dimensions: DimensionView[] = DIMENSIONS.map((d) => {
      const e = vector?.dimensions[d];
      const base = {
        dimension: d,
        label: dimensionLabel(d),
        prompt: DIMENSION_PROMPTS[d],
        required: required.has(d),
      };
      if (!e) {
        return {
          ...base,
          state: "insufficient_evidence" as const,
          percentile: null,
          comparisonCount: 0,
          opponentCount: 0,
          poolSize: null,
          poolConfidence: null,
          reason: "no comparison data",
        };
      }
      if (e.state === "estimated") {
        return {
          ...base,
          state: "estimated" as const,
          percentile: e.percentile,
          comparisonCount: e.comparisonCount,
          opponentCount: e.opponentCount,
          poolSize: e.poolSize,
          poolConfidence: e.poolConfidence,
          reason: null,
        };
      }
      return {
        ...base,
        state: "insufficient_evidence" as const,
        percentile: null,
        comparisonCount: e.comparisonCount,
        opponentCount: e.opponentCount,
        poolSize: null,
        poolConfidence: null,
        reason: e.reason,
      };
    });

    const rubricRows: RubricSummaryRow[] = DIMENSIONS.map((d) => {
      const r = rubric[d];
      return {
        dimension: d,
        label: dimensionLabel(d),
        required: required.has(d),
        mean: r.mean,
        anchor: r.mean === null ? null : SCALE_LABELS.rubric[Math.round(r.mean) as RubricScore],
        scored: r.scored,
        notObserved: r.notObserved,
        evaluators: r.evaluators,
      };
    });

    const referralViews: ReferralView[] = myReferrals
      .map((r) => {
        const scored = s2?.contributing.find((c) => c.referral.id === r.id);
        const breakdown = scored?.breakdown;
        return {
          referralId: r.id,
          referrerId: r.referrerId,
          referrerName: nameOf(state, r.referrerId),
          judgeTrackRecord: trackOf(r.referrerId),
          strength: scored?.breakdown.strength ?? referralStrength(r, specs.referral_signal),
          conviction: r.conviction,
          confidence: r.confidence,
          relationshipDepth: r.relationshipDepth,
          evidenceType: r.evidenceType,
          evidenceText: r.evidenceText,
          multiplier:
            breakdown?.multiplier ?? specs.referral_signal.evidenceMultiplier[r.evidenceType],
          createdAt: r.createdAt.toISOString(),
          contributing: contributingIds.has(r.id),
        };
      })
      .sort((a, b) => b.strength - a.strength || a.referralId.localeCompare(b.referralId));

    const evaluationViews = myEvaluations
      .map((e) => ({
        id: e.id,
        evaluatorId: e.evaluatorId,
        evaluatorName: nameOf(state, e.evaluatorId),
        trackRecord: trackOf(e.evaluatorId),
        dimension: e.dimension,
        dimensionLabel: dimensionLabel(e.dimension),
        score: e.score,
        scoreLabel: rubricAnchor(e.score),
        confidence: e.confidence,
        evidenceText: e.evidenceText,
        createdAt: e.createdAt.toISOString(),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

    const comparisonHistory = myComparisons
      .map((c) => {
        const otherId = c.personAId === p.id ? c.personBId : c.personAId;
        return {
          id: c.id,
          dimension: c.dimension,
          dimensionLabel: dimensionLabel(c.dimension),
          otherId,
          otherName: nameOf(state, otherId),
          otherStatus: byId.get(otherId)?.status ?? "candidate",
          evaluatorId: c.evaluatorId,
          evaluatorName: nameOf(state, c.evaluatorId),
          outcome: c.outcome,
          result: comparisonResult(c, p.id),
          confidence: c.confidence,
          evidenceText: c.evidenceText ?? null,
          createdAt: c.createdAt.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

    // Evidence by judge: every comment on this person, grouped by author.
    const groups = new Map<string, EvidenceItem[]>();
    const push = (judgeId: string, item: EvidenceItem) => {
      const list = groups.get(judgeId);
      if (list) list.push(item);
      else groups.set(judgeId, [item]);
    };
    for (const r of referralViews) {
      push(r.referrerId, {
        kind: "referral",
        id: r.referralId,
        createdAt: r.createdAt,
        evidenceText: r.evidenceText,
        evidenceType: r.evidenceType,
        conviction: r.conviction,
        confidence: r.confidence,
        relationshipDepth: r.relationshipDepth,
        strength: r.strength,
        contributing: r.contributing,
      });
    }
    for (const e of evaluationViews) {
      push(e.evaluatorId, {
        kind: "evaluation",
        id: e.id,
        createdAt: e.createdAt,
        evidenceText: e.evidenceText,
        dimension: e.dimension,
        dimensionLabel: e.dimensionLabel,
        score: e.score,
        scoreLabel: e.scoreLabel,
        confidence: e.confidence,
      });
    }
    for (const c of comparisonHistory) {
      push(c.evaluatorId, {
        kind: "comparison",
        id: c.id,
        createdAt: c.createdAt,
        evidenceText: c.evidenceText,
        dimension: c.dimension,
        dimensionLabel: c.dimensionLabel,
        outcome: c.outcome,
        result: c.result,
        otherId: c.otherId,
        otherName: c.otherName,
        confidence: c.confidence,
      });
    }
    const judgeEvidence: JudgeEvidenceGroup[] = [...groups.entries()]
      .map(([judgeId, items]) => ({
        judgeId,
        name: nameOf(state, judgeId),
        status: byId.get(judgeId)?.status ?? null,
        trackRecord: trackOf(judgeId),
        items: items.sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
        ),
      }))
      .sort((a, b) => {
        const left = a.trackRecord.trust ?? Number.NEGATIVE_INFINITY;
        const right = b.trackRecord.trust ?? Number.NEGATIVE_INFINITY;
        return right - left || a.name.localeCompare(b.name);
      });

    // Missing evidence: built only from engine states and the round's required dimensions.
    const missingEvidence: MissingEvidenceItem[] = [];
    const incomingCount = s2?.incomingCount ?? 0;
    if (incomingCount === 0) {
      missingEvidence.push({ kind: "no_referrals", text: "No incoming referrals." });
    } else if (incomingCount === 1) {
      missingEvidence.push({
        kind: "single_source",
        text: "One incoming referral. The Referral Signal rests on a single judge.",
      });
    }
    for (const d of DIMENSIONS) {
      if (!required.has(d)) continue;
      const label = dimensionLabel(d);
      const r = rubric[d];
      if (r.scored + r.notObserved === 0) {
        missingEvidence.push({
          kind: "rubric_missing",
          dimension: d,
          dimensionLabel: label,
          text: `${label}: no rubric evaluation yet.`,
        });
      }
      const dv = dimensions.find((row) => row.dimension === d);
      if (dv && dv.state === "insufficient_evidence") {
        missingEvidence.push({
          kind: "capability_insufficient",
          dimension: d,
          dimensionLabel: label,
          text: `${label}: ${dv.reason ?? "insufficient comparisons"}.`,
        });
      }
    }

    // Who to ask: people with evidence on this candidate but no rubric evaluation on a required dimension.
    const myFeedback = feedbackOf.get(p.id) ?? [];
    const pendingFor = new Set(
      myFeedback.filter((f) => f.respondedAt === null).map((f) => f.memberId),
    );
    const evaluatedRequired = new Map<string, Set<Dimension>>();
    for (const e of myEvaluations) {
      if (!required.has(e.dimension)) continue;
      const set = evaluatedRequired.get(e.evaluatorId) ?? new Set<Dimension>();
      set.add(e.dimension);
      evaluatedRequired.set(e.evaluatorId, set);
    }
    const because = new Map<string, string>();
    for (const r of referralViews) because.set(r.referrerId, "referred them");
    for (const c of comparisonHistory) {
      if (!because.has(c.evaluatorId)) because.set(c.evaluatorId, "compared them");
    }
    for (const e of evaluationViews) {
      if (!because.has(e.evaluatorId)) because.set(e.evaluatorId, "evaluated them");
    }
    const suggestedMembers: SuggestedMember[] = [...because.entries()]
      .filter(([id]) => id !== p.id && id !== OWNER_EVALUATOR_ID && byId.has(id))
      .filter(([id]) => !pendingFor.has(id))
      .filter(([id]) => (evaluatedRequired.get(id)?.size ?? 0) < required.size)
      .map(([id, why]) => ({
        personId: id,
        name: nameOf(state, id),
        trackRecord: trackOf(id),
        because: why,
      }))
      .sort(
        (a, b) =>
          trackRank(a.trackRecord) - trackRank(b.trackRecord) || a.name.localeCompare(b.name),
      );

    const feedback: FeedbackView[] = myFeedback
      .map((f) => ({
        id: f.id,
        candidateId: f.candidateId,
        memberId: f.memberId,
        memberName: nameOf(state, f.memberId),
        trackRecord: trackOf(f.memberId),
        requestedAt: f.requestedAt,
        dueAt: f.dueAt,
        note: f.note,
        state: feedbackState(f, state.now),
        respondedAt: f.respondedAt,
        evaluationId: f.evaluationId,
      }))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.id.localeCompare(b.id));

    const neighbour = (q: Person, referral: Referral | undefined) => ({
      personId: q.id,
      name: q.name,
      status: q.status,
      referralId: referral?.id ?? "",
      strength: referral ? referralStrength(referral, specs.referral_signal) : 0,
    });
    const neighbourhood = {
      referrers: referrersOf(graph, p.id).map((q) =>
        neighbour(
          q,
          referralsNow.find((r) => r.referrerId === q.id && r.candidateId === p.id),
        ),
      ),
      referred: referredBy(graph, p.id).map((q) =>
        neighbour(
          q,
          referralsNow.find((r) => r.referrerId === p.id && r.candidateId === q.id),
        ),
      ),
    };

    return {
      id: p.id,
      name: p.name,
      bio: p.bio ?? "",
      affiliation: p.affiliation ?? "",
      phone: p.phone ?? null,
      linkedin: p.linkedin ?? null,
      resume: p.resume ?? null,
      status: p.status,
      reviewStatus: review,
      persona: personaSet.has(p.id),
      createdAt: p.createdAt,
      daysInReview: daysBetween(p.updatedAt, state.now),
      v0Signal: s0 ? measuredSignal(s0) : null,
      v2Signal: s2 ? measuredSignal(s2) : null,
      incomingCount,
      firsthandCount: s2?.firsthandCount ?? 0,
      strongest: s2?.strongest ?? null,
      contributing: referralViews.filter((r) => r.contributing),
      referrals: referralViews,
      dimensions,
      rubric: rubricRows,
      gaps: gaps
        .filter((g) => g.personId === p.id)
        .map((g) => ({
          personId: g.personId,
          name: p.name,
          dimension: g.dimension,
          dimensionLabel: dimensionLabel(g.dimension),
          gap: g.gap,
          capabilityPercentile: g.capabilityPercentile,
          referralPercentile: g.referralPercentile,
          tag: "exploratory" as const,
        })),
      queue: entry ? { bucket: entry.bucket, flags: entry.flags, reasons: entry.reasons } : null,
      missingEvidence,
      suggestedMembers,
      feedback,
      judgeEvidence,
      evaluations: evaluationViews,
      comparisonHistory,
      neighbourhood,
      networkHint: networkHintFor(
        p.status,
        neighbourhood.referrers,
        entry?.bucket ?? null,
        incomingCount,
      ),
    };
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

export { INTERESTING_GAP };

/* ------------------------------------------------------------------ *
 * Mutations — pure (state, input) → { state, view, error? }
 * ------------------------------------------------------------------ */

export function loadClub(): EngineResult {
  const state = initialState();
  return { state, view: computeView(state) };
}

export function resetClub(): EngineResult {
  return loadClub();
}

function fail(next: ClubState, error: string): EngineResult {
  return { state: next, view: computeView(next), error };
}

function ok(next: ClubState): EngineResult {
  return { state: next, view: computeView(next) };
}

function knownPerson(state: ClubState, id: string): ClubPerson | undefined {
  return state.people.find((p) => p.id === id);
}

function recordSnapshot(next: ClubState, person: ClubPerson, decision: string): void {
  const view = computeView(next);
  const dossier = view.people.find((p) => p.id === person.id);
  const snapshot: ClubSnapshot = {
    id: `snap:${person.id}:${decision}:${next.now}`,
    personId: person.id,
    personName: person.name,
    decision,
    values: {
      referralSignal: dossier?.v2Signal ?? null,
      incomingCount: dossier?.incomingCount ?? 0,
    },
    createdAt: next.now,
  };
  next.snapshots = [snapshot, ...next.snapshots].slice(0, 20);
}

export function addPerson(state: ClubState, input: AddPersonInput): EngineResult {
  const next = reviveState(state);
  const name = input.name.trim();
  if (!name) return fail(next, "name required");
  const status = input.status ?? "candidate";
  const person: ClubPerson = {
    id: nextId("p"),
    name,
    status,
    reviewStatus: defaultReviewStatus(status),
    createdAt: next.now,
    updatedAt: next.now,
  };
  const trimmed = (v: string | undefined) =>
    v !== undefined && v.trim() !== "" ? v.trim() : undefined;
  const bio = trimmed(input.bio);
  const affiliation = trimmed(input.affiliation);
  const phone = trimmed(input.phone);
  const linkedin = trimmed(input.linkedin);
  const resume = trimmed(input.resume);
  if (bio !== undefined) person.bio = bio;
  if (affiliation !== undefined) person.affiliation = affiliation;
  if (phone !== undefined) person.phone = phone;
  if (linkedin !== undefined) person.linkedin = linkedin;
  if (resume !== undefined) person.resume = resume;
  next.people.push(person);
  return ok(next);
}

/**
 * Engine-status change with provenance. Kept for callers that think in
 * candidate / member / archived; the council page uses `decide`.
 */
export function setStatus(state: ClubState, personId: string, status: PersonStatus): EngineResult {
  const next = reviveState(state);
  const person = knownPerson(next, personId);
  if (!person) return fail(next, "unknown person");
  person.status = status;
  const current = person.reviewStatus ?? defaultReviewStatus(status);
  person.reviewStatus =
    status === "candidate" && underConsideration(current) ? current : defaultReviewStatus(status);
  if (status === "candidate" && !underConsideration(current)) person.reviewStatus = "under_review";
  person.updatedAt = next.now;
  recordSnapshot(next, person, status);
  return ok(next);
}

/** Council decision. Review status drives the engine status, never the reverse. */
export function decide(state: ClubState, personId: string, decision: Decision): EngineResult {
  const next = reviveState(state);
  const person = knownPerson(next, personId);
  if (!person) return fail(next, "unknown person");
  const current = person.reviewStatus ?? defaultReviewStatus(person.status);
  const target = nextReviewStatus(current, decision);
  if (target === null) return fail(next, `cannot ${decision.replace("_", " ")} from ${current}`);
  person.reviewStatus = target;
  person.status = statusForReview(target);
  person.updatedAt = next.now;
  recordSnapshot(next, person, target);
  return ok(next);
}

export function addReferral(state: ClubState, input: AddReferralInput): EngineResult {
  const next = reviveState(state);
  for (const id of [input.referrerId, input.candidateId]) {
    if (!knownPerson(next, id)) return fail(next, `unknown person: ${id}`);
  }
  const referral: Referral = {
    id: nextId("ref"),
    referrerId: input.referrerId,
    candidateId: input.candidateId,
    conviction: input.conviction,
    confidence: input.confidence,
    relationshipDepth: input.relationshipDepth,
    evidenceType: input.evidenceType,
    evidenceText: input.evidenceText,
    createdAt: new Date(next.now),
    updatedAt: new Date(next.now),
  };
  const check = validateReferral(referral, next.referrals.map(clubToReferral));
  if (!check.ok) return fail(next, check.errors.join("; "));
  next.referrals.push(referralToClub(referral));
  return ok(next);
}

export function addComparison(state: ClubState, input: AddComparisonInput): EngineResult {
  const next = reviveState(state);
  for (const id of [input.personAId, input.personBId]) {
    if (!knownPerson(next, id)) return fail(next, `unknown person: ${id}`);
  }
  const evaluatorId = input.evaluatorId ?? OWNER_EVALUATOR_ID;
  if (evaluatorId !== OWNER_EVALUATOR_ID && !knownPerson(next, evaluatorId)) {
    return fail(next, `unknown person: ${evaluatorId}`);
  }
  const winnerId =
    input.outcome === "a" ? input.personAId : input.outcome === "b" ? input.personBId : null;
  const informative = input.outcome === "a" || input.outcome === "b" || input.outcome === "tie";
  const comparison: Comparison = {
    id: nextId("cmp"),
    evaluatorId,
    personAId: input.personAId,
    personBId: input.personBId,
    dimension: input.dimension,
    outcome: input.outcome,
    winnerId,
    confidence: informative ? (input.confidence ?? null) : null,
    createdAt: new Date(next.now),
  };
  const note = input.evidenceText?.trim();
  if (note) comparison.evidenceText = note;
  const check = validateComparison(comparison);
  if (!check.ok) return fail(next, check.errors.join("; "));
  next.comparisons.push(comparisonToClub(comparison));
  return ok(next);
}

function buildEvaluation(next: ClubState, input: AddEvaluationInput): ClubEvaluation | string {
  if (!knownPerson(next, input.candidateId)) return `unknown person: ${input.candidateId}`;
  if (input.evaluatorId !== OWNER_EVALUATOR_ID && !knownPerson(next, input.evaluatorId)) {
    return `unknown person: ${input.evaluatorId}`;
  }
  if (input.evaluatorId === input.candidateId) return "evaluator must differ from candidate";
  if (input.evidenceText.trim() === "") return "evidence text must be non-empty";
  if (!isDimension(input.dimension)) return `unknown dimension: ${String(input.dimension)}`;
  const evaluation: Evaluation = {
    id: nextId("eval"),
    evaluatorId: input.evaluatorId,
    candidateId: input.candidateId,
    dimension: input.dimension,
    score: input.score,
    confidence: input.score === null ? null : input.confidence,
    evidenceText: input.evidenceText.trim(),
    createdAt: new Date(next.now),
    updatedAt: new Date(next.now),
  };
  const check = validateEvaluation(evaluation);
  if (!check.ok) return check.errors.join("; ");
  return evaluationToClub(evaluation);
}

/** A rubric observation. Feeds no score; summarised as Structured Evidence. */
export function addEvaluation(state: ClubState, input: AddEvaluationInput): EngineResult {
  const next = reviveState(state);
  const built = buildEvaluation(next, input);
  if (typeof built === "string") return fail(next, built);
  next.evaluations.push(built);
  return ok(next);
}

export function requestFeedback(state: ClubState, input: RequestFeedbackInput): EngineResult {
  const next = reviveState(state);
  const candidate = knownPerson(next, input.candidateId);
  if (!candidate) return fail(next, `unknown person: ${input.candidateId}`);
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return fail(next, "pick at least one member");
  for (const id of memberIds) {
    if (!knownPerson(next, id)) return fail(next, `unknown person: ${id}`);
    if (id === candidate.id) return fail(next, "a candidate cannot review themselves");
    const pending = next.feedbackRequests.some(
      (f) => f.candidateId === candidate.id && f.memberId === id && f.respondedAt === null,
    );
    if (pending) return fail(next, `${nameOf(next, id)} already has a pending request`);
  }
  for (const memberId of memberIds) {
    next.feedbackRequests.push({
      id: nextId("fb"),
      candidateId: candidate.id,
      memberId,
      requestedAt: next.now,
      dueAt: dueAtFor(next.now),
      note: input.note.trim(),
      respondedAt: null,
      evaluationId: null,
    });
  }
  const current = candidate.reviewStatus ?? defaultReviewStatus(candidate.status);
  if (current === "new") {
    candidate.reviewStatus = "under_review";
    candidate.updatedAt = next.now;
  }
  return ok(next);
}

/** A member's answer: a rubric evaluation, which also closes the matching request. */
export function recordFeedback(state: ClubState, input: RecordFeedbackInput): EngineResult {
  const next = reviveState(state);
  const built = buildEvaluation(next, input);
  if (typeof built === "string") return fail(next, built);
  next.evaluations.push(built);
  const pending = next.feedbackRequests
    .filter(
      (f) =>
        f.respondedAt === null &&
        f.candidateId === input.candidateId &&
        f.memberId === input.evaluatorId &&
        (input.requestId === undefined || f.id === input.requestId),
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const target = pending[0];
  if (target) {
    target.respondedAt = next.now;
    target.evaluationId = built.id;
  }
  return ok(next);
}

export function setReviewConfig(state: ClubState, input: SetReviewConfigInput): EngineResult {
  const next = reviveState(state);
  const dims = [...new Set(input.requiredDimensions)];
  if (dims.length === 0) return fail(next, "pick at least one required dimension");
  for (const d of dims) {
    if (!isDimension(d)) return fail(next, `unknown dimension: ${String(d)}`);
  }
  next.config = { requiredDimensions: DIMENSIONS.filter((d) => dims.includes(d)) };
  return ok(next);
}

/** Bucket → people, for callers that want the queue grouped. */
export function queueBuckets(
  view: ClubView,
): Array<{ bucket: ReviewBucket; rows: CandidateRow[] }> {
  const map = new Map<ReviewBucket, CandidateRow[]>();
  for (const row of view.candidates) {
    if (!row.bucket) continue;
    const list = map.get(row.bucket);
    if (list) list.push(row);
    else map.set(row.bucket, [row]);
  }
  return [...map.entries()].map(([bucket, rows]) => ({ bucket, rows }));
}
