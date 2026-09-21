/**
 * The per-person dossier. `computeView` decides *what* the round knows; this
 * module turns that shared context into one `PersonView` per person.
 *
 * Moved here verbatim from `engine.ts`'s `state.people.map(...)`: same order,
 * same sorts, same absence rules (a missing signal stays `null`, never 0).
 * Nothing is scored here — every strength is read off the index `computeView`
 * built once in `engine/referralModel.ts`.
 */

import type { ReviewBucket, ReviewEntry } from "../../../../src/analysis/reviewQueue.ts";
import { summarizeEvaluations } from "../../../../src/analysis/rubricSummary.ts";
import type { UnderRecognition } from "../../../../src/analysis/underRecognition.ts";
import type { LoadedSpecs } from "../../../../src/config.ts";
import { DIMENSION_PROMPTS, DIMENSIONS, SCALE_LABELS } from "../../../../src/domain/constants.ts";
import type {
  Comparison,
  Dimension,
  Evaluation,
  Person,
  PersonStatus,
  Referral,
  RubricScore,
} from "../../../../src/domain/types.ts";
import { referredBy, referrersOf } from "../../../../src/graph/referralGraph.ts";
import { type CapabilityRun, dimensionLabel } from "../../../../src/inference/capabilityVector.ts";
import {
  displayReferralSignal,
  type ReferralSignalResult,
} from "../../../../src/scoring/referralSignal.ts";
import type { ScoredReferralGraph } from "../../../../src/scoring/scoredGraph.ts";
import { PERSONA_IDS } from "../../../../src/seed/personas.ts";
import { daysBetween, feedbackState } from "../review.ts";
import type {
  ClubFeedbackRequest,
  ClubPerson,
  ClubState,
  ComparisonResult,
  DimensionView,
  EvidenceItem,
  FeedbackView,
  JudgeEvidenceGroup,
  MissingEvidenceItem,
  NetworkHint,
  PersonView,
  ReferralView,
  ReviewStatus,
  RubricSummaryRow,
  SuggestedMember,
  TrackRecordView,
} from "../types.ts";
import { nameOf, OWNER_EVALUATOR_ID } from "./shared.ts";

const personaSet = new Set<string>(PERSONA_IDS);

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

function rubricAnchor(score: RubricScore | null): string {
  return score === null ? SCALE_LABELS.rubricNotObserved : SCALE_LABELS.rubric[score];
}

function comparisonResult(c: Comparison, personId: string): ComparisonResult {
  if (c.outcome === "tie") return "tie";
  if (c.outcome === "skip") return "skip";
  if (c.outcome === "insufficient_observation") return "not_observed";
  return c.winnerId === personId ? "won" : "lost";
}

/** Everything the round knows, as `computeView` computed it once. */
export interface PersonViewInput {
  state: ClubState;
  specs: LoadedSpecs;
  byId: ReadonlyMap<string, ClubPerson>;
  required: Set<Dimension>;
  comparisons: Comparison[];
  evaluations: Evaluation[];
  /** Unweighted Referral Signal per person id (V0). */
  v0: ReadonlyMap<string, ReferralSignalResult>;
  /** Judge-weighted Referral Signal per person id (V2). */
  v2: ReadonlyMap<string, ReferralSignalResult>;
  scored: ScoredReferralGraph;
  cap: CapabilityRun;
  gaps: UnderRecognition[];
  queue: ReadonlyMap<string, ReviewEntry>;
  reviewOf: (p: ClubPerson) => ReviewStatus;
  trackOf: (id: string) => TrackRecordView;
  trackRank: (t: TrackRecordView) => number;
}

/** One dossier per person, in `state.people` order. */
export function buildPersonViews(input: PersonViewInput): PersonView[] {
  const {
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
  } = input;
  const graph = scored.graph;

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
    // Incoming edges from the shared index: already scored, already in input
    // order, without the per-person scan. Self-referrals are NOT in here —
    // `scoreReferralGraph` drops u → u under V0's incoming rule, the same rule
    // `incomingCount` already applied — and `addReferral` cannot create one
    // (`validateReferral` rejects referrer === candidate), so no reachable
    // state loses a row. Pinned by a hand-built state in club-engine.test.ts.
    const myReferrals = scored.in.get(p.id) ?? [];
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
      .map((edge) => {
        const r = edge.referral;
        const breakdown = s2?.contributing.find((c) => c.referral.id === r.id)?.breakdown;
        return {
          referralId: r.id,
          referrerId: r.referrerId,
          referrerName: nameOf(state, r.referrerId),
          judgeTrackRecord: trackOf(r.referrerId),
          strength: edge.strength,
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

    // Strength comes from the shared index; absence of an edge stays absence
    // (the `""` / 0 placeholder is the pre-existing shape, not a new score).
    const neighbour = (q: Person, referral: Referral | undefined) => ({
      personId: q.id,
      name: q.name,
      status: q.status,
      referralId: referral?.id ?? "",
      strength: referral ? (scored.byReferralId.get(referral.id)?.strength ?? 0) : 0,
    });
    const incomingEdges = graph.in.get(p.id) ?? [];
    const outgoingEdges = graph.out.get(p.id) ?? [];
    const neighbourhood = {
      referrers: referrersOf(graph, p.id).map((q) =>
        neighbour(
          q,
          incomingEdges.find((r) => r.referrerId === q.id),
        ),
      ),
      referred: referredBy(graph, p.id).map((q) =>
        neighbour(
          q,
          outgoingEdges.find((r) => r.candidateId === q.id),
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

  return personViews;
}
