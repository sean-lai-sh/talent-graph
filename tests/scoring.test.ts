import { describe, expect, test } from "bun:test";
import type { Person, Referral } from "../src/domain/types.ts";
import { REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import { referralPercentiles } from "../src/scoring/referralPercentile.ts";
import {
  computeAllReferralSignals,
  computeReferralSignal,
  displayReferralSignal,
} from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";
import {
  normalizeScale,
  referralStrength,
  referralStrengthBreakdown,
} from "../src/scoring/referralStrength.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let seq = 0;

function referral(overrides: Partial<Referral> = {}): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: `u-${seq}`,
    candidateId: "v",
    conviction: 5,
    confidence: 5,
    relationshipDepth: 5,
    evidenceType: "firsthand_work",
    evidenceText: "Watched them ship a hard thing.",
    createdAt: new Date(T0.getTime() + seq * 86_400_000),
    updatedAt: T0,
    ...overrides,
  };
}

function person(id: string, overrides: Partial<Person> = {}): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0, ...overrides };
}

describe("normalizeScale", () => {
  test("maps 1..5 onto 0..1", () => {
    expect(normalizeScale(1)).toBe(0);
    expect(normalizeScale(3)).toBe(0.5);
    expect(normalizeScale(5)).toBe(1);
  });
});

describe("referralStrength", () => {
  test("all-5 firsthand_work ⇒ 1; all-1 ⇒ 0; reputation all-5 ⇒ 0.6", () => {
    expect(referralStrength(referral())).toBeCloseTo(1, 12);
    expect(referralStrength(referral({ conviction: 1, confidence: 1, relationshipDepth: 1 }))).toBe(
      0,
    );
    expect(referralStrength(referral({ evidenceType: "reputation" }))).toBeCloseTo(0.6, 12);
  });

  test("weights 0.5/0.3/0.2 applied to normalised sliders", () => {
    // n = 0.75, 0.5, 0.25 ⇒ X = 0.375 + 0.15 + 0.05 = 0.575; artifact ⇒ ×0.85
    const b = referralStrengthBreakdown(
      referral({ conviction: 4, confidence: 3, relationshipDepth: 2, evidenceType: "artifact" }),
    );
    expect(b.normalized).toEqual({ conviction: 0.75, confidence: 0.5, relationshipDepth: 0.25 });
    expect(b.weighted).toBeCloseTo(0.575, 12);
    expect(b.multiplier).toBe(0.85);
    expect(b.strength).toBeCloseTo(0.575 * 0.85, 12);
  });

  test("forecastKind does not change R_uv", () => {
    const omitted = referral({
      id: "r-fk",
      referrerId: "u-fk",
      conviction: 4,
      confidence: 3,
      relationshipDepth: 2,
      evidenceType: "artifact",
    });
    const unspecified: Referral = { ...omitted, forecastKind: "unspecified" };
    const willCompound: Referral = { ...omitted, forecastKind: "will_compound" };
    expect(referralStrength(unspecified)).toBe(referralStrength(omitted));
    expect(referralStrength(willCompound)).toBe(referralStrength(omitted));
  });

  test("reads weights from the spec, not from constants", () => {
    const spec = {
      ...REFERRAL_SIGNAL_V0_1_0,
      version: "0.9.0",
      weights: { conviction: 1, confidence: 0, relationshipDepth: 0 },
    };
    const r = referral({ conviction: 5, confidence: 1, relationshipDepth: 1 });
    expect(referralStrength(r, spec)).toBeCloseTo(1, 12);
    expect(referralStrength(r)).toBeCloseTo(0.5, 12);
  });
});

