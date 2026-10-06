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

export const reviewStatus = v.union(
  v.literal("new"),
  v.literal("under_review"),
  v.literal("needs_data"),
  v.literal("admitted"),
  v.literal("denied"),
);

export const rubricScore = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
  v.null(),
);

export const clubChannel = v.union(v.literal("inbound"), v.literal("outbound"));

export const referralOrigin = v.union(v.literal("referral"), v.literal("interview"));

export const referralRecognition = v.union(
  v.literal("not_yet"),
  v.literal("soon"),
  v.literal("yes"),
  v.literal("not_sure"),
);

export const callOutcome = v.union(v.literal("yes"), v.literal("maybe"), v.literal("no"));

const clubPersonFields = {
  id: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  // Display metadata for the council page. Never read by src/.
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  resume: v.optional(v.string()),
  resumeStorageId: v.optional(v.string()),
  x: v.optional(v.string()),
  github: v.optional(v.string()),
  website: v.optional(v.string()),
  status: personStatus,
  // How the candidate entered the process. Absent reads as inbound.
  channel: v.optional(clubChannel),
  reviewStatus: v.optional(reviewStatus),
  createdAt: v.string(),
  updatedAt: v.string(),
};

const clubReferralFields = {
  id: v.string(),
  referrerId: v.string(),
  candidateId: v.string(),
  conviction: scale5,
  confidence: scale5,
  relationshipDepth: scale5,
  evidenceType,
  evidenceText: v.string(),
  // Absent reads as "referral". "interview" marks the referral a call's yes creates.
  origin: v.optional(referralOrigin),
  // Stored only; no weight reads it.
  recognition: v.optional(referralRecognition),
  createdAt: v.string(),
  updatedAt: v.string(),
};

// A pre-council call: up to 2 per candidate.
const clubCallFields = {
  id: v.string(),
  candidateId: v.string(),
  callerId: v.string(),
  order: v.union(v.literal(1), v.literal(2)),
  outcome: callOutcome,
  createdAt: v.string(),
};

const clubComparisonFields = {
  id: v.string(),
  evaluatorId: v.string(),
  personAId: v.string(),
  personBId: v.string(),
  dimension,
  outcome: comparisonOutcome,
  winnerId: v.union(v.string(), v.null()),
  confidence: v.union(scale5, v.null()),
  evidenceText: v.optional(v.string()),
  weight: v.optional(v.number()),
  createdAt: v.string(),
};

const clubEvaluationFields = {
  id: v.string(),
  evaluatorId: v.string(),
  candidateId: v.string(),
  dimension,
  score: rubricScore,
  confidence: v.union(scale5, v.null()),
  evidenceText: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
};

const clubOutcomeFields = {
  id: v.string(),
  personId: v.string(),
  opportunityId: v.union(v.string(), v.null()),
  kind: v.string(),
  value: v.union(v.number(), v.null()),
  observedAt: v.string(),
  createdAt: v.string(),
};

const clubOpportunityFields = {
  id: v.string(),
  personId: v.string(),
  kind: v.string(),
  description: v.string(),
  startedAt: v.string(),
  endedAt: v.union(v.string(), v.null()),
  createdAt: v.string(),
};

const clubSnapshotFields = {
  id: v.string(),
  personId: v.string(),
  personName: v.string(),
  decision: v.string(),
  values: v.object({
    // Provenance at accept/archive — not a stored score. Do not add
    // referralSignal to clubPeople source-of-truth fields.
    referralSignal: v.union(v.number(), v.null()),
    incomingCount: v.number(),
  }),
  createdAt: v.string(),
  // Provenance of the pass the decision was taken on, recorded from #55 T5.
  // Optional: `ClubSnapshot` keeps a snapshot without it valid.
  modelRunIds: v.optional(v.array(v.string())),
  specVersions: v.optional(
    v.object({
      referral_signal: v.string(),
      bradley_terry: v.string(),
      judge_reliability: v.string(),
    }),
  ),
  // Person id of the admin who recorded the decision (recusal).
  decidedBy: v.optional(v.string()),
  // Set instead of `decidedBy` when the deciding admin did not resolve to one
  // person: the candidate's referrers who were admins then earn no credit.
  unresolvedDecider: v.optional(v.object({ adminReferrers: v.array(v.string()) })),
  // The council-facing Referral Signal without each referrer at decision time.
  signalWithout: v.optional(
    v.array(v.object({ referrerId: v.string(), signalWithout: v.number() })),
  ),
};

