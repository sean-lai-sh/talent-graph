import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome, Person, Referral } from "../src/domain/types.ts";
import {
  computeJudgeCalibration,
  estimateJudgeReliability,
  type JudgeReliabilityEstimate,
  judgePseudoWeight,
  judgeWeightedSignalOptions,
  type ScoredPrediction,
  toJudgeCalibration,
  weightNormalizedReferralSpec,
} from "../src/judges/reliability.ts";
import { runJudgeCalibration } from "../src/models/definitions/judgeReliability.ts";
import { runReferralSignals } from "../src/models/definitions/referralSignal.ts";
import {
  JUDGE_RELIABILITY_V2_0_0,
  JUDGE_RELIABILITY_V4_0_0,
  REFERRAL_SIGNAL_V0_1_0,
  REFERRAL_SIGNAL_V0_2_0,
} from "../src/models/registry.ts";
import {
  assertSpec,
  JUDGE_WEIGHT_LOGIT_EPS,
  type JudgeReliabilitySpec,
  type ReferralSignalSpec,
  validateSpec,
} from "../src/models/spec.ts";
import { hashInputs } from "../src/provenance/hash.ts";
import { computeAllReferralSignals, computeReferralSignal } from "../src/scoring/referralSignal.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";
import { type EdgeWeighting, IDENTITY_WEIGHTING } from "../src/scoring/weighting.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(T0.getTime() + n * DAY);
const NOW = day(400);
const V2 = JUDGE_RELIABILITY_V2_0_0;
const V4 = JUDGE_RELIABILITY_V4_0_0;

let seq = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function referral(from: string, to: string, conviction: 1 | 2 | 3 | 4 | 5): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: from,
    candidateId: to,
    conviction,
    confidence: conviction,
    relationshipDepth: conviction,
    evidenceType: "firsthand_work",
    evidenceText: "Seen it.",
    createdAt: day(5),
    updatedAt: day(5),
  };
}

function outcome(personId: string, value: number): Outcome {
  seq++;
  return {
    id: `o-${seq}`,
    personId,
    opportunityId: null,
    kind: "shipped_project",
    value,
    observedAt: day(250),
    createdAt: day(250),
  };
}

/** A scored prediction with exactly the squared error the estimator folds in. */
function scored(judgeId: string, error: number, i = 0): ScoredPrediction {
  return {
    referralId: `sp-${judgeId}-${i}`,
    judgeId,
    candidateId: `c-${i}`,
    prediction: 0,
    truth: 0,
    error,
    signedError: Math.sqrt(error),
    evaluatedAt: day(200),
    label: undefined as never,
  };
}

const people = ["good", "bad", "silent", "hi", "mid", "lo"].map(person);
const outcomes = [outcome("hi", 9), outcome("mid", 5), outcome("lo", 1)];
const referrals = [
  referral("good", "hi", 5), // right on
  referral("good", "lo", 1),
  referral("bad", "lo", 5), // wrong both ways
  referral("bad", "hi", 1),
];

describe('judge_reliability mode "v2" is the compatibility branch', () => {
  test("2.0.0 is untouched: no v4 keys on the spec, mode absent reads as v2", () => {
    for (const k of ["mode", "softCap", "weightExponent"]) {
      expect(Object.hasOwn(V2, k)).toBe(false);
    }
    expect(V2.priorReliability).toBe(1);
    const explicit: JudgeReliabilitySpec = { ...V2, mode: "v2" };
    const a = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    const b = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: explicit });
    expect(a.options.reliabilityMode).toBeUndefined();
    expect(b.options.reliabilityMode).toBeUndefined();
    expect([...b.estimates.values()]).toEqual([...a.estimates.values()]);
  });

  test("signal weights are p̂ exactly (no clamp), and w and ω are absent", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    const weights = judgeWeightedSignalOptions(run, V2, REFERRAL_SIGNAL_V0_1_0).judgeReliability;
    expect(weights.size).toBe(run.estimates.size);
    for (const e of run.estimates.values()) {
      expect(weights.get(e.judgeId)).toBe(e.reliability);
      expect(e.weight).toBeUndefined();
      expect(e.omega).toBeUndefined();
    }
    expect(weights.get("good")).toBe(1);
    expect(weights.get("silent")).toBe(1);
  });
});

