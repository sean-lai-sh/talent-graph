import { describe, expect, test } from "bun:test";
import { EVIDENCE_MULTIPLIER, REFERRAL_WEIGHTS } from "../src/domain/constants.ts";
import type { Referral } from "../src/domain/types.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  CURRENT_SPECS,
  deepFreeze,
  getSpec,
  isRegisteredSpec,
  JUDGE_RELIABILITY_V2_0_0,
  JUDGE_RELIABILITY_V3_0_0,
  REFERRAL_SIGNAL_V0_1_0,
  SPEC_HISTORY,
  specVersions,
} from "../src/models/registry.ts";
import {
  type BradleyTerrySpec,
  type JudgeReliabilitySpec,
  specId,
  validateSpec,
} from "../src/models/spec.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const FIRSTHAND: Referral = {
  id: "r-1",
  referrerId: "u",
  candidateId: "v",
  conviction: 5,
  confidence: 3,
  relationshipDepth: 1,
  evidenceType: "firsthand_work",
  evidenceText: "Shipped it together.",
  createdAt: T0,
  updatedAt: T0,
};

describe("validateSpec", () => {
  test("accepts every registered spec", () => {
    for (const spec of SPEC_HISTORY) expect(validateSpec(spec)).toEqual({ ok: true });
  });

  test("rejects weights that do not sum to 1", () => {
    const res = validateSpec({
      ...REFERRAL_SIGNAL_V0_1_0,
      weights: { conviction: 0.5, confidence: 0.5, relationshipDepth: 0.5 },
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("sum to 1");
  });

  test("rejects negative λ", () => {
    const res = validateSpec({ ...BRADLEY_TERRY_V1_0_0, regularization: -0.1 });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.join(" ")).toContain("regularization");
  });

  test("rejects an unknown evidence type and a multiplier outside [0,1]", () => {
    const res = validateSpec({
      ...REFERRAL_SIGNAL_V0_1_0,
      evidenceMultiplier: { ...EVIDENCE_MULTIPLIER, hearsay: 0.5, reputation: 1.5 } as never,
    });
    expect(res.ok).toBe(false);
    const text = res.ok === false ? res.errors.join(" ") : "";
    expect(text).toContain("hearsay");
    expect(text).toContain("reputation");
  });

  test("rejects a non-semver version and accepts a build tag", () => {
    expect(validateSpec({ ...BRADLEY_TERRY_V1_0_0, version: "v1" }).ok).toBe(false);
    expect(validateSpec({ ...BRADLEY_TERRY_V1_0_0, version: "1.0.0+env" }).ok).toBe(true);
  });

  test("rejects an invalid tieHandling and a negative κ", () => {
    const bad: BradleyTerrySpec = {
      ...BRADLEY_TERRY_V1_0_0,
      tieHandling: "average" as never,
      anchorStrength: -1,
    };
    const res = validateSpec(bad);
    expect(res.ok === false && res.errors).toHaveLength(2);
  });
});

describe("validateSpec: judge_reliability", () => {
  test("accepts the registered V2 spec and rejects each bad field", () => {
    expect(validateSpec(JUDGE_RELIABILITY_V2_0_0)).toEqual({ ok: true });
    const bad = (patch: Partial<JudgeReliabilitySpec>) =>
      validateSpec({ ...JUDGE_RELIABILITY_V2_0_0, ...patch });
    expect(bad({ learningRate: 0 }).ok).toBe(false);
    expect(bad({ learningRate: 1.5 }).ok).toBe(false);
    expect(bad({ errorScale: 0 }).ok).toBe(false);
    expect(bad({ shrinkage: -1 }).ok).toBe(false);
    expect(bad({ priorReliability: 1.2 }).ok).toBe(false);
    expect(bad({ observationWindowDays: -1 }).ok).toBe(false);
    expect(bad({ opportunityBuckets: [2, 1] }).ok).toBe(false);
    expect(bad({ opportunityBuckets: [0] }).ok).toBe(false);
    expect(bad({ minBucketSize: 0 }).ok).toBe(false);
    expect(bad({ applyBiasCorrection: "yes" as never }).ok).toBe(false);
    expect(bad({ opportunityBuckets: [] }).ok).toBe(true);
  });

  test("registered and current", () => {
    expect(CURRENT_SPECS.judge_reliability).toBe(JUDGE_RELIABILITY_V2_0_0);
    expect(getSpec("judge_reliability", "2.0.0")).toBe(JUDGE_RELIABILITY_V2_0_0);
    expect(specVersions("judge_reliability")).toEqual(["2.0.0", "3.0.0"]);
    expect(JUDGE_RELIABILITY_V2_0_0.priorReliability).toBe(1);
    expect(Object.isFrozen(JUDGE_RELIABILITY_V2_0_0.opportunityBuckets)).toBe(true);
  });

  test("accepts registered V2 and V3 specs", () => {
    expect(validateSpec(JUDGE_RELIABILITY_V2_0_0)).toEqual({ ok: true });
    expect(validateSpec(JUDGE_RELIABILITY_V3_0_0)).toEqual({ ok: true });
  });

  test("current judge_reliability stays 2.0.0; 3.0.0 is registered", () => {
    expect(CURRENT_SPECS.judge_reliability).toBe(JUDGE_RELIABILITY_V2_0_0);
    expect(CURRENT_SPECS.judge_reliability.version).toBe("2.0.0");
    expect(getSpec("judge_reliability", "3.0.0")).toBe(JUDGE_RELIABILITY_V3_0_0);
    expect(Object.isFrozen(JUDGE_RELIABILITY_V3_0_0)).toBe(true);
  });

  test("rejects invalid V3 fields when any V3 key is present", () => {
    expect(validateSpec({ ...JUDGE_RELIABILITY_V3_0_0, scoutShrinkage: -1 }).ok).toBe(false);
    expect(validateSpec({ ...JUDGE_RELIABILITY_V3_0_0, scoutHook: "yes" as never }).ok).toBe(false);
  });

  test("JSON of 2.0.0 has no V3 keys", () => {
    const keys = Object.keys(JUDGE_RELIABILITY_V2_0_0).sort();
    expect(keys).toEqual([
      "applyBiasCorrection",
      "errorScale",
      "excludeEditedReferrals",
      "kind",
      "learningRate",
      "minBucketSize",
      "minKindSize",
      "observationWindowDays",
      "opportunityBuckets",
      "opportunityClock",
      "priorReliability",
      "shrinkage",
      "version",
    ]);
    expect(keys).not.toContain("scoutHook");
    expect(keys).not.toContain("scoutShrinkage");
    expect(keys).not.toContain("slopeMinGapDays");
    expect(JSON.parse(JSON.stringify(JUDGE_RELIABILITY_V2_0_0))).not.toHaveProperty("scoutHook");
  });
});

describe("registry", () => {
  test("current referral spec carries the domain constants", () => {
    expect(CURRENT_SPECS.referral_signal.weights).toEqual({ ...REFERRAL_WEIGHTS });
    expect(CURRENT_SPECS.referral_signal.evidenceMultiplier).toEqual(EVIDENCE_MULTIPLIER);
    expect(CURRENT_SPECS.referral_signal.topK).toBe(5);
  });

  test("current Bradley–Terry spec has the documented defaults", () => {
    expect(CURRENT_SPECS.bradley_terry).toMatchObject({
      regularization: 0.1,
      maxIterations: 500,
      tolerance: 1e-6,
      minComparisons: 3,
      minOpponents: 2,
      tieHandling: "ignore",
      anchorStrength: 0,
    });
  });

  test("getSpec returns registered versions and throws with a listing otherwise", () => {
    expect(getSpec("referral_signal", "0.1.0")).toBe(REFERRAL_SIGNAL_V0_1_0);
    expect(getSpec("bradley_terry", "1.0.0")).toBe(BRADLEY_TERRY_V1_0_0);
    expect(() => getSpec("bradley_terry", "9.9.9")).toThrow(/known versions: 1\.0\.0/);
  });

  test("specVersions and specId", () => {
    expect(specVersions("referral_signal")).toEqual(["0.1.0"]);
    expect(specId(BRADLEY_TERRY_V1_0_0)).toBe("bradley_terry@1.0.0");
  });

  test("isRegisteredSpec detects a value drift under a registered version", () => {
    expect(isRegisteredSpec(BRADLEY_TERRY_V1_0_0)).toBe(true);
    expect(isRegisteredSpec({ ...BRADLEY_TERRY_V1_0_0, regularization: 0.2 })).toBe(false);
  });

  test("registered specs are frozen", () => {
    expect(Object.isFrozen(REFERRAL_SIGNAL_V0_1_0)).toBe(true);
    expect(Object.isFrozen(SPEC_HISTORY)).toBe(true);
  });

  test("registered specs are deep-frozen: nested weights cannot be mutated", () => {
    // Before deep freezing, this assignment silently changed the registry while
    // isRegisteredSpec kept comparing the (now mutated) object to itself.
    const before = referralStrength(FIRSTHAND);
    expect(() => {
      CURRENT_SPECS.referral_signal.weights.conviction = 0;
    }).toThrow(TypeError);
    expect(CURRENT_SPECS.referral_signal.weights.conviction).toBe(REFERRAL_WEIGHTS.conviction);
    expect(referralStrength(FIRSTHAND)).toBe(before);
    expect(isRegisteredSpec(CURRENT_SPECS.referral_signal)).toBe(true);
  });

  test("every nested object of every registered spec is frozen", () => {
    for (const spec of SPEC_HISTORY) {
      expect(Object.isFrozen(spec)).toBe(true);
      for (const value of Object.values(spec)) {
        if (value !== null && typeof value === "object") expect(Object.isFrozen(value)).toBe(true);
      }
    }
    expect(Object.isFrozen(REFERRAL_SIGNAL_V0_1_0.weights)).toBe(true);
    expect(Object.isFrozen(REFERRAL_SIGNAL_V0_1_0.evidenceMultiplier)).toBe(true);
    expect(Object.isFrozen(CURRENT_SPECS)).toBe(true);
    expect(() => {
      (SPEC_HISTORY as unknown[]).push({});
    }).toThrow(TypeError);
  });
});

describe("deepFreeze", () => {
  test("freezes nested objects and arrays and returns the same reference", () => {
    const value = { a: { b: [{ c: 1 }] }, d: 2 };
    const frozen = deepFreeze(value);
    expect(frozen).toBe(value);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b)).toBe(true);
    expect(Object.isFrozen(frozen.a.b[0])).toBe(true);
    expect(() => {
      (frozen.a.b[0] as { c: number }).c = 9;
    }).toThrow(TypeError);
  });

  test("passes primitives and null through", () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze("s")).toBe("s");
    expect(deepFreeze(null)).toBeNull();
  });
});
