/**
 * From accepted events to outcomes, and the residual slope over them.
 *
 * `careerEvidenceVector` is the judgment concept summarised over a window;
 * `residualSlope` is the time concept over fixed cutoffs. A dimension with no
 * judgments is `null`, never zero, at every step.
 */

import { describe, expect, test } from "bun:test";
import type { Opportunity, Outcome } from "../src/domain/types.ts";
import {
  aggregateScoutInformationGain,
  careerEventsToLongitudinalRecords,
  careerEvidenceVector,
  evaluateLongitudinalCases,
  residualSlope,
  scoutHitGain,
} from "../src/index.ts";
import { JUDGE_RELIABILITY_V2_0_0 } from "../src/models/registry.ts";
import { day, event } from "./helpers/longitudinal.ts";

describe("outcome mapping and slope", () => {
  test("maps only accepted events and keeps career-evidence dimensions separate", () => {
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
    const vector = careerEvidenceVector("p-1", day(0), day(90), [accepted, review]);
    expect(vector.dimensions.difficulty).toBe(1);
    expect(vector.dimensions.external_impact).toBe(1);
  });

  test("a dimension with no judgments is null, not zero", () => {
    const onlyDifficulty = {
      ...event("e1", "p-1", 50, 0),
      judgments: [{ dimension: "difficulty" as const, score: 0, probabilities: [], confidence: 1 }],
    };
    const vector = careerEvidenceVector("p-1", day(0), day(90), [onlyDifficulty]);
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
    const vector = careerEvidenceVector("p-1", day(0), day(90), [both, partial]);
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