describe("computeReferralSignal", () => {
  test("six incoming ⇒ only the five strongest averaged", () => {
    const rs = [
      referral({ conviction: 5 }),
      referral({ conviction: 4 }),
      referral({ conviction: 3 }),
      referral({ conviction: 2 }),
      referral({ conviction: 1 }),
      referral({ conviction: 1, evidenceType: "reputation" }), // weakest, dropped
    ];
    const res = computeReferralSignal("v", rs);
    expect(res.incomingCount).toBe(6);
    expect(res.usedCount).toBe(5);
    expect(res.contributing.map((c) => c.referral.conviction)).toEqual([5, 4, 3, 2, 1]);
    const expected = (1 + 0.875 + 0.75 + 0.625 + 0.5) / 5;
    expect(res.s).toBeCloseTo(expected, 12);
    expect(res.signal).toBeCloseTo(100 * expected, 12);
    expect(res.strongest).toBeCloseTo(1, 12);
    expect(res.firsthandCount).toBe(5);
    expect(res.evidenceTypes).toEqual(["firsthand_work", "reputation"]);
    expect(res.specVersion).toBe("0.1.0");
  });

  test("zero referrals ⇒ signal 0, strongest null, contributing empty", () => {
    const res = computeReferralSignal("v", [referral({ candidateId: "someone-else" })]);
    expect(res.signal).toBe(0);
    expect(res.s).toBe(0);
    expect(res.strongest).toBeNull();
    expect(res.contributing).toEqual([]);
    expect(res.incomingCount).toBe(0);
    expect(res.evidenceTypes).toEqual([]);
  });

  test("signal keeps float precision; displayReferralSignal rounds", () => {
    // strengths 1, 0.6, 0.6 ⇒ mean 0.7333…
    const rs = [
      referral(),
      referral({ evidenceType: "reputation" }),
      referral({ evidenceType: "reputation" }),
    ];
    const res = computeReferralSignal("v", rs);
    expect(res.signal).toBeCloseTo(73.333333333, 8);
    expect(Number.isInteger(res.signal)).toBe(false);
    expect(displayReferralSignal(res)).toBe(73);
  });

  test("ties broken by earlier createdAt then id", () => {
    const late = referral({ id: "z", createdAt: new Date("2026-03-01") });
    const early = referral({ id: "a", createdAt: new Date("2026-02-01") });
    const res = computeReferralSignal("v", [late, early], { topK: 1 });
    expect(res.contributing[0]?.referral.id).toBe("a");
  });

  test("a zero-reliability judge is dropped from Top-K and does not dilute the mean", () => {
    const trusted = referral({ referrerId: "good", conviction: 5 });
    const junk = referral({ referrerId: "bad", conviction: 5 });
    const res = computeReferralSignal("v", [trusted, junk], {
      topK: 2,
      judgeReliability: new Map([
        ["good", 1],
        ["bad", 0],
      ]),
    });
    expect(res.incomingCount).toBe(2);
    expect(res.usedCount).toBe(1);
    expect(res.contributing.map((c) => c.referral.referrerId)).toEqual(["good"]);
    expect(res.s).toBe(1);
    expect(res.strongest).toBe(1);
  });

  test("topK can come from an explicit spec", () => {
    const rs = [referral(), referral(), referral()];
    const res = computeReferralSignal("v", rs, { spec: { ...REFERRAL_SIGNAL_V0_1_0, topK: 2 } });
    expect(res.usedCount).toBe(2);
  });

  test("a defensive self-referral is ignored", () => {
    const res = computeReferralSignal("v", [referral({ referrerId: "v" })]);
    expect(res.incomingCount).toBe(0);
  });

  test("affiliation on the Person does not change the result", () => {
    const rs = [referral(), referral({ conviction: 3 })];
    const plain = computeAllReferralSignals([person("v")], rs).get("v");
    const fancy = computeAllReferralSignals(
      [person("v", { affiliation: "Very Famous Lab", bio: "Impressive" })],
      rs,
    ).get("v");
    expect(fancy).toEqual(plain as never);
  });

  test("computeAllReferralSignals covers every person, including those with none", () => {
    const all = computeAllReferralSignals([person("v"), person("w")], [referral()]);
    expect(all.get("v")?.incomingCount).toBe(1);
    expect(all.get("w")?.incomingCount).toBe(0);
    expect(all.get("w")?.signal).toBe(0);
  });

  test("rejects a spec whose weights do not sum to 1", () => {
    const bad = {
      ...REFERRAL_SIGNAL_V0_1_0,
      version: "0.9.9",
      weights: { conviction: 1, confidence: 1, relationshipDepth: 1 },
    };
    expect(() => computeReferralSignal("v", [referral()], { spec: bad })).toThrow(/sum to 1/);
  });

  test("each contributing entry carries the breakdown under the spec used", () => {
    const spec = {
      ...REFERRAL_SIGNAL_V0_1_0,
      version: "0.9.1",
      evidenceMultiplier: { ...REFERRAL_SIGNAL_V0_1_0.evidenceMultiplier, firsthand_work: 0.25 },
    };
    const rs = [referral(), referral({ conviction: 3 }), referral({ evidenceType: "reputation" })];
    const res = computeReferralSignal("v", rs, { spec });
    expect(res.contributing).toHaveLength(3);
    for (const c of res.contributing) {
      expect(c.breakdown.strength).toBe(c.strength);
      expect(c.breakdown.multiplier).toBe(spec.evidenceMultiplier[c.referral.evidenceType]);
      expect(c.breakdown.weights).toEqual(spec.weights);
    }
    const firsthand = res.contributing.filter((c) => c.referral.evidenceType === "firsthand_work");
    expect(firsthand).toHaveLength(2);
    for (const c of firsthand) expect(c.breakdown.multiplier).toBe(0.25);
    // The custom multiplier is what the default spec would not have produced.
    const plain = computeReferralSignal("v", rs);
    const plainFirsthand = plain.contributing.find(
      (c) => c.referral.evidenceType === "firsthand_work",
    );
    expect(plainFirsthand?.breakdown.multiplier).toBe(1);
  });

  test("forecastKind does not change Referral Signal", () => {
    const omitted = referral({
      id: "r-fk-sig",
      referrerId: "u-fk-sig",
      conviction: 4,
      confidence: 3,
      relationshipDepth: 2,
      evidenceType: "artifact",
    });
    const willCompound: Referral = { ...omitted, forecastKind: "will_compound" };
    const a = computeReferralSignal("v", [omitted]);
    const b = computeReferralSignal("v", [willCompound]);
    expect(b.signal).toBe(a.signal);
    expect(b.s).toBe(a.s);
    expect(b.strongest).toBe(a.strongest);
    expect(b.usedCount).toBe(a.usedCount);
  });

  test("the signature accepts referrals only (no evaluations, no comparisons)", () => {
    // Type-level: computeReferralSignal takes (personId, Referral[], opts?). If a
    // future change adds an evaluation parameter this arity assertion fails.
    expect(computeReferralSignal.length).toBe(2);
  });
});

