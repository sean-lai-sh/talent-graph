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
  DEFAULT_MONITORING_LEASE_MS,
  evaluateLongitudinalCases,
  failMonitoringPlan,
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
    const client = {
      async systemOne(request: { questions: Record<string, unknown> }) {
        requestCount++;
        if ("decision" in request.questions) {
          return {
            answers: {
              decision: { choice: "same", confidence: 0.91 },
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

  test("same-person high confidence with contradictory fieldMatches goes to review", async () => {
    const contradictory: JevJudgmentService = {
      ...acceptingJudgments,
      async assessIdentity() {
        return {
          decision: "same",
          confidence: 0.98,
          fieldMatches: { name: 0.92, affiliation: 0.04, handle: 0.02 },
        };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: contradictory,
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.identityDecision).toBe("same");
    expect(result.events).toHaveLength(0);
    expect(result.needsReview).toBe(true);
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);
  });

  test("low event confidence never creates accepted outcomes", async () => {
    const lowEvent: JevJudgmentService = {
      ...acceptingJudgments,
      async assessClaim() {
        const accepted = await acceptingJudgments.assessClaim(evidence("work", 40));
        return { ...accepted, eventConfidence: 0.4 };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: lowEvent,
    });
    expect(result.claims[0]?.status).toBe("review");
    expect(result.events[0]?.status).toBe("review");
    expect(result.needsReview).toBe(true);
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);
  });

  test("low dimension confidence never creates accepted outcomes", async () => {
    const lowDimension: JevJudgmentService = {
      ...acceptingJudgments,
      async assessClaim() {
        const accepted = await acceptingJudgments.assessClaim(evidence("work", 40));
        return {
          ...accepted,
          dimensions: accepted.dimensions.map((judgment, index) =>
            index === 0 ? { ...judgment, confidence: 0.2 } : judgment,
          ),
        };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: lowDimension,
    });
    expect(result.claims[0]?.status).toBe("review");
    expect(result.events[0]?.status).toBe("review");
    expect(result.needsReview).toBe(true);
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);
  });

  test("missing dimensions route to review and never become a zero outcome", async () => {
    const missingDimensions: JevJudgmentService = {
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
      judgments: missingDimensions,
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
      judgments: acceptingJudgments,
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
      judgments: acceptingJudgments,
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
      judgments: acceptingJudgments,
    });
    expect(run.plans[0]?.status).toBe("completed");
    expect(run.plans[0]?.attemptCount).toBe(1);
    expect(run.results[0]?.result.events).toHaveLength(1);
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
