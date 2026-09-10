import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Domain *inputs* for a real club. Views are computed by `lib/engine.ts`
 * (which imports `src/`). Do not copy scoring / inference / judge formulas here.
 * Better Auth tables live in the `@convex-dev/better-auth` component.
 */

export const personStatus = v.union(
  v.literal("candidate"),
  v.literal("member"),
  v.literal("archived"),
);

export const scale5 = v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.literal(5));

export const evidenceType = v.union(
  v.literal("firsthand_work"),
  v.literal("firsthand_personal"),
  v.literal("artifact"),
  v.literal("reputation"),
  v.literal("other"),
);

export const dimension = v.union(
  v.literal("problem_solving"),
  v.literal("learning_velocity"),
  v.literal("agency"),
  v.literal("taste"),
  v.literal("output"),
  v.literal("generativity"),
  v.literal("originality"),
);

export const comparisonOutcome = v.union(
  v.literal("a"),
  v.literal("b"),
  v.literal("tie"),
  v.literal("skip"),
  v.literal("insufficient_observation"),
);

const clubPerson = v.object({
  id: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  status: personStatus,
  createdAt: v.string(),
  updatedAt: v.string(),
});

const clubReferral = v.object({
  id: v.string(),
  referrerId: v.string(),
  candidateId: v.string(),
  conviction: scale5,
  confidence: scale5,
  relationshipDepth: scale5,
  evidenceType,
  evidenceText: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const clubComparison = v.object({
  id: v.string(),
  evaluatorId: v.string(),
  personAId: v.string(),
  personBId: v.string(),
  dimension,
  outcome: comparisonOutcome,
  winnerId: v.union(v.string(), v.null()),
  confidence: v.union(scale5, v.null()),
  evidenceText: v.optional(v.string()),
  createdAt: v.string(),
});

const clubEvaluation = v.object({
  id: v.string(),
  evaluatorId: v.string(),
  candidateId: v.string(),
  dimension,
  score: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.null()),
  confidence: v.union(scale5, v.null()),
  evidenceText: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const clubOutcome = v.object({
  id: v.string(),
  personId: v.string(),
  opportunityId: v.union(v.string(), v.null()),
  kind: v.string(),
  value: v.union(v.number(), v.null()),
  observedAt: v.string(),
  createdAt: v.string(),
});

const clubOpportunity = v.object({
  id: v.string(),
  personId: v.string(),
  kind: v.string(),
  description: v.string(),
  startedAt: v.string(),
  endedAt: v.union(v.string(), v.null()),
  createdAt: v.string(),
});

const clubSnapshot = v.object({
  id: v.string(),
  personId: v.string(),
  personName: v.string(),
  decision: v.string(),
  values: v.object({
    // Provenance at accept/archive — not a stored score. Do not add
    // referralSignal to clubPerson / clubOrgs source-of-truth fields.
    referralSignal: v.union(v.number(), v.null()),
    incomingCount: v.number(),
  }),
  createdAt: v.string(),
});

export default defineSchema({
  clubOrgs: defineTable({
    ownerUserId: v.string(),
    name: v.string(),
    now: v.string(),
    people: v.array(clubPerson),
    referrals: v.array(clubReferral),
    comparisons: v.array(clubComparison),
    evaluations: v.array(clubEvaluation),
    outcomes: v.array(clubOutcome),
    opportunities: v.array(clubOpportunity),
    snapshots: v.array(clubSnapshot),
  }).index("by_owner", ["ownerUserId"]),
});