describe('judge_reliability@4.0.0 (mode "v4")', () => {
  test("registered spec is valid and has the r10 values", () => {
    expect(assertSpec(V4)).toBe(V4);
    expect(V4.mode).toBe("v4");
    expect(V4.priorReliability).toBe(0.3);
    expect(V4.softCap).toBe(3);
    expect(V4.weightExponent).toBe(2);
  });

  test("validateSpec rejects a v4 spec whose w or ω can reach 0 or 1 in floating point", () => {
    for (const weightExponent of [Number.MIN_VALUE, 1e-20, 1e6, Number.MAX_VALUE]) {
      const res = validateSpec({ ...V4, weightExponent });
      expect(res.ok, `γ = ${weightExponent}`).toBe(false);
    }
    expect(validateSpec({ ...V4, softCap: 1e6 }).ok).toBe(true);
    expect(validateSpec({ ...V4, softCap: 1e6, weightExponent: 1 }).ok).toBe(true);
  });

  test("validateSpec rejects a v4 μ0 outside the p̂ clamp, and every accepted μ0 maps no evidence to w = μ0", () => {
    for (const priorReliability of [1e-7, 1 - 1e-7]) {
      const res = validateSpec({ ...V4, priorReliability });
      expect(res.ok, `μ0 = ${priorReliability}`).toBe(false);
    }
    for (const priorReliability of [JUDGE_WEIGHT_LOGIT_EPS, 1 - JUDGE_WEIGHT_LOGIT_EPS, 0.3]) {
      const spec = { ...V4, priorReliability };
      expect(validateSpec(spec).ok, `μ0 = ${priorReliability}`).toBe(true);
      const est = estimateJudgeReliability(["silent"], [], spec).get("silent");
      expect(est?.weight).toBe(priorReliability);
      expect(est?.omega).toBe(priorReliability ** 2);
    }
  });

  test("a judge with no scored referrals gets w = 0.3 and ω = 0.09", () => {
    const est = estimateJudgeReliability(["silent"], [], V4).get("silent");
    expect(est?.weight).toBe(0.3);
    expect(est?.omega).toBeCloseTo(0.09, 12);
    const run = computeJudgeCalibration({ people, referrals, outcomes: [], now: NOW, spec: V4 });
    for (const e of run.estimates.values()) {
      expect(e.weight).toBe(0.3);
      expect(e.omega).toBeCloseTo(0.09, 12);
    }
    for (const w of judgeWeightedSignalOptions(
      run,
      V4,
      REFERRAL_SIGNAL_V0_1_0,
    ).judgeReliability.values())
      expect(w).toBeCloseTo(0.09, 12);
  });

  test("the signal is fed ω, not w or p̂", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V4 });
    const weights = judgeWeightedSignalOptions(run, V4, REFERRAL_SIGNAL_V0_1_0).judgeReliability;
    for (const e of run.estimates.values()) {
      expect(weights.get(e.judgeId)).toBe(e.omega as number);
      expect(e.omega).toBeCloseTo((e.weight as number) ** 2, 12);
    }
    const good = run.estimates.get("good");
    expect(good?.omega).not.toBe(good?.reliability);
  });

  test("no export hands out a weight map without its spec", async () => {
    const mod = await import("../src/judges/reliability.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "biasCorrections",
      "computeJudgeCalibration",
      "estimateJudgeReliability",
      "judgePseudoWeight",
      "judgeWeightedSignalOptions",
      "scoreReferralPredictions",
      "toJudgeBias",
      "toJudgeCalibration",
      "weightNormalizedReferralSpec",
    ]);
  });

  test('a mode "v4" run whose estimate lacks ω throws instead of weighting that judge fully', () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V4 });
    const { omega: _, ...noOmega } = run.estimates.get("good") as JudgeReliabilityEstimate;
    const broken = { ...run, estimates: new Map([...run.estimates, ["good", noOmega]]) };
    expect(() => judgeWeightedSignalOptions(broken, V4, REFERRAL_SIGNAL_V0_2_0)).toThrow(
      /good has no omega/,
    );
  });

  test('mode "v4" alone selects v4: a spec missing softCap or weightExponent throws, never v2-shaped output', () => {
    for (const missing of ["softCap", "weightExponent"] as const) {
      const spec = { ...V4, [missing]: undefined };
      expect(() => estimateJudgeReliability(["silent"], [], spec)).toThrow(/mode "v4" without/);
    }
  });

  test("w is monotone in p_u", () => {
    const errors = [0, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1];
    const ests = estimateJudgeReliability(
      errors.map((_, i) => `j${i}`),
      errors.map((e, i) => scored(`j${i}`, e)),
      V4,
    );
    const ws = errors.map((_, i) => ests.get(`j${i}`)?.weight as number);
    const ps = errors.map((_, i) => ests.get(`j${i}`)?.rawReliability as number);
    for (let i = 1; i < errors.length; i++) {
      expect(ps[i]).toBeLessThan(ps[i - 1] as number);
      expect(ws[i]).toBeLessThan(ws[i - 1] as number);
    }
    expect(ws[0]).toBeGreaterThan(0.3);
    expect(ws[ws.length - 1]).toBeLessThan(0.3);
  });

  describe("w and ω stay strictly inside (0, 1) for extreme accuracy", () => {
    const extremes: [string, JudgeReliabilitySpec][] = [
      ["default cap", { ...V4, shrinkage: 0 }],
      ["huge cap", { ...V4, shrinkage: 0, softCap: 1e6 }],
      ["huge cap, γ = 1", { ...V4, shrinkage: 0, softCap: 1e6, weightExponent: 1 }],
    ];
    for (const [label, spec] of extremes) {
      test(label, () => {
        const ests = estimateJudgeReliability(
          ["perfect", "awful"],
          [scored("perfect", 0), scored("awful", 1e9)],
          spec,
        );
        expect(ests.get("perfect")?.reliability).toBe(1);
        expect(ests.get("awful")?.reliability).toBe(0);
        for (const e of ests.values()) {
          for (const v of [e.weight as number, e.omega as number]) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThan(0);
            expect(v).toBeLessThan(1);
          }
        }
        expect(ests.get("perfect")?.weight as number).toBeGreaterThan(
          ests.get("awful")?.weight as number,
        );
      });

      test(`${label}: judgeWeighting never throws`, () => {
        const extremeOutcomes = [outcome("hi", 1_000_000), outcome("lo", -1_000_000)];
        const extremeSpec = { ...spec, errorScale: 1e9 };
        const run = computeJudgeCalibration({
          people,
          referrals,
          outcomes: extremeOutcomes,
          now: NOW,
          spec: extremeSpec,
        });
        expect(() => {
          const opts = judgeWeightedSignalOptions(run, extremeSpec, REFERRAL_SIGNAL_V0_1_0);
          const out = computeAllReferralSignals(people, referrals, opts);
          for (const s of out.values()) expect(Number.isFinite(s.signal)).toBe(true);
        }).not.toThrow();
      });
    }
  });
});

