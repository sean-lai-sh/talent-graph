import { describe, expect, test } from "bun:test";
import { judgeWeightOptions } from "../src/judges/reliability.ts";
import {
  createModelRun,
  hashInputs,
  runCapabilityVectors,
  runJudgeCalibration,
  runReferralSignals,
  stableStringify,
} from "../src/modelRun.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  JUDGE_RELIABILITY_V2_0_0,
  REFERRAL_SIGNAL_V0_1_0,
} from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const data = generateSeed();

describe("hashInputs", () => {
  test("stable under key reordering and Map insertion order", () => {
    const a = {
      x: 1,
      y: [1, 2, { z: "q", w: NOW }],
      m: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
    };
    const b = {
      m: new Map([
        ["k2", 2],
        ["k1", 1],
      ]),
      y: [1, 2, { w: NOW, z: "q" }],
      x: 1,
    };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(hashInputs(a)).toBe(hashInputs(b));
    expect(hashInputs(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("changes when a comparison is added", () => {
    const before = hashInputs(data.comparisons);
    const extra = { ...(data.comparisons[0] as object), id: "cmp-extra" };
    const after = hashInputs([...data.comparisons, extra]);
    expect(after).not.toBe(before);
  });
});

describe("createModelRun", () => {
  test("records spec, hash and outputs; same inputs + params ⇒ same id", () => {
    const params = { spec: REFERRAL_SIGNAL_V0_1_0 };
    const run1 = createModelRun("referral_signal_v0", "0.1.0", params, data.referrals, 1, NOW);
    const run2 = createModelRun("referral_signal_v0", "0.1.0", params, data.referrals, 2, NOW);
    expect(run1.id).toBe(run2.id);
    expect(run1.inputHash).toBe(run2.inputHash);
    expect(run1.parameters.spec).toEqual(REFERRAL_SIGNAL_V0_1_0);
    expect(run1.createdAt).toEqual(NOW);

    const other = createModelRun(
      "referral_signal_v0",
      "0.1.0",
      { spec: { ...REFERRAL_SIGNAL_V0_1_0, topK: 3 } },
      data.referrals,
      1,
      NOW,
    );
    expect(other.id).not.toBe(run1.id);
  });

  test("copies `now` so mutating the caller's Date does not move createdAt", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const run = createModelRun("referral_signal_v0", "0.1.0", {}, data.referrals, 1, now);
    const id = run.id;
    now.setFullYear(1999);
    expect(run.createdAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(run.createdAt).not.toBe(now);
    expect(run.id).toBe(id);
  });
});

describe("runCapabilityVectors provenance", () => {
  test("a run without `previous` records null anchor provenance", () => {
    const run = runCapabilityVectors(data.people, data.comparisons, NOW);
    expect(run.parameters.spec).toEqual(BRADLEY_TERRY_V1_0_0);
    expect(run.parameters.previousThetaHash).toBeNull();
    expect(run.parameters.previousRunId).toBeNull();
    expect(run.parameters.anchorStrength).toBe(0);
    expect(run.parameters.bt).toBeNull();
    expect("previous" in run.parameters).toBe(false);
    expect(Object.keys(run.parameters).sort()).toEqual(
      [
        "spec",
        "minComparisons",
        "minOpponents",
        "tieHandling",
        "anchored",
        "anchorStrength",
        "bt",
        "previousRunId",
        "previousThetaHash",
      ].sort(),
    );
  });

  test("two different previous runs ⇒ same inputHash, different id and previousThetaHash", () => {
    const priorA = runCapabilityVectors(data.people, data.comparisons, NOW);
    const priorB = runCapabilityVectors(data.people, data.comparisons, NOW, {
      bt: { regularization: 5 },
    });
    expect(priorA.id).not.toBe(priorB.id);

    const fromA = runCapabilityVectors(data.people, data.comparisons, NOW, {
      previous: priorA.outputs,
      previousRunId: priorA.id,
      anchorStrength: 1,
    });
    const fromB = runCapabilityVectors(data.people, data.comparisons, NOW, {
      previous: priorB.outputs,
      previousRunId: priorB.id,
      anchorStrength: 1,
    });

    expect(fromA.inputHash).toBe(fromB.inputHash);
    expect(fromA.id).not.toBe(fromB.id);
    expect(fromA.parameters.previousThetaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fromB.parameters.previousThetaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fromA.parameters.previousThetaHash).not.toBe(fromB.parameters.previousThetaHash);
    expect(fromA.parameters.previousRunId).toBe(priorA.id);
    expect(fromB.parameters.previousRunId).toBe(priorB.id);
    expect(fromA.parameters.anchorStrength).toBe(1);
    expect("previous" in fromA.parameters).toBe(false);
    expect(fromA.outputs.options.anchored).toBe(true);

    // Same prior again ⇒ reproducible id.
    const again = runCapabilityVectors(data.people, data.comparisons, NOW, {
      previous: priorA.outputs,
      previousRunId: priorA.id,
      anchorStrength: 1,
    });
    expect(again.id).toBe(fromA.id);
  });

  test("effective κ falls back to the spec's anchorStrength when previous is given", () => {
    const prior = runCapabilityVectors(data.people, data.comparisons, NOW);
    const spec = { ...BRADLEY_TERRY_V1_0_0, version: "1.1.0", anchorStrength: 2 };
    const run = runCapabilityVectors(data.people, data.comparisons, NOW, {
      spec,
      previous: prior.outputs,
    });
    expect(run.parameters.anchorStrength).toBe(2);
    const noPrevious = runCapabilityVectors(data.people, data.comparisons, NOW, { spec });
    expect(noPrevious.parameters.anchorStrength).toBe(0);
  });
});

describe("runReferralSignals", () => {
  test("wraps computeAllReferralSignals with the full spec in parameters", () => {
    const run = runReferralSignals(data.people, data.referrals, NOW);
    expect(run.modelType).toBe("referral_signal_v0");
    expect(run.modelVersion).toBe("0.1.0");
    expect(run.parameters.spec).toEqual(REFERRAL_SIGNAL_V0_1_0);
    expect(run.outputs.size).toBe(data.people.length);
    expect(run.outputs.get("p-alice")?.signal).toBeGreaterThan(70);
  });
});

describe("runJudgeCalibration", () => {
  const T = new Date("2026-12-31T00:00:00.000Z");
  const input = {
    people: data.people,
    referrals: data.referrals,
    outcomes: data.outcomes,
    opportunities: data.opportunities,
    now: T,
  };

  test("records the spec, referral spec and time step; outcomes are in the input hash", () => {
    const run = runJudgeCalibration(input);
    expect(run.modelType).toBe("judge_reliability_v2");
    expect(run.modelVersion).toBe("2.0.0");
    expect(run.parameters.spec).toEqual(JUDGE_RELIABILITY_V2_0_0);
    expect(run.parameters.referralSpec).toEqual(REFERRAL_SIGNAL_V0_1_0);
    expect(run.parameters.now).toEqual(T);
    const without = runJudgeCalibration({ ...input, outcomes: [] });
    expect(without.inputHash).not.toBe(run.inputHash);
    expect(without.outputs.options.evaluatedReferrals).toBe(0);
  });

  test("a weighted Referral Signal run records the weights it used", () => {
    const calibration = runJudgeCalibration(input);
    const weighted = runReferralSignals(
      data.people,
      data.referrals,
      T,
      judgeWeightOptions(calibration.outputs),
    );
    const plain = runReferralSignals(data.people, data.referrals, T);
    expect(weighted.inputHash).toBe(plain.inputHash);
    expect(weighted.id).not.toBe(plain.id);
    expect(weighted.parameters.judgeReliability).toBeInstanceOf(Map);
    expect(plain.parameters.judgeReliability).toBeNull();
  });
});
