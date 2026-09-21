import { describe, expect, test } from "bun:test";
import {
  buildGrokRoutineRequest,
  signGrokCallbackBody,
} from "../apps/club/lib/longitudinal/grok.ts";
import { createJevJudgmentService, LEVELS } from "../apps/club/lib/longitudinal/jev.ts";
import {
  createInMemoryGrokIngestStore,
  fetchGitHubEvidence,
  fetchOrcidEvidence,
  ingestGrokEvidenceCallback,
} from "../apps/club/lib/longitudinal/sources.ts";
import type { Opportunity, Outcome } from "../src/domain/types.ts";
import type {
  CanonicalIdentity,
  CareerEvent,
  ClaimAssessment,
  GrokEvidenceItem,
  GrokEvidencePacket,
  IdentityAssessment,
  JevAnswer,
  JevJudgmentRecord,
  JevJudgmentService,
} from "../src/index.ts";
import {
  aggregateScoutInformationGain,
  batchDueMonitoringPlans,
  CAREER_EVIDENCE_V1_0_0,
  careerEventsToLongitudinalRecords,
  careerEvidenceSpecId,
  checkpointJobKey,
  contentFingerprint,
  createMonitoringPlan,
  DEFAULT_EVIDENCE_CONCURRENCY,
  DEFAULT_MAX_MONITORING_ATTEMPTS,
  DEFAULT_MONITORING_LEASE_MS,
  evaluateLongitudinalCases,
  evidenceKeyFor,
  failMonitoringPlan,
  freezeRecord,
  MAX_MONITORING_ATTEMPTS_ERROR,
  processEvidence,
  progressVector,
  residualSlope,
  runDueMonitoringPlans,
  scoutHitGain,
  startMonitoringPlan,
  validateGrokEvidencePacket,
} from "../src/index.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import type { ProgressDimension } from "../src/longitudinal/types.ts";
import { JUDGE_RELIABILITY_V2_0_0 } from "../src/models/registry.ts";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

const identity: CanonicalIdentity = {
  personId: "p-1",
  name: "Avery Chen",
  aliases: [],
  externalIdentities: [
    {
      source: "github",
      externalId: "avery",
      url: "https://github.com/avery",
      verifiedAt: day(0),
    },
  ],
  createdAt: day(0),
  updatedAt: day(0),
};

function evidence(id: string, observedDay: number): GrokEvidenceItem {
  return {
    source: "github",
    sourceId: id,
    url: `https://github.com/avery/${id}`,
    publisher: "avery",
    publishedAt: day(observedDay).toISOString(),
    quotedText: `Released ${id} with implementation details.`,
    contentHash: contentFingerprint(id),
    statement: `Avery released ${id}.`,
    proposedEventKind: "open_source_contribution",
  };
}

/**
 * The judgment service the pipeline now expects: an assessment *and* the
 * record it was projected from. The assessments are still the ones the cases
 * below state — the assertions pin those numbers — and the record is the
 * observation they would have come from, so nothing here is a second source
 * of truth for a number.
 */
interface FakeJudgments {
  assessIdentity(
    identity: CanonicalIdentity,
    evidence: GrokEvidenceItem,
  ): Promise<IdentityAssessment>;
  assessClaim(evidence: GrokEvidenceItem): Promise<ClaimAssessment>;
}

const LEVEL_COUNT = 5;

function identityAnswers(assessment: IdentityAssessment): Record<string, JevAnswer> {
  return {
    decision: {
      choice: assessment.decision,
      confidence: assessment.confidence,
      probabilities: { [assessment.decision]: assessment.confidence },
    },
    same_name: { noul: assessment.fieldMatches.name },
    same_affiliation: { noul: assessment.fieldMatches.affiliation },
    same_handle: { noul: assessment.fieldMatches.handle },
  };
}

function claimAnswers(assessment: ClaimAssessment): Record<string, JevAnswer> {
  const kind = assessment.eventKind ?? "no_supported_event";
  const answers: Record<string, JevAnswer> = {
    event_kind: {
      choice: kind,
      confidence: assessment.eventConfidence,
      probabilities: { [kind]: assessment.eventConfidence },
    },
  };
  for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
    const judgment = assessment.dimensions.find((entry) => entry.dimension === dimension);
    answers[dimension] = {
      score: judgment?.score ?? 0,
      confidence: judgment?.confidence ?? 0,
      probabilities:
        judgment?.probabilities ??
        Array.from({ length: LEVEL_COUNT }, (_value, i) => (i === 0 ? 1 : 0)),
      legend: [...CAREER_EVIDENCE_V1_0_0.levels[dimension]],
    };
  }
  return answers;
}