describe("persisted JudgeCalibration carries w and ω (SEA-78 b)", () => {
  test('mode "v4": reliability stays p̂⁰, w and ω are new fields', () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V4 });
    for (const e of run.estimates.values()) {
      const jc = toJudgeCalibration(e, run.options, NOW);
      expect(jc.reliability).toBe(e.reliability);
      expect(jc.weight).toBe(e.weight as number);
      expect(jc.omega).toBe(e.omega as number);
      if (e.evaluatedCount >= 1) expect(jc.weight).not.toBe(jc.reliability);
    }
    const silent = toJudgeCalibration(run.estimates.get("silent") as never, run.options, NOW);
    expect(silent.weight).toBe(0.3);
    expect(silent.omega).toBeCloseTo(0.09, 12);
  });

  test('a mode "v4" estimate lacking w or ω throws instead of persisting a v2-shaped record', () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V4 });
    const good = run.estimates.get("good") as JudgeReliabilityEstimate;
    const { omega: _o, ...noOmega } = good;
    const { weight: _w, ...noWeight } = good;
    expect(() => toJudgeCalibration(noOmega, run.options, NOW)).toThrow(
      /good has no omega.*4\.0\.0/,
    );
    expect(() => toJudgeCalibration(noWeight, run.options, NOW)).toThrow(
      /good has no weight.*4\.0\.0/,
    );
  });

  test('mode "v2": the record has exactly the keys it always had', () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    for (const e of run.estimates.values()) {
      const jc = toJudgeCalibration(e, run.options, NOW);
      expect(Object.keys(jc).sort()).toEqual(
        ["dimension", "id", "judgeId", "observationCount", "reliability", "updatedAt"].sort(),
      );
    }
  });
});