describe("scoutWeights hook", () => {
  test("omitted map is bit-identical to no judge weights", () => {
    const rs = [
      referral({ referrerId: "a", conviction: 5 }),
      referral({ referrerId: "b", conviction: 3 }),
    ];
    const plain = computeReferralSignal("v", rs);
    const omitted = computeReferralSignal("v", rs, {});
    expect(omitted.signal).toBe(plain.signal);
    expect(omitted.s).toBe(plain.s);
    expect(omitted.usedCount).toBe(plain.usedCount);
    expect(omitted.judgeWeighted).toBe(false);
    expect(omitted.scoutWeighted).toBe(false);
    expect(omitted.contributing.map((c) => c.judge.scout)).toEqual([1, 1]);
  });

  test("missing judge in the map keeps factor 1", () => {
    const trusted = referral({ referrerId: "good", conviction: 5 });
    const other = referral({ referrerId: "also", conviction: 5 });
    const plain = computeReferralSignal("v", [trusted, other], { topK: 2 });
    const res = computeReferralSignal("v", [trusted, other], {
      topK: 2,
      scoutWeights: new Map([["someone-else", 0]]),
    });
    expect(res.signal).toBe(plain.signal);
    expect(res.s).toBe(plain.s);
    expect(res.usedCount).toBe(2);
    expect(res.judgeWeighted).toBe(true);
    expect(res.scoutWeighted).toBe(true);
    expect(res.contributing.map((c) => c.judge.scout)).toEqual([1, 1]);
  });

  test("scout weight 0 drops a top contributor from Top-K and does not dilute the mean", () => {
    const trusted = referral({ referrerId: "good", conviction: 5 });
    const junk = referral({ referrerId: "scout-zero", conviction: 5 });
    const res = computeReferralSignal("v", [trusted, junk], {
      topK: 2,
      scoutWeights: new Map([["scout-zero", 0]]),
    });
    expect(res.incomingCount).toBe(2);
    expect(res.usedCount).toBe(1);
    expect(res.contributing.map((c) => c.referral.referrerId)).toEqual(["good"]);
    expect(res.s).toBe(1);
    expect(res.strongest).toBe(1);
    expect(res.judgeWeighted).toBe(true);
    expect(res.scoutWeighted).toBe(true);
  });

  test("finite out-of-range scout weights are clipped; non-finite weights are rejected", () => {
    const r = referral({ referrerId: "u", conviction: 5 });
    const high = computeReferralSignal("v", [r], { scoutWeights: new Map([["u", 1.5]]) });
    expect(high.contributing[0]?.judge.scout).toBe(1);
    expect(high.s).toBe(1);
    const low = computeReferralSignal("v", [r], { scoutWeights: new Map([["u", -0.5]]) });
    expect(low.usedCount).toBe(0);
    expect(low.s).toBe(0);
    expect(() =>
      computeReferralSignal("v", [r], { scoutWeights: new Map([["u", Number.NaN]]) }),
    ).toThrow(/scout weight/);
  });

  test("scoutFactor multiplies reliability · clip(R − bias, 0, 1)", () => {
    const r = referral({ referrerId: "u", conviction: 5 });
    const res = computeReferralSignal("v", [r], {
      judgeReliability: new Map([["u", 0.5]]),
      judgeBias: new Map([["u", 0.2]]),
      scoutWeights: new Map([["u", 0.4]]),
    });
    const adjusted = 1 - 0.2;
    expect(res.contributing[0]?.judge.adjusted).toBeCloseTo(adjusted, 12);
    expect(res.contributing[0]?.strength).toBeCloseTo(0.4 * 0.5 * adjusted, 12);
  });

  test("no scout map on generateSeed() is bit-identical to the unweighted V0 signals", () => {
    const data = generateSeed();
    const plain = computeAllReferralSignals(data.people, data.referrals);
    const noScout = computeAllReferralSignals(data.people, data.referrals, {});
    for (const [id, left] of plain) {
      const right = noScout.get(id);
      expect(right?.signal).toBe(left.signal);
      expect(right?.s).toBe(left.s);
      expect(right?.usedCount).toBe(left.usedCount);
      expect(right?.scoutWeighted).toBe(false);
      expect(right?.judgeWeighted).toBe(false);
    }
  });
});

describe("referralPercentiles", () => {
  test("ranks only people with incoming referrals; zero-referral people are null", () => {
    const people = [person("a"), person("b"), person("c"), person("none")];
    const rs = [
      referral({ candidateId: "a" }),
      referral({ candidateId: "b", conviction: 3 }),
      referral({ candidateId: "c", conviction: 1, evidenceType: "reputation" }),
    ];
    const pct = referralPercentiles(computeAllReferralSignals(people, rs));
    expect(pct.get("a")).toBe(100);
    expect(pct.get("b")).toBe(50);
    expect(pct.get("c")).toBe(0);
    expect(pct.get("none")).toBeNull();
  });
});
