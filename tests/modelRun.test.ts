import { describe, expect, test } from "bun:test";
import { judgeWeightOptions } from "../src/judges/reliability.ts";
import {
  createModelRun,
  hashInputs,
  RUN_ID_FORMAT,
  runCapabilityVectors,
  runJudgeCalibration,
  runReferralSignals,
  stableStringify,
} from "../src/modelRun.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  getSpec,
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
  const base = {
    kind: "referral_signal",
    model: "referral_signal_v0",
    specVersion: "0.1.0",
    inputs: data.referrals,
    now: NOW,
  } as const;

  test("records spec, hash and outputs; same inputs + params ⇒ same id", () => {
    const params = { spec: REFERRAL_SIGNAL_V0_1_0 };
    const run1 = createModelRun({ ...base, parameters: params, outputs: 1 });
    const run2 = createModelRun({ ...base, parameters: params, outputs: 2 });
    expect(run1.id).toBe(run2.id);
    expect(run1.inputHash).toBe(run2.inputHash);
    expect(run1.parameters.spec).toEqual(REFERRAL_SIGNAL_V0_1_0);
    expect(run1.createdAt).toEqual(NOW);
    // Absence of lineage is the empty list, always present — never undefined.
    expect(run1.upstreamRuns).toEqual([]);

    const other = createModelRun({
      ...base,
      parameters: { spec: { ...REFERRAL_SIGNAL_V0_1_0, topK: 3 } },
      outputs: 1,
    });
    expect(other.id).not.toBe(run1.id);
  });

  test("the id names kind, definition, version, inputs and parameters", () => {
    const run = createModelRun({
      ...base,
      parameters: { spec: REFERRAL_SIGNAL_V0_1_0 },
      outputs: 1,
    });
    expect(RUN_ID_FORMAT).toBe(2);
    expect(run.id).toMatch(
      /^referral_signal\/referral_signal_v0@0\.1\.0:[0-9a-f]{12}:[0-9a-f]{8}$/,
    );
    expect(run.id.startsWith(`${run.kind}/`)).toBe(true);
    expect(run.id.includes(`@${run.specVersion}:`)).toBe(true);
    expect(run.id.includes(run.inputHash.slice(0, 12))).toBe(true);
  });

  test("two definitions of one kind that differ only in compute get different ids", () => {
    const shared = { ...base, parameters: { spec: REFERRAL_SIGNAL_V0_1_0 }, outputs: 1 };
    const a = createModelRun({ ...shared, model: "referral_signal_v0" });
    const b = createModelRun({ ...shared, model: "referral_signal_variant" });
    expect(a.id).not.toBe(b.id);
  });

  test("upstream lineage moves the id and is copied out of the caller's array", () => {
    const upstream = [{ role: "anchor" as const, runId: "run-a", digest: "d" }];
    const params = { spec: REFERRAL_SIGNAL_V0_1_0 };
    const plain = createModelRun({ ...base, parameters: params, outputs: 1 });
    const linked = createModelRun({
      ...base,
      parameters: params,
      outputs: 1,
      upstreamRuns: upstream,
    });
    // Same parameters, same inputs: only the lineage differs.
    expect(linked.inputHash).toBe(plain.inputHash);
    expect(linked.id).not.toBe(plain.id);

    const other = createModelRun({
      ...base,
      parameters: params,
      outputs: 1,
      upstreamRuns: [{ role: "anchor", runId: "run-b", digest: "d" }],
    });
    // Identical consumed values, different producing run ⇒ different id.
    expect(other.id).not.toBe(linked.id);

    upstream.push({ role: "anchor", runId: "run-c", digest: "d" });
    expect(linked.upstreamRuns).toHaveLength(1);
  });

  test("copies `now` so mutating the caller's Date does not move createdAt", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const run = createModelRun({ ...base, parameters: {}, outputs: 1, now });
    const id = run.id;
    now.setFullYear(1999);
    expect(run.createdAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(run.createdAt).not.toBe(now);
    expect(run.id).toBe(id);
  });
});

