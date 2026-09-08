import { describe, expect, test } from "bun:test";
import { EVIDENCE_MULTIPLIER, REFERRAL_WEIGHTS } from "../src/domain/constants.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  CURRENT_SPECS,
  getSpec,
  isRegisteredSpec,
  REFERRAL_SIGNAL_V0_1_0,
  SPEC_HISTORY,
  specVersions,
} from "../src/models/registry.ts";
import { type BradleyTerrySpec, specId, validateSpec } from "../src/models/spec.ts";

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
});
