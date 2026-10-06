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
  // Set at intake or by an admin; recorded on each evidence snapshot (SEA-81).
  classYear: v.optional(v.number()),
  status: personStatus,
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
  createdAt: v.string(),
  updatedAt: v.string(),
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

export const snapshotKind = v.union(
  v.literal("s0"),
  v.literal("s12"),
  v.literal("s24"),
  v.literal("s36"),
);

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
  // Evidence intake (SEA-81). `personId` is the clubPeople domain id. One row
  // per candidate who entered the process; `intakeAt` is `t` for snapshots.
  evidenceIntakes: defineTable({
    clubId,
    personId: v.string(),
    intakeAt: v.string(),
    // Epoch ms the daily cron next has work for this candidate; null once s36 is written.
    nextDueAt: v.union(v.number(), v.null()),
    // Epoch ms of the last check that completed; a GitHub fetch failure leaves it as it was.
    lastCheckedAt: v.optional(v.number()),
    // Checks started since the last one that completed, and the epoch ms before
    // which the daily cron does not schedule another. Both cleared when a check
    // completes. Backoff only: `nextDueAt` and `lastCheckedAt` stay the due state.
    attempts: v.optional(v.number()),
    retryAfter: v.optional(v.number()),
  })
    .index("by_person", ["personId"])
    .index("by_next_due", ["nextDueAt"])
    .index("by_last_checked", ["lastCheckedAt"]),
  // One row per uploaded resume file. A new upload is a new version; earlier ones stay.
  resumeVersions: defineTable({
    clubId,
    personId: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.string(),
    extractedAt: v.string(),
    // The PDF's text as extracted, kept beside the lines built from it.
    rawText: v.string(),
    // True when the lines needed the Jev labelling pass to parse.
    normalized: v.boolean(),
    lineCount: v.number(),
  })
    .index("by_person", ["personId"])
    .index("by_storage", ["storageId"]),
  // The claim lines of one resume version, one row per line, in order.
  resumeLines: defineTable({
    resumeVersionId: v.id("resumeVersions"),
    index: v.number(),
    lineId: v.string(),
    statement: v.string(),
    publishedAt: v.string(),
  }).index("by_version", ["resumeVersionId", "index"]),
  // Raw `career_evidence` 1.2 JevJudgmentRecords, one per claim. Immutable:
  // never updated; a rerun appends. JSON strings keep the record byte for byte.
  jevJudgments: defineTable({
    clubId,
    personId: v.string(),
    recordId: v.string(),
    evidenceKey: v.string(),
    specId: v.string(),
    kind: v.literal("claim"),
    source: v.string(),
    author: v.union(v.literal("candidate"), v.literal("system")),
    claimId: v.string(),
    // JevJudgmentRecord, OutputOnlyClaim and the answers behind them, as JSON.
    record: v.string(),
    claim: v.string(),
    answer: v.string(),
    probe: v.union(v.string(), v.null()),
    // claim_value@1.2.0 config hash and company seed hash at scoring time, so a
    // later config.yml merge never silently changes what a record was scored under.
    configHash: v.string(),
    companySeedHash: v.string(),
    writtenAt: v.string(),
  })
    .index("by_record", ["recordId"])
    .index("by_person", ["personId"])
    .index("by_person_and_evidence_key", ["personId", "evidenceKey"]),
  evidenceSnapshots: defineTable({
    clubId,
    id: v.string(),
    candidateId: v.string(),
    kind: snapshotKind,
    evidenceCutoff: v.string(),
    computedAt: v.string(),
    substance: v.number(),
    selection: v.union(v.number(), v.null()),
    thin: v.boolean(),
    claimCount: v.number(),
    classYear: v.union(v.number(), v.null()),
    inputHash: v.string(),
    configHash: v.string(),
    correctsSnapshotId: v.optional(v.string()),
  })
    .index("by_candidate_and_kind", ["candidateId", "kind"])
    .index("by_domain_id", ["id"]),
  // Company research requested for an employer (SEA-75 routine), so an org is
  // not asked about again while its research is recent. Results land in
  // grokCompanyResearch and are merged into config.yml by hand.
  companyResearchRequests: defineTable({
    orgKey: v.string(),
    org: v.string(),
    runId: v.string(),
    requestedAt: v.number(),
  }).index("by_org", ["orgKey", "requestedAt"]),
});
