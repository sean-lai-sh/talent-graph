import { describe, expect, test } from "bun:test";
import {
  createModelRun,
  hashInputs,
  runReferralSignals,
  stableStringify,
} from "../src/modelRun.ts";
import { REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
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
    expect(run1.createdAt).toBe(NOW);

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