describe("Referral Signal weight-normalised aggregation (SEA-83)", () => {
  const PLAIN = REFERRAL_SIGNAL_V0_1_0;
  const NORMALIZED = REFERRAL_SIGNAL_V0_2_0;
  const C0 = judgePseudoWeight(V4);
  const K = NORMALIZED.topK;

  function rng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  type Rng = () => number;
  const pick = (r: Rng, n: number) => 1 + Math.floor(r() * n);
  const EVIDENCE = [
    "firsthand_work",
    "firsthand_personal",
    "artifact",
    "reputation",
    "other",
  ] as const;

  function aim(from: string, r: Rng): Referral {
    const base = referral(from, "cand", pick(r, 5) as 1 | 2 | 3 | 4 | 5);
    return {
      ...base,
      confidence: pick(r, 5) as 1 | 2 | 3 | 4 | 5,
      relationshipDepth: pick(r, 5) as 1 | 2 | 3 | 4 | 5,
      evidenceType: EVIDENCE[pick(r, EVIDENCE.length) - 1] as Referral["evidenceType"],
    };
  }

  function omegas(r: Rng, n: number): Map<string, number> {
    return new Map(Array.from({ length: n }, (_, i) => [`u${i}`, 0.02 + r() * 0.95]));
  }

  function biases(r: Rng, n: number): Map<string, number> {
    return new Map(Array.from({ length: n }, (_, i) => [`u${i}`, -0.3 + r() * 0.6]));
  }

  const weighted = (
    refs: Referral[],
    om: ReadonlyMap<string, number>,
    c0 = C0,
    bias?: ReadonlyMap<string, number>,
  ) =>
    computeReferralSignal("cand", refs, {
      spec: NORMALIZED,
      judgeReliability: om,
      ...(bias === undefined ? {} : { judgeBias: bias }),
      pseudoWeight: c0,
    });

  const strengthOf = (ref: Referral) => referralStrength(ref, PLAIN);

  const adjustedOf = (ref: Referral, bias: ReadonlyMap<string, number>) =>
    Math.min(1, Math.max(0, strengthOf(ref) - (bias.get(ref.referrerId) ?? 0)));

  test("while the Top-K has room, a referral whose adjusted R is at or above the current signal never lowers it", () => {
    const r = rng(83);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      // The full-Top-K eviction case is reported on SEA-83, not asserted.
      const existing = Array.from({ length: Math.floor(r() * K) }, (_, j) => aim(`u${j}`, r));
      const added = aim(`u${existing.length}`, r);
      const om = omegas(r, existing.length + 1);
      const bias = biases(r, existing.length + 1);
      const before = weighted(existing, om, C0, bias).s;
      if (adjustedOf(added, bias) < before) continue;
      checked++;
      const after = weighted([...existing, added], om, C0, bias).s;
      expect(after, `case ${i}`).toBeGreaterThanOrEqual(before - 1e-12);
    }
    expect(checked).toBeGreaterThan(500);
  });

  test("raw R at or above the signal is not the promise: bias can pull adjusted R below it", () => {
    const top = (from: string): Referral => ({
      ...referral(from, "cand", 5),
      confidence: 5,
      relationshipDepth: 5,
    });
    const om = new Map([
      ["a", 0.81],
      ["b", 0.5],
    ]);
    const bias = new Map([["b", 0.9]]);
    const before = weighted([top("a")], om, C0, bias).s;
    expect(strengthOf(top("b"))).toBeGreaterThanOrEqual(before);
    expect(weighted([top("a"), top("b")], om, C0, bias).s).toBeLessThan(before);
  });

  test("the issue's own case: a new member's equal-R referral beside a proven judge", () => {
    const strong = aim("u0", () => 0.99);
    const proven = new Map([["u0", 0.81]]);
    const both = new Map([...proven, ["u1", 0.09]]);
    const twin = { ...strong, id: "twin", referrerId: "u1" };
    const alone = weighted([strong], proven).s;
    expect(weighted([strong, twin], both).s).toBeGreaterThanOrEqual(alone);
    const plain = computeReferralSignal("cand", [strong, twin], {
      spec: PLAIN,
      judgeReliability: both,
    }).s;
    expect(plain).toBeLessThan(
      computeReferralSignal("cand", [strong], { spec: PLAIN, judgeReliability: proven }).s,
    );
  });

  test("V0 and V2 outputs and run ids are unchanged", () => {
    const golden = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures", "run-ids-golden.json"), "utf8"),
    ) as Record<string, { id: string; outputsHash: string; parameterKeys: string[] }>;
    const data = generateSeed();
    const T = new Date("2026-12-31T00:00:00.000Z");
    const v0 = runReferralSignals(
      data.people,
      data.referrals,
      new Date("2026-06-01T00:00:00.000Z"),
    );
    const calibration = runJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: T,
    });
    const v2 = runReferralSignals(data.people, data.referrals, T, {
      ...judgeWeightedSignalOptions(calibration.outputs, V2, PLAIN),
      judgeRunId: calibration.id,
    });
    for (const [name, run] of [
      ["referral_signal", v0],
      ["referral_signal_judge_weighted", v2],
    ] as const) {
      const want = golden[name];
      expect(run.id, name).toBe(want?.id as string);
      expect(hashInputs(run.outputs), name).toBe(want?.outputsHash as string);
      expect(Object.keys(run.parameters).sort(), name).toEqual(want?.parameterKeys as string[]);
      expect(run.specVersion, name).toBe("0.1.0");
    }
    expect(calibration.id).toBe(golden.judge_calibration?.id as string);
  });

  test("with every ω = 1 and c0 = 0 the weighted path is the old plain mean", () => {
    const r = rng(84);
    for (let i = 0; i < 1000; i++) {
      const refs = Array.from({ length: Math.floor(r() * 2 * K) }, (_, j) => aim(`u${j}`, r));
      const ones = new Map(refs.map((x) => [x.referrerId, 1]));
      const got = weighted(refs, ones, 0);
      const old = computeReferralSignal("cand", refs, { spec: PLAIN });
      expect(got.s, `case ${i}`).toBeCloseTo(old.s, 12);
      expect(got.signal, `case ${i}`).toBeCloseTo(old.signal, 10);
    }
  });

  test("while every referral fits in the Top-K, raising ω for a judge whose adjusted R is at or above the signal never lowers it", () => {
    const r = rng(85);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const refs = Array.from({ length: 1 + Math.floor(r() * K) }, (_, j) => aim(`u${j}`, r));
      const om = omegas(r, refs.length);
      const bias = biases(r, refs.length);
      const j = Math.floor(r() * refs.length);
      const before = weighted(refs, om, C0, bias).s;
      if (adjustedOf(refs[j] as Referral, bias) < before) continue;
      checked++;
      const raised = new Map(om);
      const was = om.get(`u${j}`) as number;
      raised.set(`u${j}`, was + r() * (0.999 - was));
      expect(weighted(refs, raised, C0, bias).s, `case ${i}`).toBeGreaterThanOrEqual(
        before - 1e-12,
      );
    }
    expect(checked).toBeGreaterThan(500);
  });

  test("the worked examples: 74, 67 and 90", () => {
    const top = (from: string): Referral => ({
      ...referral(from, "cand", 5),
      confidence: 5,
      relationshipDepth: 5,
      evidenceType: "firsthand_work",
    });
    expect(strengthOf(top("x"))).toBe(1);
    expect(C0).toBeCloseTo(0.09, 12);
    const one = weighted([top("a")], new Map([["a", 0.25]])).signal;
    const two = weighted(
      [top("a"), top("b")],
      new Map([
        ["a", 0.09],
        ["b", 0.09],
      ]),
    ).signal;
    const proven = weighted([top("a")], new Map([["a", 0.81]])).signal;
    expect(Math.round(one)).toBe(74);
    expect(Math.round(two)).toBe(67);
    expect(Math.round(proven)).toBe(90);
  });

  test("c0 is derived from the judge spec, not fixed", () => {
    expect(judgePseudoWeight(V4)).toBeCloseTo(0.3 ** 2, 12);
    const other: JudgeReliabilitySpec = { ...V4, priorReliability: 0.4, weightExponent: 3 };
    expect(validateSpec(other).ok).toBe(true);
    expect(judgePseudoWeight(other)).toBeCloseTo(0.4 ** 3, 12);
    expect(judgePseudoWeight({ ...V4, weightExponent: 1 })).toBeCloseTo(0.3, 12);
    const run = (spec: JudgeReliabilitySpec) =>
      judgeWeightedSignalOptions(
        computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec }),
        spec,
        PLAIN,
      );
    expect(run(V4).pseudoWeight).toBeCloseTo(0.09, 12);
    expect(run(other).pseudoWeight).toBeCloseTo(0.064, 12);
    expect(run(V4).spec.version).toBe("0.2.0");
    const v2 = judgeWeightedSignalOptions(
      computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 }),
      V2,
      PLAIN,
    );
    expect(v2.pseudoWeight).toBeUndefined();
    expect(v2.spec).toBe(PLAIN);
    expect(() => judgePseudoWeight(V2)).toThrow();
  });

  test("a spec relabeled with the other mode's version is refused, not mixed", () => {
    const v4Run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V4 });
    const v2Run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    const v2AsV4: JudgeReliabilitySpec = { ...V2, version: V4.version };
    expect(() => judgeWeightedSignalOptions(v4Run, v2AsV4, PLAIN)).toThrow(/mode "v4".*mode "v2"/);
    const v4AsV2: JudgeReliabilitySpec = { ...V4, version: V2.version };
    expect(() => judgeWeightedSignalOptions(v2Run, v4AsV2, PLAIN)).toThrow(/mode "v2".*mode "v4"/);
  });

  test('a mode "v2" judge spec refuses a weight-normalised referral spec up front', () => {
    const v2Run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    expect(() => judgeWeightedSignalOptions(v2Run, V2, NORMALIZED)).toThrow(
      /judge_reliability@2\.0\.0 is mode "v2".*referral_signal@0\.2\.0/,
    );
  });

  test("a different c0 gives a different signal and a different run id", () => {
    const refs = [aim("u0", rng(1))];
    const om = new Map([["u0", 0.25]]);
    expect(weighted(refs, om, 0.09).s).not.toBe(weighted(refs, om, 0.5).s);
    const data = generateSeed();
    const run = (c0: number) =>
      runReferralSignals(data.people, data.referrals, NOW, {
        spec: NORMALIZED,
        judgeReliability: new Map(),
        pseudoWeight: c0,
      }).id;
    expect(run(0.09)).not.toBe(run(0.5));
  });
});

