import type {
  Comparison,
  Evaluation,
  Opportunity,
  Outcome,
  Person,
  Referral,
} from "../../../src/domain/types.ts";
import type {
  ClubComparison,
  ClubEvaluation,
  ClubOpportunity,
  ClubOutcome,
  ClubPerson,
  ClubReferral,
  ClubState,
  IsoDate,
} from "./types.ts";

export const EXAMPLE_T_START = "2026-01-01T00:00:00.000Z";
export const EXAMPLE_T_END = "2026-12-31T00:00:00.000Z";

export function iso(d: Date): IsoDate {
  return d.toISOString();
}

export function asDate(value: IsoDate | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

export function personToClub(p: Person): ClubPerson {
  const row: ClubPerson = {
    id: p.id,
    name: p.name,
    status: p.status,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
  if (p.bio !== undefined) row.bio = p.bio;
  if (p.affiliation !== undefined) row.affiliation = p.affiliation;
  return row;
}

export function referralToClub(r: Referral): ClubReferral {
  return {
    id: r.id,
    referrerId: r.referrerId,
    candidateId: r.candidateId,
    conviction: r.conviction,
    confidence: r.confidence,
    relationshipDepth: r.relationshipDepth,
    evidenceType: r.evidenceType,
    evidenceText: r.evidenceText,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function comparisonToClub(c: Comparison): ClubComparison {
  const row: ClubComparison = {
    id: c.id,
    evaluatorId: c.evaluatorId,
    personAId: c.personAId,
    personBId: c.personBId,
    dimension: c.dimension,
    outcome: c.outcome,
    winnerId: c.winnerId,
    confidence: c.confidence,
    createdAt: iso(c.createdAt),
  };
  if (c.evidenceText !== undefined) row.evidenceText = c.evidenceText;
  return row;
}

export function evaluationToClub(e: Evaluation): ClubEvaluation {
  return {
    id: e.id,
    evaluatorId: e.evaluatorId,
    candidateId: e.candidateId,
    dimension: e.dimension,
    score: e.score,
    confidence: e.confidence,
    evidenceText: e.evidenceText,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  };
}

export function outcomeToClub(o: Outcome): ClubOutcome {
  return {
    id: o.id,
    personId: o.personId,
    opportunityId: o.opportunityId,
    kind: o.kind,
    value: o.value,
    observedAt: iso(o.observedAt),
    createdAt: iso(o.createdAt),
  };
}

export function opportunityToClub(o: Opportunity): ClubOpportunity {
  return {
    id: o.id,
    personId: o.personId,
    kind: o.kind,
    description: o.description,
    startedAt: iso(o.startedAt),
    endedAt: o.endedAt ? iso(o.endedAt) : null,
    createdAt: iso(o.createdAt),
  };
}

export function clubToPerson(p: ClubPerson): Person {
  const row: Person = {
    id: p.id,
    name: p.name,
    status: p.status,
    createdAt: asDate(p.createdAt),
    updatedAt: asDate(p.updatedAt),
  };
  if (p.bio !== undefined) row.bio = p.bio;
  if (p.affiliation !== undefined) row.affiliation = p.affiliation;
  return row;
}

export function clubToReferral(r: ClubReferral): Referral {
  return {
    id: r.id,
    referrerId: r.referrerId,
    candidateId: r.candidateId,
    conviction: r.conviction,
    confidence: r.confidence,
    relationshipDepth: r.relationshipDepth,
    evidenceType: r.evidenceType,
    evidenceText: r.evidenceText,
    createdAt: asDate(r.createdAt),
    updatedAt: asDate(r.updatedAt),
  };
}

export function clubToComparison(c: ClubComparison): Comparison {
  const row: Comparison = {
    id: c.id,
    evaluatorId: c.evaluatorId,
    personAId: c.personAId,
    personBId: c.personBId,
    dimension: c.dimension,
    outcome: c.outcome,
    winnerId: c.winnerId,
    confidence: c.confidence,
    createdAt: asDate(c.createdAt),
  };
  if (c.evidenceText !== undefined) row.evidenceText = c.evidenceText;
  return row;
}

export function clubToEvaluation(e: ClubEvaluation): Evaluation {
  return {
    id: e.id,
    evaluatorId: e.evaluatorId,
    candidateId: e.candidateId,
    dimension: e.dimension,
    score: e.score,
    confidence: e.confidence,
    evidenceText: e.evidenceText,
    createdAt: asDate(e.createdAt),
    updatedAt: asDate(e.updatedAt),
  };
}

export function clubToOutcome(o: ClubOutcome): Outcome {
  return {
    id: o.id,
    personId: o.personId,
    opportunityId: o.opportunityId,
    kind: o.kind,
    value: o.value,
    observedAt: asDate(o.observedAt),
    createdAt: asDate(o.createdAt),
  };
}

export function clubToOpportunity(o: ClubOpportunity): Opportunity {
  return {
    id: o.id,
    personId: o.personId,
    kind: o.kind,
    description: o.description,
    startedAt: asDate(o.startedAt),
    endedAt: o.endedAt ? asDate(o.endedAt) : null,
    createdAt: asDate(o.createdAt),
  };
}

export function reviveState(state: ClubState): ClubState {
  return {
    ...state,
    people: state.people.map((p) => ({ ...p })),
    referrals: state.referrals.map((r) => ({ ...r })),
    comparisons: state.comparisons.map((c) => ({ ...c })),
    evaluations: state.evaluations.map((e) => ({ ...e })),
    outcomes: state.outcomes.map((o) => ({ ...o })),
    opportunities: state.opportunities.map((o) => ({ ...o })),
    snapshots: state.snapshots.map((s) => ({ ...s, values: { ...s.values } })),
  };
}
