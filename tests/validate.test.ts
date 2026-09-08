import { describe, expect, test } from "bun:test";
import { DIMENSIONS, EVIDENCE_MULTIPLIER, REFERRAL_WEIGHTS } from "../src/domain/constants.ts";
import type {
  Comparison,
  Evaluation,
  Opportunity,
  Outcome,
  Referral,
} from "../src/domain/types.ts";
import {
  validateComparison,
  validateEvaluation,
  validateOpportunity,
  validateOutcome,
  validateReferral,
} from "../src/domain/validate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");

function referral(overrides: Partial<Referral> = {}): Referral {
  return {
    id: "r-1",
    referrerId: "p-1",
    candidateId: "p-2",
    conviction: 4,
    confidence: 4,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "We debugged a distributed systems failure together over two days.",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: "e-1",
    evaluatorId: "p-1",
    candidateId: "p-2",
    dimension: "problem_solving",
    score: 3,
    confidence: 4,
    evidenceText: "Reframed the problem in a way nobody else on the team had considered.",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function comparison(overrides: Partial<Comparison> = {}): Comparison {
  return {
    id: "c-1",
    evaluatorId: "p-9",
    personAId: "p-1",
    personBId: "p-2",
    dimension: "agency",
    outcome: "a",
    winnerId: "p-1",
    confidence: 3,
    createdAt: T0,
    ...overrides,
  };
}

describe("constants", () => {
  test("dimensions are the seven canonical ones in order", () => {
    expect(DIMENSIONS).toEqual([
      "problem_solving",
      "learning_velocity",
      "agency",
      "taste",
      "output",
      "generativity",
      "originality",
    ]);
  });

  test("referral weights sum to 1", () => {
    const sum =
      REFERRAL_WEIGHTS.conviction +
      REFERRAL_WEIGHTS.confidence +
      REFERRAL_WEIGHTS.relationshipDepth;
    expect(sum).toBeCloseTo(1, 12);
  });

  test("evidence multipliers match the specified table", () => {
    expect(EVIDENCE_MULTIPLIER).toEqual({
      firsthand_work: 1.0,
      firsthand_personal: 0.9,
      artifact: 0.85,
      reputation: 0.6,
      other: 0.7,
    });
  });
});

describe("validateReferral", () => {
  test("accepts a well-formed referral", () => {
    expect(validateReferral(referral())).toEqual({ ok: true });
  });

  test("rejects a self-referral", () => {
    const res = validateReferral(referral({ candidateId: "p-1" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("self-referral");
  });

  test("accepts scales at the boundaries", () => {
    expect(
      validateReferral(referral({ conviction: 1, confidence: 5, relationshipDepth: 1 })).ok,
    ).toBe(true);
  });

  test("rejects out-of-range and non-integer scales", () => {
    const res = validateReferral(
      referral({ conviction: 6 as never, confidence: 2.5 as never, relationshipDepth: 0 as never }),
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors).toHaveLength(3);
  });

  test("rejects a duplicate (referrerId, candidateId) pair", () => {
    const existing = [referral({ id: "r-0" })];
    const res = validateReferral(referral({ id: "r-1" }), existing);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("duplicate");
  });

  test("does not treat the record itself as its own duplicate", () => {
    const r = referral();
    expect(validateReferral(r, [r])).toEqual({ ok: true });
  });

  test("rejects empty evidenceText", () => {
    const res = validateReferral(referral({ evidenceText: "   " }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("evidenceText");
  });

  test("rejects an unknown evidence type", () => {
    const res = validateReferral(referral({ evidenceType: "hearsay" as never }));
    expect(res.ok).toBe(false);
  });
});

describe("validateEvaluation", () => {
  test("accepts a scored evaluation", () => {
    expect(validateEvaluation(evaluation())).toEqual({ ok: true });
  });

  test("accepts N/O with null confidence", () => {
    expect(validateEvaluation(evaluation({ score: null, confidence: null }))).toEqual({ ok: true });
  });

  test("rejects a score outside 0..4", () => {
    const res = validateEvaluation(evaluation({ score: 5 as never }));
    expect(res.ok).toBe(false);
  });

  test("rejects confidence on an N/O score", () => {
    const res = validateEvaluation(evaluation({ score: null, confidence: 3 }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("null when score is null");
  });

  test("rejects an unknown dimension", () => {
    const res = validateEvaluation(evaluation({ dimension: "charisma" as never }));
    expect(res.ok).toBe(false);
  });
});

describe("validateComparison", () => {
  test("accepts a well-formed comparison", () => {
    expect(validateComparison(comparison())).toEqual({ ok: true });
  });

  test("accepts outcome b with winnerId personBId", () => {
    expect(validateComparison(comparison({ outcome: "b", winnerId: "p-2" }))).toEqual({ ok: true });
  });

  test("rejects comparing a person with themselves", () => {
    const res = validateComparison(comparison({ personBId: "p-1", winnerId: "p-1" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("must differ");
  });

  test("rejects a winnerId that contradicts the outcome", () => {
    const res = validateComparison(comparison({ outcome: "a", winnerId: "p-2" }));
    expect(res.ok).toBe(false);
  });

  test("requires a null winner for tie / skip / insufficient_observation", () => {
    for (const outcome of ["tie", "skip", "insufficient_observation"] as const) {
      expect(validateComparison(comparison({ outcome, winnerId: null }))).toEqual({ ok: true });
      const res = validateComparison(comparison({ outcome, winnerId: "p-1" }));
      expect(res.ok).toBe(false);
    }
  });

  test("rejects an evaluator who is one of the compared people", () => {
    const res = validateComparison(comparison({ evaluatorId: "p-2" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("evaluatorId");
  });

  test("allows self-evaluation when explicitly opted in", () => {
    expect(
      validateComparison(comparison({ evaluatorId: "p-2" }), { allowSelfEvaluation: true }),
    ).toEqual({ ok: true });
  });

  test("rejects an unknown dimension", () => {
    const res = validateComparison(comparison({ dimension: "vibes" as never }));
    expect(res.ok).toBe(false);
  });
});

describe("validateOutcome / validateOpportunity", () => {
  const base: Outcome = {
    id: "o-1",
    personId: "p-1",
    opportunityId: null,
    kind: "shipped_project",
    value: 3.5,
    observedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
  };

  test("accepts a measurable outcome and a null (nothing measurable) outcome", () => {
    expect(validateOutcome(base)).toEqual({ ok: true });
    expect(validateOutcome({ ...base, value: null })).toEqual({ ok: true });
  });

  test("rejects a non-finite value, an empty kind, and an invalid date", () => {
    expect(validateOutcome({ ...base, value: Number.NaN }).ok).toBe(false);
    expect(validateOutcome({ ...base, kind: " " }).ok).toBe(false);
    expect(validateOutcome({ ...base, observedAt: new Date("nope") }).ok).toBe(false);
  });

  test("opportunity must not end before it starts", () => {
    const op: Opportunity = {
      id: "op-1",
      personId: "p-1",
      kind: "grant",
      description: "x",
      startedAt: new Date("2026-03-01T00:00:00.000Z"),
      endedAt: null,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    };
    expect(validateOpportunity(op)).toEqual({ ok: true });
    expect(validateOpportunity({ ...op, endedAt: new Date("2026-02-01T00:00:00.000Z") }).ok).toBe(
      false,
    );
    expect(validateOpportunity({ ...op, personId: "" }).ok).toBe(false);
  });
});