function fakeRecord(
  kind: JevJudgmentRecord["kind"],
  personId: string,
  evidence: GrokEvidenceItem,
  answers: Record<string, JevAnswer>,
): JevJudgmentRecord {
  const fingerprint = contentFingerprint({ kind, personId, sourceId: evidence.sourceId });
  return freezeRecord({
    id: `jev-${fingerprint}`,
    kind,
    personId,
    evidenceKey: evidenceKeyFor(personId, evidence),
    requestFingerprint: fingerprint,
    specId: careerEvidenceSpecId(CAREER_EVIDENCE_V1_0_0),
    requestedModel: CAREER_EVIDENCE_V1_0_0.model,
    respondedModel: `${CAREER_EVIDENCE_V1_0_0.model}-test`,
    requestId: null,
    answers,
    usage: { inputTokens: 100, outputTokens: 20 },
    observedAt: new Date(0),
  });
}

/** Wrap assessment-only fakes in the record-returning service interface. */
function serviceOf(fake: FakeJudgments): JevJudgmentService {
  return {
    identityFingerprint: (identity, evidence) =>
      contentFingerprint({
        kind: "identity",
        personId: identity.personId,
        sourceId: evidence.sourceId,
      }),
    claimFingerprint: (evidence) =>
      contentFingerprint({ kind: "claim", sourceId: evidence.sourceId }),
    async assessIdentity(identity, evidence) {
      const assessment = await fake.assessIdentity(identity, evidence);
      return {
        assessment,
        record: fakeRecord("identity", identity.personId, evidence, identityAnswers(assessment)),
      };
    },
    async assessClaim(evidence, personId) {
      const assessment = await fake.assessClaim(evidence);
      return {
        assessment,
        record: fakeRecord("claim", personId, evidence, claimAnswers(assessment)),
      };
    },
  };
}

const acceptingJudgments: FakeJudgments = {
  async assessIdentity() {
    return {
      decision: "same",
      confidence: 0.98,
      fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
    };
  },
  async assessClaim() {
    return {
      eventKind: "open_source_contribution",
      eventConfidence: 0.92,
      dimensions: [
        { dimension: "difficulty", score: 3, probabilities: [0, 0, 0.2, 0.8, 0], confidence: 0.8 },
        { dimension: "ownership", score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 1 },
        {
          dimension: "external_impact",
          score: 2,
          probabilities: [0, 0, 1, 0, 0],
          confidence: 1,
        },
        { dimension: "originality", score: 3, probabilities: [0, 0, 0, 1, 0], confidence: 1 },
        {
          dimension: "peer_validation",
          score: 2,
          probabilities: [0, 0, 1, 0, 0],
          confidence: 1,
        },
      ],
    };
  },
};

describe("longitudinal source ingestion", () => {
  test("Grok callbacks require a signature, stored run binding, and durable dedupe", async () => {
    const packet: GrokEvidencePacket = {
      schemaVersion: "1",
      personId: "p-1",
      runId: "run-1",
      retrievedAt: day(100).toISOString(),
      cutoffAt: day(90).toISOString(),
      items: [evidence("late", 91)],
    };
    expect(validateGrokEvidencePacket(packet)).toEqual({
      ok: false,
      errors: ["items[0].publishedAt exceeds cutoffAt"],
    });

    const valid: GrokEvidencePacket = {
      ...packet,
      items: [evidence("valid", 80), evidence("valid", 80)],
    };
    const rawBody = JSON.stringify(valid);
    const signingSecret = "per-run-test-secret";
    const expected = {
      personId: "p-1",
      runId: "default-store",
      cutoffAt: day(90),
      signingSecret,
    };
    const boundPacket = JSON.stringify({ ...valid, runId: expected.runId });
    const signature = signGrokCallbackBody(boundPacket, signingSecret);
    const store = createInMemoryGrokIngestStore();
    expect(await ingestGrokEvidenceCallback(boundPacket, signature, expected, store)).toHaveLength(
      1,
    );
    expect(await ingestGrokEvidenceCallback(boundPacket, signature, expected, store)).toHaveLength(
      0,
    );
    await expect(
      ingestGrokEvidenceCallback(boundPacket, "sha256=bad", expected, store),
    ).rejects.toThrow("invalid Grok callback signature");
    await expect(
      ingestGrokEvidenceCallback(
        rawBody,
        signGrokCallbackBody(rawBody, signingSecret),
        expected,
        createInMemoryGrokIngestStore(),
      ),
    ).rejects.toThrow("Grok callback run mismatch");
  });

  test("GitHub adapter retains only evidence inside the requested window", async () => {
    const calls: string[] = [];
    const fetched = await fetchGitHubEvidence("avery", day(0), day(90), async (url) => {
      calls.push(url);
      if (url.includes("/repos?")) {
        return [
          {
            full_name: "avery/new-work",
            html_url: "https://github.com/avery/new-work",
            created_at: day(50).toISOString(),
            description: "A difficult compiler.",
            fork: false,
          },
          {
            full_name: "avery/too-new",
            html_url: "https://github.com/avery/too-new",
            created_at: day(95).toISOString(),
            description: "After cutoff.",
            fork: false,
          },
          {
            full_name: "avery/old-fork",
            html_url: "https://github.com/avery/old-fork",
            created_at: day(50).toISOString(),
            updated_at: day(60).toISOString(),
            description: "Not authored work.",
            fork: true,
          },
        ];
      }
      return [
        {
          id: "event-1",
          type: "ReleaseEvent",
          created_at: day(60).toISOString(),
          repo: { name: "avery/new-work" },
        },
        {
          id: "event-2",
          type: "WatchEvent",
          created_at: day(61).toISOString(),
          repo: { name: "avery/someone-elses-work" },
        },
      ];
    });
    expect(calls).toHaveLength(2);
    expect(fetched.map((item) => item.sourceId)).toEqual(["repo:avery/new-work", "event:event-1"]);
  });

  test("ORCID adapter rejects incomplete publication dates", async () => {
    const fetched = await fetchOrcidEvidence(
      "0000-0000-0000-0001",
      day(0),
      day(180),
      "token",
      async () => ({
        group: [
          {
            "work-summary": [
              {
                "put-code": 1,
                title: { title: { value: "Year only" } },
                "publication-date": { year: { value: "2026" } },
              },
              {
                "put-code": 2,
                title: { title: { value: "Fully dated work" } },
                "publication-date": {
                  year: { value: "2026" },
                  month: { value: "03" },
                  day: { value: "01" },
                },
                url: { value: "https://example.com/work" },
              },
            ],
          },
        ],
      }),
    );
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.sourceId).toBe("work:2");
    expect(fetched[0]?.url).toBe("https://example.com/work");
  });

  test("Grok routine request is bounded to person, identities, and cutoff", () => {
    const request = buildGrokRoutineRequest({
      runId: "run-1",
      identity,
      from: day(0),
      cutoffAt: day(90),
      callbackUrl: "https://example.com/api/evidence",
      callbackSigningSecret: "per-run-secret",
    });
    expect(request.runId).toBe("run-1");
    expect(request.person.knownIdentities[0]?.externalId).toBe("avery");
    expect(request.cutoffAt).toBe(day(90).toISOString());
    expect(request.instructions).toContain("Exclude evidence after cutoffAt");
  });
});