describe("runCapabilityVectors provenance", () => {
  test("a run without `previous` records no lineage at all", () => {
    const run = runCapabilityVectors(data.people, data.comparisons, NOW);
    expect(run.parameters.spec).toEqual(BRADLEY_TERRY_V1_0_0);
    // The anchor is lineage now, not two parameter keys.
    expect(run.upstreamRuns).toEqual([]);
    expect(run.parameters.anchorStrength).toBe(0);
    expect(run.parameters.bt).toBeNull();
    expect("previous" in run.parameters).toBe(false);
    expect(Object.keys(run.parameters).sort()).toEqual(
      ["spec", "minComparisons", "minOpponents", "tieHandling", "anchorStrength", "bt"].sort(),
    );
  });

  test("two different previous runs ⇒ same inputHash, different id and anchor digest", () => {
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
    const anchorA = fromA.upstreamRuns[0];
    const anchorB = fromB.upstreamRuns[0];
    expect(anchorA?.role).toBe("anchor");
    expect(anchorB?.role).toBe("anchor");
    expect(anchorA?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(anchorB?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(anchorA?.digest).not.toBe(anchorB?.digest);
    expect(anchorA?.runId).toBe(priorA.id);
    expect(anchorB?.runId).toBe(priorB.id);
    expect("previousRunId" in fromA.parameters).toBe(false);
    expect("previousThetaHash" in fromA.parameters).toBe(false);
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
    // Anchored without naming the producing run: recorded as unknown, never
    // as a made-up id, and the digest still pins the θ values consumed.
    expect(run.upstreamRuns[0]?.runId).toBeNull();
    expect(run.upstreamRuns[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    const noPrevious = runCapabilityVectors(data.people, data.comparisons, NOW, { spec });
    expect(noPrevious.parameters.anchorStrength).toBe(0);
  });
});

describe("runReferralSignals", () => {
  test("wraps computeAllReferralSignals with the full spec in parameters", () => {
    const run = runReferralSignals(data.people, data.referrals, NOW);
    expect(run.kind).toBe("referral_signal");
    expect(run.specVersion).toBe("0.1.0");
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
    expect(run.kind).toBe("judge_reliability");
    expect(run.specVersion).toBe("2.0.0");
    expect(run.upstreamRuns).toEqual([]);
    expect(run.parameters.spec).toEqual(JUDGE_RELIABILITY_V2_0_0);
    expect(run.parameters.referralSpec).toEqual(REFERRAL_SIGNAL_V0_1_0);
    expect(run.parameters.now).toEqual(T);
    const without = runJudgeCalibration({ ...input, outcomes: [] });
    expect(without.inputHash).not.toBe(run.inputHash);
    expect(without.outputs.options.evaluatedReferrals).toBe(0);
  });

  test("a weighted Referral Signal run records the calibration it consumed", () => {
    const calibration = runJudgeCalibration(input);
    const weighted = runReferralSignals(data.people, data.referrals, T, {
      ...judgeWeightOptions(calibration.outputs),
      judgeRunId: calibration.id,
    });
    const plain = runReferralSignals(data.people, data.referrals, T);
    expect(weighted.inputHash).toBe(plain.inputHash);
    expect(weighted.id).not.toBe(plain.id);
    // The weights are a run's output, so they are lineage, not parameters.
    expect(weighted.upstreamRuns).toHaveLength(1);
    expect(weighted.upstreamRuns[0]?.role).toBe("judge_weights");
    expect(weighted.upstreamRuns[0]?.runId).toBe(calibration.id);
    expect(weighted.upstreamRuns[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(plain.upstreamRuns).toEqual([]);
    // No composed version tag: both versions resolve through getSpec.
    expect(weighted.specVersion).toBe("0.1.0");
    expect(plain.specVersion).toBe("0.1.0");
    expect(getSpec(weighted.kind, weighted.specVersion).version).toBe("0.1.0");
  });

  test("the recorded weight digest is a snapshot: mutating the caller's map does not rewrite it", () => {
    const weights = new Map<string, number>([["p-001", 0.5]]);
    const run = runReferralSignals(data.people, data.referrals, T, { judgeReliability: weights });
    const digest = run.upstreamRuns[0]?.digest;
    weights.set("p-001", 1);
    expect(run.upstreamRuns[0]?.digest).toBe(digest);
    const other = runReferralSignals(data.people, data.referrals, T, { judgeReliability: weights });
    // Different weight values ⇒ different digest ⇒ different run id.
    expect(other.upstreamRuns[0]?.digest).not.toBe(digest);
    expect(other.id).not.toBe(run.id);
  });

  test("two calibrations at different T ⇒ different signal ids and different lineage", () => {
    const early = runJudgeCalibration({ ...input, now: new Date("2026-09-30T00:00:00.000Z") });
    const late = runJudgeCalibration({ ...input, now: T });
    expect(early.id).not.toBe(late.id);

    const fromEarly = runReferralSignals(data.people, data.referrals, T, {
      ...judgeWeightOptions(early.outputs),
      judgeRunId: early.id,
    });
    const fromLate = runReferralSignals(data.people, data.referrals, T, {
      ...judgeWeightOptions(late.outputs),
      judgeRunId: late.id,
    });

    // Format 1 gave both the byte-identical tag `0.1.0+judge_reliability`,
    // so which calibration a signal came from was unrecoverable.
    expect(fromEarly.id).not.toBe(fromLate.id);
    expect(fromEarly.upstreamRuns[0]?.runId).toBe(early.id);
    expect(fromLate.upstreamRuns[0]?.runId).toBe(late.id);
    expect(fromEarly.upstreamRuns[0]?.runId).not.toBe(fromLate.upstreamRuns[0]?.runId);
  });

  test("an option the model does not record is refused, not silently dropped", () => {
    expect(() =>
      runReferralSignals(data.people, data.referrals, T, {
        // A future scoring option (Lane C's `weighting`) that provenance does
        // not know about must fail loudly rather than collide on one id.
        weighting: { kind: "uniform" },
      } as never),
    ).toThrow(/unrecorded option "weighting"/);
  });
});
