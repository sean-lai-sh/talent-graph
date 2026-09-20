import { describe, expect, test } from "bun:test";
import { buildGrokRoutineRequest } from "../apps/club/lib/longitudinal/grok.ts";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import {
  fetchGitHubEvidence,
  ingestGrokEvidencePacket,
} from "../apps/club/lib/longitudinal/sources.ts";
import type { Opportunity, Outcome } from "../src/domain/types.ts";
import type {
  CanonicalIdentity,
  CareerEvent,
  GrokEvidenceItem,
  GrokEvidencePacket,
  JevJudgmentService,
} from "../src/index.ts";
import {
  aggregateScoutInformationGain,
  batchDueMonitoringPlans,
  careerEventsToLongitudinalRecords,
  checkpointJobKey,
  contentFingerprint,
  createMonitoringPlan,
  evaluateLongitudinalCases,
  processEvidence,
  progressVector,
  residualSlope,
  runDueMonitoringPlans,
  scoutHitGain,
  validateGrokEvidencePacket,
} from "../src/index.ts";
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

const acceptingJudgments: JevJudgmentService = {
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
  test("Grok packets reject evidence after the immutable cutoff and dedupe valid items", () => {
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

    const valid = { ...packet, items: [evidence("valid", 80), evidence("valid", 80)] };
    expect(ingestGrokEvidencePacket(valid)).toHaveLength(1);
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
            updated_at: day(50).toISOString(),
            description: "A difficult compiler.",
          },
          {
            full_name: "avery/too-new",
            html_url: "https://github.com/avery/too-new",
            updated_at: day(95).toISOString(),
            description: "After cutoff.",
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
      ];
    });
    expect(calls).toHaveLength(2);
    expect(fetched.map((item) => item.sourceId)).toEqual(["repo:avery/new-work", "event:event-1"]);
  });

  test("Grok routine request is bounded to person, identities, and cutoff", () => {
    const request = buildGrokRoutineRequest({
      identity,
      from: day(0),
      cutoffAt: day(90),
      callbackUrl: "https://example.com/api/evidence",
    });
    expect(request.person.knownIdentities[0]?.externalId).toBe("avery");
    expect(request.cutoffAt).toBe(day(90).toISOString());
    expect(request.instructions).toContain("Exclude evidence after cutoffAt");
  });
});

describe("Jev judgments and evidence policy", () => {
  test("TypeSafe adapter maps Jev typed answers into identity and progress judgments", async () => {
    let requestCount = 0;
    const client = {
      async systemOne(request: { questions: Record<string, unknown> }) {
        requestCount++;
        if ("decision" in request.questions) {
          return {
            answers: {
              decision: { score: 2, confidence: 0.91 },
              same_name: { noul: 0.95 },
              same_affiliation: { noul: 0.8 },
              same_handle: { noul: 1 },
            },
          };
        }
        return {
          answers: {
            event_kind: { choice: "shipped_product", confidence: 0.88 },
            difficulty: {
              score: 3,
              probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 },
              confidence: 0.8,
            },
            ownership: {
              score: 3,
              probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 },
              confidence: 0.8,
            },
            external_impact: {
              score: 2,
              probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
              confidence: 1,
            },
            originality: {
              score: 3,
              probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 },
              confidence: 1,
            },
            peer_validation: {
              score: 2,
              probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
              confidence: 1,
            },
          },
        };
      },
    } as unknown as Parameters<typeof createJevJudgmentService>[0];
    const service = createJevJudgmentService(client);
    expect((await service.assessIdentity(identity, evidence("x", 30))).decision).toBe("same");
    const claim = await service.assessClaim(evidence("x", 30));
    expect(claim.eventKind).toBe("shipped_product");
    expect(claim.dimensions).toHaveLength(5);
    expect(requestCount).toBe(2);
  });

  test("pipeline excludes post-cutoff facts and routes uncertainty to review", async () => {
    const uncertain: JevJudgmentService = {
      ...acceptingJudgments,
      async assessIdentity() {
        return {
          decision: "review",
          confidence: 0.55,
          fieldMatches: { name: 0.6, affiliation: 0.5, handle: 0.4 },
        };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("before", 80), evidence("after", 91)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: uncertain,
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.events[0]?.status).toBe("review");
    expect(result.needsReview).toBe(true);
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
      judgments: acceptingJudgments,
    });
    expect(fetches).toBe(1);
    expect(run.fetchCount).toBe(1);
    expect(run.results.find((result) => result.planId === "early")?.result.events).toHaveLength(1);
    expect(run.results.find((result) => result.planId === "late")?.result.events).toHaveLength(2);
    expect(run.plans.every((plan) => plan.status === "completed")).toBe(true);
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
    expect(vector.dimensions.external_impact).toBeNull();
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
      priorRecognition: 0.25,
      slope,
    };
    expect(scoutHitGain(hit)).toBeCloseTo(0.45);
    expect(scoutHitGain({ ...hit, forecastKind: "unspecified" })).toBeNull();
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
