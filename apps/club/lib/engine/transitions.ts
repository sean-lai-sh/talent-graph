/**
 * Mutations — pure (state, input) → { state, view, error? }.
 *
 * Moved here verbatim from `engine.ts`. Every transition revives the stored
 * inputs, validates with the domain validators, and re-runs `computeView` so
 * the caller never sees a state and a view that disagree.
 */

import type { ReviewBucket } from "../../../../src/analysis/reviewQueue.ts";
import { DIMENSIONS } from "../../../../src/domain/constants.ts";
import type {
  Comparison,
  Evaluation,
  PersonStatus,
  Referral,
} from "../../../../src/domain/types.ts";
import {
  isDimension,
  validateComparison,
  validateEvaluation,
  validateReferral,
} from "../../../../src/domain/validate.ts";
import {
  defaultReviewStatus,
  dueAtFor,
  nextReviewStatus,
  statusForReview,
  underConsideration,
} from "../review.ts";
import {
  clubToReferral,
  comparisonToClub,
  evaluationToClub,
  referralToClub,
  reviveState,
} from "../serialize.ts";
import type {
  AddComparisonInput,
  AddEvaluationInput,
  AddPersonInput,
  AddReferralInput,
  CandidateRow,
  ClubEvaluation,
  ClubPerson,
  ClubSnapshot,
  ClubState,
  ClubView,
  Decision,
  EngineResult,
  RecordFeedbackInput,
  RequestFeedbackInput,
  SetReviewConfigInput,
} from "../types.ts";
import { computeView } from "./computeView.ts";
import { nameOf, OWNER_EVALUATOR_ID } from "./shared.ts";

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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