describe("Jev judgments and evidence policy", () => {
  test("TypeSafe adapter maps Jev typed answers into identity and progress judgments", async () => {
    let requestCount = 0;
    const legendFor = (dimension: ProgressDimension) =>
      Object.fromEntries(CAREER_EVIDENCE_V1_0_0.levels[dimension].map((t, i) => [i, t]));
    const client = {
      systemOne(request: { questions: Record<string, unknown> }) {
        requestCount++;
        const data =
          "decision" in request.questions
            ? {
                model: "jev-test",
                usage: { input_tokens: 11, output_tokens: 3 },
                answers: {
                  decision: { choice: "same", confidence: 0.91, probabilities: { same: 0.91 } },
                  same_name: { noul: 0.95 },
                  same_affiliation: { noul: 0.8 },
                  same_handle: { noul: 1 },
                },
              }
            : {
                model: "jev-test",
                usage: { input_tokens: 42, output_tokens: 7 },
                answers: {
                  event_kind: {
                    choice: "shipped_product",
                    confidence: 0.88,
                    probabilities: { shipped_product: 0.88 },
                  },
                  difficulty: {
                    score: 3,
                    probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 },
                    confidence: 0.8,
                    legend: legendFor("difficulty"),
                  },
                  ownership: {
                    score: 3,
                    probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 },
                    confidence: 0.8,
                    legend: legendFor("ownership"),
                  },
                  external_impact: {
                    score: 2,
                    probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
                    confidence: 1,
                    legend: legendFor("external_impact"),
                  },
                  originality: {
                    score: 3,
                    probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 },
                    confidence: 1,
                    legend: legendFor("originality"),
                  },
                  peer_validation: {
                    score: 2,
                    probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
                    confidence: 1,
                    legend: legendFor("peer_validation"),
                  },
                },
              };
        return {
          async withResponse() {
            return { data, response: new Response(null), requestId: "req-1" };
          },
        };
      },
    } as unknown as Parameters<typeof createJevJudgmentService>[0];
    const service = createJevJudgmentService(client);
    const judged = await service.assessIdentity(identity, evidence("x", 30));
    expect(judged.assessment.decision).toBe("same");
    // The record is the observation the assessment was projected from.
    expect(judged.record.kind).toBe("identity");
    expect(judged.record.respondedModel).toBe("jev-test");
    expect(judged.record.requestId).toBe("req-1");
    expect(judged.record.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    const claim = await service.assessClaim(evidence("x", 30), identity.personId);
    expect(claim.assessment.eventKind).toBe("shipped_product");
    expect(claim.assessment.dimensions).toHaveLength(5);
    expect(claim.record.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(requestCount).toBe(2);
  });

  test("an ambiguous identity stops before assessClaim is ever called", async () => {
    let assessClaimCalls = 0;
    const ambiguous: FakeJudgments = {
      async assessIdentity() {
        return {
          decision: "review",
          confidence: 0.55,
          fieldMatches: { name: 0.6, affiliation: 0.5, handle: 0.4 },
        };
      },
      async assessClaim(item) {
        assessClaimCalls++;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(ambiguous),
    });
    expect(assessClaimCalls).toBe(0);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.identityDecision).toBe("review");
    expect(result.claims[0]?.reviewReasons).toContain("identity_ambiguous");
    expect(result.claims[0]?.assessedEventKind).toBe(null);
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    expect(result.events).toHaveLength(0);
    expect(result.needsReview).toBe(true);
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);
  });

  test("an assessed claim keeps Grok's proposed kind apart from Jev's assessed kind", async () => {
    const disagreeing: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        const accepted = await acceptingJudgments.assessClaim(evidence("work", 40));
        return { ...accepted, eventKind: "shipped_product" as const };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(disagreeing),
    });
    expect(result.claims[0]?.status).toBe("accepted");
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    expect(result.claims[0]?.assessedEventKind).toBe("shipped_product");
    // The event is built from the assessed kind, not the proposed one.
    expect(result.events[0]?.kind).toBe("shipped_product");
  });

  test("an identity-rejected claim carries no assessed kind and keeps Grok's", async () => {
    let assessClaimCalls = 0;
    const different: FakeJudgments = {
      async assessIdentity() {
        return {
          decision: "different",
          confidence: 0.97,
          fieldMatches: { name: 0.1, affiliation: 0.1, handle: 0.05 },
        };
      },
      async assessClaim(item) {
        assessClaimCalls++;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(different),
    });
    expect(assessClaimCalls).toBe(0);
    expect(result.claims[0]?.status).toBe("rejected");
    expect(result.claims[0]?.assessedEventKind).toBe(null);
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    // A rejected claim is not under review, so it carries no reasons.
    expect("reviewReasons" in (result.claims[0] ?? {})).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(result.needsReview).toBe(false);
  });

  test("a same-person decision below the confidence threshold stops before assessment", async () => {
    let assessClaimCalls = 0;
    const unsure: FakeJudgments = {
      async assessIdentity() {
        return {
          decision: "same",
          confidence: 0.6,
          fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
        };
      },
      async assessClaim(item) {
        assessClaimCalls++;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(unsure),
    });
    expect(assessClaimCalls).toBe(0);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.reviewReasons).toEqual(["identity_low_confidence"]);
    expect(result.claims[0]?.assessedEventKind).toBe(null);
    expect(result.events).toHaveLength(0);
  });

  test("an event with no dimension judgments records why it went to review", async () => {
    // Routing to review is already covered by the incomplete-judgment gate; what
    // this pins is that the empty case is labelled, not silently lumped in with
    // a partial or out-of-range judgment set.
    const unjudged: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        const accepted = await acceptingJudgments.assessClaim(evidence("work", 40));
        return { ...accepted, dimensions: [] };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(unjudged),
    });
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.reviewReasons).toEqual(["no_dimensions"]);
    expect(result.needsReview).toBe(true);
    const outcomes = careerEventsToLongitudinalRecords(result.events).outcomes;
    expect(outcomes).toEqual([]);
  });

  test("claims that are not routed to review carry no reviewReasons field", async () => {
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(acceptingJudgments),
    });
    expect(result.claims[0]?.status).toBe("accepted");
    expect("reviewReasons" in (result.claims[0] ?? {})).toBe(false);
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    expect(result.claims[0]?.assessedEventKind).toBe("open_source_contribution");
  });

  test("missing dimensions route to review and never become a zero outcome", async () => {
    const missingDimensions: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        return {
          eventKind: "shipped_product",
          eventConfidence: 0.99,
          dimensions: [],
        };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(missingDimensions),
    });
    expect(result.claims[0]?.status).toBe("review");
    expect(result.events[0]?.status).toBe("review");
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);

    const malformedAccepted = { ...event("malformed", "p-1", 40, 2), judgments: [] };
    expect(careerEventsToLongitudinalRecords([malformedAccepted]).outcomes).toEqual([]);
  });
});