describe("weightNormalizedReferralSpec (SEA-83)", () => {
  const reversed = (o: object) => Object.fromEntries(Object.entries(o).reverse());

  test("0.1.0 with its keys in another order maps to the registered 0.2.0, not +env", () => {
    const reordered = reversed(
      Object.fromEntries(
        Object.entries(REFERRAL_SIGNAL_V0_1_0).map(([k, v]) => [
          k,
          typeof v === "object" ? reversed(v) : v,
        ]),
      ),
    ) as ReferralSignalSpec;
    expect(weightNormalizedReferralSpec(reordered)).toBe(REFERRAL_SIGNAL_V0_2_0);
  });

  test("0.1.0 with an env override maps to 0.2.0+env and keeps the override", () => {
    const got = weightNormalizedReferralSpec({
      ...REFERRAL_SIGNAL_V0_1_0,
      version: "0.1.0+env",
      topK: 3,
    });
    expect(got.version).toBe("0.2.0+env");
    expect(got.topK).toBe(3);
    expect(got.aggregation).toBe("weight_normalized");
  });
});

describe("referral_signal@0.2.0 is confined to the judge-weighted path (SEA-83)", () => {
  const NORMALIZED = REFERRAL_SIGNAL_V0_2_0;
  const C0 = judgePseudoWeight(V4);
  const refs = [referral("u0", "cand", 4), referral("u1", "cand", 3)];
  const custom = (factors: Record<string, number>): EdgeWeighting => ({
    kind: "custom",
    weighted: true,
    weigh: (edge) => ({ contribution: edge.strength, eligible: true, factors }),
  });

  test("the identity weighting is refused", () => {
    expect(() =>
      computeReferralSignal("cand", refs, {
        spec: NORMALIZED,
        weighting: IDENTITY_WEIGHTING,
        pseudoWeight: C0,
      }),
    ).toThrow(/judge-weighted path only.*"identity"/);
  });

  test("a run with no judge maps is refused rather than labelled 0.2.0", () => {
    const data = generateSeed();
    expect(() =>
      runReferralSignals(data.people, data.referrals, NOW, {
        spec: NORMALIZED,
        pseudoWeight: C0,
      }),
    ).toThrow(/judge-weighted path only/);
  });

  test("a custom weighting that reports no reliability is refused", () => {
    expect(() =>
      computeReferralSignal("cand", refs, {
        spec: NORMALIZED,
        weighting: custom({ adjusted: 0.5 }),
        pseudoWeight: C0,
      }),
    ).toThrow(/"custom" weighting reports none/);
  });

  test("an eligible zero-reliability edge with c0 = 0 is refused, not divided by zero", () => {
    expect(() =>
      computeReferralSignal("cand", refs, {
        spec: NORMALIZED,
        weighting: custom({ reliability: 0 }),
        pseudoWeight: 0,
      }),
    ).toThrow(/denominator 0; Σω \+ c0 must be finite and > 0/);
  });

  test("the judge-weighted path still scores ΣωR / (Σω + c0)", () => {
    const om = new Map([
      ["u0", 0.81],
      ["u1", 0.25],
    ]);
    const got = computeReferralSignal("cand", refs, {
      spec: NORMALIZED,
      judgeReliability: om,
      pseudoWeight: C0,
    });
    const [a, b] = refs.map((r) => referralStrength(r, NORMALIZED)) as [number, number];
    expect(got.judgeWeighted).toBe(true);
    expect(got.s).toBeCloseTo((0.81 * a + 0.25 * b) / (0.81 + 0.25 + C0), 12);
  });
});
