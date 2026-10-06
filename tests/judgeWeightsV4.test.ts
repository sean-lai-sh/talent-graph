/**
 * SEA-78 — judge_reliability@4.0.0: the r10 weight scale.
 *
 * `mode: "v2"` must be the old behaviour untouched; `mode: "v4"` maps p̂ through
 * a soft-capped logit to w and weights the signal by ω = w^γ.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome, Person, Referral } from "../src/domain/types.ts";
import {
  computeJudgeCalibration,
  estimateJudgeReliability,
  judgePseudoWeight,
  judgeWeightedSignalOptions,
  reliabilityWeights,
  type ScoredPrediction,
  toJudgeCalibration,
} from "../src/judges/reliability.ts";
import { runJudgeCalibration } from "../src/models/definitions/judgeReliability.ts";
import { runReferralSignals } from "../src/models/definitions/referralSignal.ts";
import {
  JUDGE_RELIABILITY_V2_0_0,
  JUDGE_RELIABILITY_V4_0_0,
  REFERRAL_SIGNAL_V0_1_0,
  REFERRAL_SIGNAL_V0_2_0,
} from "../src/models/registry.ts";
import { assertSpec, type JudgeReliabilitySpec, validateSpec } from "../src/models/spec.ts";
import { computeAllReferralSignals, computeReferralSignal } from "../src/scoring/referralSignal.ts";
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
    const weights = reliabilityWeights(run);
    expect(weights.size).toBe(run.estimates.size);
    for (const e of run.estimates.values()) {
      expect(weights.get(e.judgeId)).toBe(e.reliability);
      expect(e.weight).toBeUndefined();
      expect(e.omega).toBeUndefined();
    }
    // A perfect judge reaches exactly 1 and the prior judge exactly 1: no clamp below 1.
    expect(weights.get("good")).toBe(1);
    expect(weights.get("silent")).toBe(1);
    expect(judgeWeightedSignalOptions(run, V2, REFERRAL_SIGNAL_V0_1_0).judgeReliability).toEqual(
      weights,
    );
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

  test("a judge with no scored referrals gets w = 0.3 and ω = 0.09", () => {
    const est = estimateJudgeReliability(["silent"], [], V4).get("silent");
    expect(est?.weight).toBe(0.3);
    expect(est?.omega).toBeCloseTo(0.09, 12);
    // Same through the full pass with no outcomes at all, and into the signal.
    const run = computeJudgeCalibration({ people, referrals, outcomes: [], now: NOW, spec: V4 });
    for (const e of run.estimates.values()) {
      expect(e.weight).toBe(0.3);
      expect(e.omega).toBeCloseTo(0.09, 12);
    }
    for (const w of reliabilityWeights(run).values()) expect(w).toBeCloseTo(0.09, 12);
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

  test("w is monotone in p_u", () => {
    // Squared error sweeps from perfect to maximally wrong; p_u falls, so w must fall.
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
    // It crosses μ0 in the right place: better than the prior is above 0.3, worse below.
    expect(ws[0]).toBeGreaterThan(0.3);
    expect(ws[ws.length - 1]).toBeLessThan(0.3);
  });

  describe("w and ω stay strictly inside (0, 1) for extreme accuracy", () => {
    // λ = 0 removes the shrink, so p̂ is exactly 1 or exactly 0.
    const extremes: [string, JudgeReliabilitySpec][] = [
      ["default cap", { ...V4, shrinkage: 0 }],
      // A huge cap makes tanh(Σ/T)·T ≈ Σ, so only the ε clamp keeps w off 0 and 1.
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
        // Perfect and maximally wrong judges end to end, through the signal.
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
      const jc = toJudgeCalibration(e, NOW);
      expect(jc.reliability).toBe(e.reliability);
      expect(jc.weight).toBe(e.weight as number);
      expect(jc.omega).toBe(e.omega as number);
      // An evaluated judge's w is p̂ mapped through the soft cap, not p̂ itself.
      if (e.evaluatedCount >= 1) expect(jc.weight).not.toBe(jc.reliability);
    }
    const silent = toJudgeCalibration(run.estimates.get("silent") as never, NOW);
    expect(silent.weight).toBe(0.3);
    expect(silent.omega).toBeCloseTo(0.09, 12);
  });

  test('mode "v2": the record has exactly the keys it always had', () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    for (const e of run.estimates.values()) {
      const jc = toJudgeCalibration(e, NOW);
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

  /** mulberry32: a fixed seed makes a failure reproducible. */
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

  /** Judge u0..u(n-1) each with a random ω in the range real v4 weights take (and beyond). */
  function omegas(r: Rng, n: number): Map<string, number> {
    return new Map(Array.from({ length: n }, (_, i) => [`u${i}`, 0.02 + r() * 0.95]));
  }

  const weighted = (refs: Referral[], om: ReadonlyMap<string, number>, c0 = C0) =>
    computeReferralSignal("cand", refs, {
      spec: NORMALIZED,
      judgeReliability: om,
      pseudoWeight: c0,
    });

  /** R_uv alone: the plain mean of one referral is its strength. */
  const strengthOf = (ref: Referral) => computeReferralSignal("cand", [ref], { spec: PLAIN }).s;

  test("a low-weight referral never lowers the signal", () => {
    const r = rng(83);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      // Fewer than K existing referrals: the new one takes a free slot. With the
      // Top-K full (ranked by ω·R) a heavier, lower-R referral can evict a lighter,
      // higher-R one and lower the signal; that case is reported on SEA-83, not asserted.
      const existing = Array.from({ length: Math.floor(r() * K) }, (_, j) => aim(`u${j}`, r));
      const added = aim(`u${existing.length}`, r);
      const om = omegas(r, existing.length + 1);
      const before = weighted(existing, om).s;
      if (strengthOf(added) < before) continue; // only a referral at or above the signal is promised
      checked++;
      const after = weighted([...existing, added], om).s;
      expect(after, `case ${i}`).toBeGreaterThanOrEqual(before - 1e-12);
    }
    expect(checked).toBeGreaterThan(500);
  });

  test("the issue's own case: a new member's equal-R referral beside a proven judge", () => {
    const strong = aim("u0", () => 0.99);
    const proven = new Map([["u0", 0.81]]);
    const both = new Map([...proven, ["u1", 0.09]]);
    const twin = { ...strong, id: "twin", referrerId: "u1" };
    const alone = weighted([strong], proven).s;
    expect(weighted([strong, twin], both).s).toBeGreaterThanOrEqual(alone);
    // The plain mean of ω·R is what the issue calls the flaw: it falls.
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
      expect(Object.keys(run.parameters).sort(), name).toEqual(want?.parameterKeys as string[]);
      expect(run.specVersion, name).toBe("0.1.0");
    }
    expect(calibration.id).toBe(golden.judge_calibration?.id as string);
  });

  test("with every ω = 1 and c0 = 0 the weighted path is the old plain mean", () => {
    const r = rng(84);
    for (let i = 0; i < 1000; i++) {
      // Up to 2K referrals, so Top-K truncation is exercised too.
      const refs = Array.from({ length: Math.floor(r() * 2 * K) }, (_, j) => aim(`u${j}`, r));
      const ones = new Map(refs.map((x) => [x.referrerId, 1]));
      const got = weighted(refs, ones, 0);
      const old = computeReferralSignal("cand", refs, { spec: PLAIN });
      expect(got.s, `case ${i}`).toBeCloseTo(old.s, 12);
      expect(got.signal, `case ${i}`).toBeCloseTo(old.signal, 10);
    }
  });

  test("monotone: raising a judge's ω never lowers the signal when their R is at or above it", () => {
    const r = rng(85);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const refs = Array.from({ length: 1 + Math.floor(r() * K) }, (_, j) => aim(`u${j}`, r));
      const om = omegas(r, refs.length);
      const j = Math.floor(r() * refs.length);
      const before = weighted(refs, om).s;
      if (strengthOf(refs[j] as Referral) < before) continue;
      checked++;
      const raised = new Map(om);
      const was = om.get(`u${j}`) as number;
      raised.set(`u${j}`, was + r() * (0.999 - was));
      expect(weighted(refs, raised).s, `case ${i}`).toBeGreaterThanOrEqual(before - 1e-12);
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
    // And it is what a v4 run carries into the signal.
    const run = (spec: JudgeReliabilitySpec) =>
      judgeWeightedSignalOptions(
        computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec }),
        spec,
        PLAIN,
      );
    expect(run(V4).pseudoWeight).toBeCloseTo(0.09, 12);
    expect(run(other).pseudoWeight).toBeCloseTo(0.064, 12);
    expect(run(V4).spec.version).toBe("0.2.0");
    // A v2 run keeps the plain mean and no c0.
    const v2 = judgeWeightedSignalOptions(
      computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 }),
      V2,
      PLAIN,
    );
    expect(v2.pseudoWeight).toBeUndefined();
    expect(v2.spec).toBe(PLAIN);
    expect(() => judgePseudoWeight(V2)).toThrow();
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