describe("checkpoint scheduling", () => {
  test("freezes 90/180-day horizons and groups all due cases by person", () => {
    const p90 = createMonitoringPlan({
      id: "m-90",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const p180 = createMonitoringPlan({
      id: "m-180",
      personId: "p-1",
      caseId: "c-2",
      submittedAt: day(5),
      caseOpenedAt: day(0),
      horizonDays: 180,
      pipelineVersion: "1",
    });
    expect(p90.dueAt).toEqual(day(90));
    expect(p180.dueAt).toEqual(day(185));
    expect(checkpointJobKey(p90)).toContain("m-90:2026-04-01");
    const batches = batchDueMonitoringPlans([p90, p180], day(200));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.plans).toHaveLength(2);
    expect(batches[0]?.cutoffAt).toEqual(day(185));
  });

  test("one person fetch serves staggered checkpoints without cutoff leakage", async () => {
    const plans = [
      createMonitoringPlan({
        id: "early",
        personId: "p-1",
        caseId: "c-1",
        caseOpenedAt: day(0),
        horizonDays: 90,
        pipelineVersion: "1",
      }),
      createMonitoringPlan({
        id: "late",
        personId: "p-1",
        caseId: "c-2",
        caseOpenedAt: day(0),
        horizonDays: 180,
        pipelineVersion: "1",
      }),
    ];
    let fetches = 0;
    const run = await runDueMonitoringPlans({
      plans,
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          fetches++;
          return [evidence("early-event", 80), evidence("late-event", 120)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(1);
    expect(run.fetchCount).toBe(1);
    expect(run.results.find((result) => result.planId === "early")?.result.events).toHaveLength(1);
    expect(run.results.find((result) => result.planId === "late")?.result.events).toHaveLength(2);
    expect(run.plans.every((plan) => plan.status === "completed")).toBe(true);
  });

  test("failed due plans re-enter the next collection batch", () => {
    const pending = createMonitoringPlan({
      id: "m-90",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const failed = failMonitoringPlan(pending, "collector timeout", day(100));
    const batches = batchDueMonitoringPlans([failed], day(200));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.plans).toHaveLength(1);
    expect(batches[0]?.plans[0]?.status).toBe("failed");
  });

  test("running plans retry only after their lease expires", () => {
    const pending = createMonitoringPlan({
      id: "leased",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const attemptedAt = day(100);
    const running = startMonitoringPlan(pending, attemptedAt);
    expect(
      batchDueMonitoringPlans(
        [running],
        new Date(attemptedAt.getTime() + DEFAULT_MONITORING_LEASE_MS - 1),
      ),
    ).toHaveLength(0);
    expect(
      batchDueMonitoringPlans(
        [running],
        new Date(attemptedAt.getTime() + DEFAULT_MONITORING_LEASE_MS),
      ),
    ).toHaveLength(1);
  });

  test("shared fetch still filters each plan to its own baseline window", async () => {
    const early = createMonitoringPlan({
      id: "early",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const late = createMonitoringPlan({
      id: "late",
      personId: "p-1",
      caseId: "c-2",
      submittedAt: day(30),
      caseOpenedAt: day(0),
      horizonDays: 180,
      pipelineVersion: "1",
    });
    let fetches = 0;
    const run = await runDueMonitoringPlans({
      plans: [early, late],
      identities: new Map([["p-1", identity]]),
      now: day(220),
      collector: {
        async collect() {
          fetches++;
          return [
            evidence("pre-late-baseline", 10),
            evidence("shared", 80),
            evidence("late-only", 120),
          ];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(1);
    expect(
      run.results
        .find((result) => result.planId === "early")
        ?.result.events.map((event) => event.title),
    ).toEqual(["Avery released pre-late-baseline.", "Avery released shared."]);
    expect(
      run.results
        .find((result) => result.planId === "late")
        ?.result.events.map((event) => event.title),
    ).toEqual(["Avery released shared.", "Avery released late-only."]);
  });

  test("a recovered collector retries a previously failed plan", async () => {
    const plan = failMonitoringPlan(
      createMonitoringPlan({
        id: "retry",
        personId: "p-1",
        caseId: "c-1",
        caseOpenedAt: day(0),
        horizonDays: 90,
        pipelineVersion: "1",
      }),
      "github 503",
      day(100),
    );
    const run = await runDueMonitoringPlans({
      plans: [plan],
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          return [evidence("recovered", 40)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(run.plans[0]?.status).toBe("completed");
    expect(run.plans[0]?.attemptCount).toBe(1);
    expect(run.results[0]?.result.events).toHaveLength(1);
  });
});

describe("bounded judgment fan-out", () => {
  // Ten items, each judgment call held open long enough for the counter below
  // to observe a pool that let more than its cap through. The hold is a
  // deterministic per-item delay that *decreases* with the item's position, so
  // later items finish before earlier ones and a pool that appended results in
  // completion order would scramble them.
  const tenItems = Array.from({ length: 10 }, (_, index) => evidence(`item-${index}`, index + 1));
  const holdMs = (sourceId: string) => tenItems.length - Number(sourceId.split("-")[1]);

  function instrumented(): { service: JevJudgmentService; peak: () => number } {
    let inFlight = 0;
    let peak = 0;
    const hold = async (sourceId: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, holdMs(sourceId)));
      inFlight -= 1;
    };
    return {
      peak: () => peak,
      service: serviceOf({
        async assessIdentity(canonical, item) {
          await hold(item.sourceId);
          return acceptingJudgments.assessIdentity(canonical, item);
        },
        async assessClaim(item) {
          await hold(item.sourceId);
          return acceptingJudgments.assessClaim(item);
        },
      }),
    };
  }

  const run = (judgments: JevJudgmentService, concurrency?: number) =>
    processEvidence({
      identity,
      evidence: tenItems,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      ...(concurrency === undefined ? {} : { runtime: { concurrency } }),
    });

  test("concurrency 2 keeps at most two judgment calls in flight and preserves order", async () => {
    const capped = instrumented();
    const unbounded = instrumented();
    const bounded = await run(capped.service, 2);
    const wide = await run(unbounded.service, tenItems.length);
    expect(capped.peak()).toBe(2);
    expect(unbounded.peak()).toBe(tenItems.length);
    expect(bounded.claims).toEqual(wide.claims);
    expect(bounded.events).toEqual(wide.events);
    expect(bounded.snapshot).toEqual(wide.snapshot);
    expect(bounded.claims.map((claim) => claim.provenance.sourceId)).toEqual(
      tenItems.map((item) => item.sourceId),
    );
  });

  test("the default concurrency is four", async () => {
    const fake = instrumented();
    const result = await run(fake.service);
    expect(DEFAULT_EVIDENCE_CONCURRENCY).toBe(4);
    expect(fake.peak()).toBe(4);
    expect(result.claims).toHaveLength(tenItems.length);
  });

  test("concurrency must be an integer of at least one", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(run(serviceOf(acceptingJudgments), bad)).rejects.toThrow(/integer >= 1/);
    }
  });

  test("one failing identity call still rejects the whole call", async () => {
    const failing: FakeJudgments = {
      ...acceptingJudgments,
      async assessIdentity(canonical, item) {
        if (item.sourceId === "item-7") throw new Error("jev identity 500");
        return acceptingJudgments.assessIdentity(canonical, item);
      },
    };
    await expect(run(serviceOf(failing), 2)).rejects.toThrow("jev identity 500");
  });

  test("one failing item still rejects the whole call", async () => {
    const failing: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim(item) {
        if (item.sourceId === "item-7") throw new Error("jev 500");
        return acceptingJudgments.assessClaim(item);
      },
    };
    await expect(run(serviceOf(failing), 2)).rejects.toThrow("jev 500");
  });
});

describe("monitoring attempt cap", () => {
  const plan = () =>
    createMonitoringPlan({
      id: "capped",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });

  const burnAttempts = (count: number) => {
    let current = plan();
    for (let attempt = 0; attempt < count; attempt++) {
      current = failMonitoringPlan(
        startMonitoringPlan(current, day(100 + attempt)),
        "github 503",
        day(100 + attempt),
      );
    }
    return current;
  };

  test("a plan below the cap is still readmitted and retried", () => {
    const belowCap = burnAttempts(DEFAULT_MAX_MONITORING_ATTEMPTS - 1);
    expect(belowCap.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS - 1);
    expect(batchDueMonitoringPlans([belowCap], day(200))).toHaveLength(1);
    expect(startMonitoringPlan(belowCap, day(200)).status).toBe("running");
  });

  test("a plan at the cap is not readmitted and never runs again", async () => {
    const exhausted = burnAttempts(DEFAULT_MAX_MONITORING_ATTEMPTS);
    expect(exhausted.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
    expect(batchDueMonitoringPlans([exhausted], day(200))).toEqual([]);
    // Already failed: it keeps the error that spent its last attempt.
    expect(startMonitoringPlan(exhausted, day(200))).toEqual(exhausted);
    expect(exhausted.status).toBe("failed");

    let fetches = 0;
    const sweep = await runDueMonitoringPlans({
      plans: [exhausted],
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          fetches++;
          return [evidence("recovered", 40)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(0);
    expect(sweep.plans[0]).toEqual(exhausted);
    expect(sweep.results).toEqual([]);
  });

  test("a stale running lease at the cap settles as failed instead of looping", () => {
    let current = plan();
    for (let attempt = 0; attempt < DEFAULT_MAX_MONITORING_ATTEMPTS - 1; attempt++) {
      current = failMonitoringPlan(
        startMonitoringPlan(current, day(100 + attempt)),
        "github 503",
        day(100 + attempt),
      );
    }
    const stranded = startMonitoringPlan(current, day(150));
    expect(stranded.status).toBe("running");
    expect(stranded.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
    const afterLease = new Date(day(150).getTime() + DEFAULT_MONITORING_LEASE_MS);
    expect(batchDueMonitoringPlans([stranded], afterLease)).toEqual([]);
    const settled = startMonitoringPlan(stranded, afterLease);
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe(MAX_MONITORING_ATTEMPTS_ERROR);
    expect(settled.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
  });

  test("the sweep terminalizes a plan stranded running at the cap", async () => {
    // A worker that died after the last allowed start leaves the plan
    // `running` at the cap. The batch will never readmit it, so the sweep must
    // settle it itself or it stays `running` forever.
    let current = plan();
    for (let attempt = 0; attempt < DEFAULT_MAX_MONITORING_ATTEMPTS - 1; attempt++) {
      current = failMonitoringPlan(
        startMonitoringPlan(current, day(100 + attempt)),
        "github 503",
        day(100 + attempt),
      );
    }
    const stranded = startMonitoringPlan(current, day(150));
    expect(stranded.status).toBe("running");
    expect(stranded.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);

    let fetches = 0;
    const sweep = await runDueMonitoringPlans({
      plans: [stranded],
      identities: new Map([["p-1", identity]]),
      now: new Date(day(150).getTime() + DEFAULT_MONITORING_LEASE_MS * 10),
      collector: {
        async collect() {
          fetches++;
          return [evidence("recovered", 40)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(0);
    expect(sweep.fetchCount).toBe(0);
    expect(sweep.plans[0]?.status).toBe("failed");
    expect(sweep.plans[0]?.error).toBe(MAX_MONITORING_ATTEMPTS_ERROR);
    expect(sweep.plans[0]?.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
    expect(sweep.results).toEqual([]);
  });

  test("an explicit lower cap stops a plan sooner", () => {
    const once = burnAttempts(1);
    expect(batchDueMonitoringPlans([once], day(200), DEFAULT_MONITORING_LEASE_MS, 1)).toEqual([]);
    expect(startMonitoringPlan(once, day(200), DEFAULT_MONITORING_LEASE_MS, 1)).toEqual(once);
    expect(batchDueMonitoringPlans([once], day(200), DEFAULT_MONITORING_LEASE_MS, 2)).toHaveLength(
      1,
    );
  });
});

function event(id: string, personId: string, observedDay: number, score: number): CareerEvent {
  return {
    id,
    personId,
    kind: "shipped_product",
    title: id,
    description: id,
    observedAt: day(observedDay),
    evidenceClaimIds: [`claim-${id}`],
    judgments: [
      { dimension: "difficulty", score, probabilities: [], confidence: 1 },
      { dimension: "ownership", score, probabilities: [], confidence: 1 },
      { dimension: "external_impact", score, probabilities: [], confidence: 1 },
      { dimension: "originality", score, probabilities: [], confidence: 1 },
      { dimension: "peer_validation", score, probabilities: [], confidence: 1 },
    ],
    status: "accepted",
    model: "test",
    questionVersion: "test",
    createdAt: day(observedDay),
  };
}

describe("outcome mapping and slope", () => {
  test("maps only accepted events and keeps progress dimensions separate", () => {
    const accepted = event("e1", "p-1", 50, 4);
    const review = { ...event("e2", "p-1", 60, 2), status: "review" as const };
    const role = {
      ...event("role", "p-1", 70, 4),
      kind: "selective_role_transition" as const,
    };
    const records = careerEventsToLongitudinalRecords([accepted, review, role]);
    expect(records.outcomes).toHaveLength(1);
    expect(records.opportunities).toHaveLength(1);
    expect(records.opportunities[0]?.id).toBe("opportunity-role");
    expect(records.outcomes[0]?.value).toBe(1);
    const vector = progressVector("p-1", day(0), day(90), [accepted, review]);
    expect(vector.dimensions.difficulty).toBe(1);
    expect(vector.dimensions.external_impact).toBe(1);
  });

  test("a dimension with no judgments is null, not zero", () => {
    const onlyDifficulty = {
      ...event("e1", "p-1", 50, 0),
      judgments: [{ dimension: "difficulty" as const, score: 0, probabilities: [], confidence: 1 }],
    };
    const vector = progressVector("p-1", day(0), day(90), [onlyDifficulty]);
    expect(vector.dimensions.difficulty).toBe(0);
    expect(vector.dimensions.external_impact).toBeNull();
    expect(vector.dimensions.originality).toBeNull();
    expect(vector.dimensions.peer_validation).toBeNull();
  });

  test("a dimension present on one event and absent on another averages only the present one", () => {
    const both = event("e-both", "p-1", 50, 4);
    const partial = {
      ...event("e-partial", "p-1", 60, 0),
      judgments: [{ dimension: "difficulty" as const, score: 0, probabilities: [], confidence: 1 }],
    };
    const vector = progressVector("p-1", day(0), day(90), [both, partial]);
    expect(vector.dimensions.difficulty).toBe(0.5);
    // ownership is judged only on `both`, so the absent event must not drag it to zero.
    expect(vector.dimensions.ownership).toBe(1);
  });

  test("computes opportunity-adjusted residual slope over fixed cutoffs", () => {
    const outcomes: Outcome[] = [
      {
        id: "p-early",
        personId: "p",
        opportunityId: null,
        kind: "early",
        value: 1,
        observedAt: day(20),
        createdAt: day(20),
      },
      {
        id: "a-early",
        personId: "a",
        opportunityId: null,
        kind: "early",
        value: 5,
        observedAt: day(20),
        createdAt: day(20),
      },
      {
        id: "b-early",
        personId: "b",
        opportunityId: null,
        kind: "early",
        value: 9,
        observedAt: day(20),
        createdAt: day(20),
      },
      {
        id: "p-late",
        personId: "p",
        opportunityId: null,
        kind: "late",
        value: 10,
        observedAt: day(150),
        createdAt: day(150),
      },
      {
        id: "a-late",
        personId: "a",
        opportunityId: null,
        kind: "late",
        value: 5,
        observedAt: day(150),
        createdAt: day(150),
      },
      {
        id: "b-late",
        personId: "b",
        opportunityId: null,
        kind: "late",
        value: 9,
        observedAt: day(150),
        createdAt: day(150),
      },
    ];
    const opportunities: Opportunity[] = [];
    const slope = residualSlope(
      "p",
      day(90),
      day(180),
      outcomes,
      opportunities,
      JUDGE_RELIABILITY_V2_0_0,
      90,
    );
    expect(slope.state).toBe("defined");
    expect(slope.delta).not.toBeNull();
    expect(slope.delta as number).toBeGreaterThan(0);
  });

  test("rewards positive low-recognition slope and shrinks scout gain separately", () => {
    const slope = {
      personId: "p",
      t0: day(0),
      t1: day(180),
      residualT0: -0.2,
      residualT1: 0.4,
      delta: 0.6,
      state: "defined" as const,
    };
    const hit = {
      referralId: "r-1",
      judgeId: "u",
      personId: "p",
      forecastKind: "will_compound" as const,
      referredAt: day(0),
      priorRecognition: 0.25,
      slope,
    };
    expect(scoutHitGain(hit)).toBeCloseTo(0.45);
    expect(scoutHitGain({ ...hit, forecastKind: "unspecified" })).toBeNull();
    expect(scoutHitGain({ ...hit, personId: "other" })).toBeNull();
    expect(scoutHitGain({ ...hit, referredAt: day(1) })).toBeNull();
    const aggregate = aggregateScoutInformationGain([hit], 3).get("u");
    expect(aggregate?.rawGain).toBeCloseTo(0.45);
    expect(aggregate?.gain).toBeCloseTo(0.1125);
  });
});

describe("offline signal evaluation", () => {
  test("scores a 24-case adjudicated corpus including quiet-compounding and prestigious-flat", () => {
    const cases = Array.from({ length: 24 }, (_, index) => ({
      id: `case-${index}`,
      expectedSamePerson: index !== 23,
      identityDecision: (index === 23 ? "review" : "same") as "same" | "review",
      expectedEventKind: "shipped_product" as const,
      predictedEventKind: "shipped_product" as const,
      routedToReview: index === 23,
      publishedAt: day(80),
      cutoffAt: day(90),
      archetype: (index < 12 ? "quiet_compounding" : "prestigious_flat") as
        | "quiet_compounding"
        | "prestigious_flat",
      residualDelta: index < 12 ? 0.2 : 0,
    }));
    const evaluation = evaluateLongitudinalCases(cases, 0.05);
    expect(evaluation.caseCount).toBe(24);
    expect(evaluation.identityPrecision).toBe(1);
    expect(evaluation.eventPrecision).toBe(1);
    expect(evaluation.eventRecall).toBe(1);
    expect(evaluation.reviewRate).toBeCloseTo(1 / 24);
    expect(evaluation.postCutoffLeakCount).toBe(0);
    expect(evaluation.meanSourceAgeDays).toBe(10);
    expect(evaluation.quietCompoundingDetectionRate).toBe(1);
    expect(evaluation.prestigiousFlatFalsePositiveRate).toBe(0);
  });
});

describe("career-evidence dimension list", () => {
  test("CAREER_EVIDENCE_DIMENSIONS matches the LEVELS rubric keys", () => {
    expect([...CAREER_EVIDENCE_DIMENSIONS].sort()).toEqual(
      [...Object.keys(LEVELS)].sort() as ProgressDimension[],
    );
  });

  test("CAREER_EVIDENCE_DIMENSIONS matches the ProgressDimension union", () => {
    // This map is exhaustive by construction: adding a member to the union
    // without adding it here is a typecheck failure.
    const union: Record<ProgressDimension, true> = {
      difficulty: true,
      ownership: true,
      external_impact: true,
      originality: true,
      peer_validation: true,
    };
    expect([...CAREER_EVIDENCE_DIMENSIONS].sort()).toEqual(
      [...Object.keys(union)].sort() as ProgressDimension[],
    );
    expect(new Set(CAREER_EVIDENCE_DIMENSIONS).size).toBe(CAREER_EVIDENCE_DIMENSIONS.length);
  });

  test("MAX_LEVEL is the top of the shared rubric scale", () => {
    expect(MAX_LEVEL).toBe(4);
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(LEVELS[dimension].length).toBe(MAX_LEVEL + 1);
    }
  });
});