const clubFeedbackRequestFields = {
  id: v.string(),
  candidateId: v.string(),
  memberId: v.string(),
  requestedAt: v.string(),
  dueAt: v.string(),
  note: v.string(),
  respondedAt: v.union(v.string(), v.null()),
  evaluationId: v.union(v.string(), v.null()),
};

const clubReviewConfig = v.object({
  requiredDimensions: v.array(dimension),
});

export const clubRole = v.union(v.literal("admin"), v.literal("member"));

const clubId = v.id("clubs");

export default defineSchema({
  clubAccounts: defineTable({
    userId: v.string(),
    email: v.string(),
    role: clubRole,
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"]),
  // One club per deployment: the oldest row (`lib/clubStore.ts`). Each engine
  // record below is its own row with `clubId` and the engine's domain `id`;
  // `lib/clubStore.ts` rebuilds `ClubState` and writes back only changes.
  clubs: defineTable({
    name: v.string(),
    now: v.string(),
    config: clubReviewConfig,
    createdByUserId: v.string(),
  }),
  clubPeople: defineTable({ clubId, ...clubPersonFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"])
    .index("by_club_and_email", ["clubId", "email"])
    .index("by_club_and_phone", ["clubId", "phone"])
    .index("by_club_and_status", ["clubId", "status"]),
  clubReferrals: defineTable({ clubId, ...clubReferralFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubCalls: defineTable({ clubId, ...clubCallFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubComparisons: defineTable({ clubId, ...clubComparisonFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubEvaluations: defineTable({ clubId, ...clubEvaluationFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubOutcomes: defineTable({ clubId, ...clubOutcomeFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubOpportunities: defineTable({ clubId, ...clubOpportunityFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubSnapshots: defineTable({ clubId, ...clubSnapshotFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubFeedbackRequests: defineTable({ clubId, ...clubFeedbackRequestFields })
    .index("by_club", ["clubId"])
    .index("by_club_and_domain_id", ["clubId", "id"]),
  clubPosts: defineTable({
    clubId,
    body: v.string(),
    authorName: v.string(),
    authorUserId: v.string(),
    createdAt: v.string(),
  }).index("by_club_and_created", ["clubId", "createdAt"]),
  // Contact → person, so signup checks a contact without loading every person.
  referralContacts: defineTable({
    clubId,
    normalizedContact: v.string(),
    kind: v.union(v.literal("email"), v.literal("phone")),
    personId: v.string(),
  }).index("by_club_and_contact", ["clubId", "normalizedContact"]),
  memberReferrals: defineTable({
    clubId,
    referrerUserId: v.string(),
    normalizedContact: v.string(),
    personId: v.string(),
    createdAt: v.string(),
    tokenHash: v.string(),
  })
    .index("by_club_referrer_and_contact", ["clubId", "referrerUserId", "normalizedContact"])
    .index("by_token_hash", ["tokenHash"]),
  // One row per issued upload URL. `storageId` is set when the uploader registers the file.
  referralUploads: defineTable({
    uploaderUserId: v.string(),
    createdAt: v.number(),
    storageId: v.optional(v.id("_storage")),
    usedAt: v.optional(v.number()),
  })
    .index("by_uploader", ["uploaderUserId", "createdAt"])
    .index("by_storage", ["storageId"]),
  // Raw Grok company-research replies (SEA-75), one per runId. The script validates them.
  grokCompanyResearch: defineTable({
    runId: v.string(),
    body: v.string(),
    receivedAt: v.number(),
  }).index("by_run", ["runId"]),
});
