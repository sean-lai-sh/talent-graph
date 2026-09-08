import { describe, expect, test } from "bun:test";
import {
  BREAKING_CROSSED_FRACTION,
  capabilityDrift,
  DEFAULT_DRIFT_THRESHOLDS,
  formatDriftReport,
  kendallTauB,
  referralSignalDrift,
  spearmanRho,
  topKJaccard,
} from "../src/analysis/drift.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { BRADLEY_TERRY_V1_0_0, REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import type { ReferralSignalSpec } from "../src/models/spec.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";

const data = generateSeed();
const baseline = computeAllReferralSignals(data.people, data.referrals);

function withWeights(
  conviction: number,
  confidence: number,
  relationshipDepth: number,
): ReferralSignalSpec {
  return {
    ...REFERRAL_SIGNAL_V0_1_0,
    version: "0.2.0",
    weights: { conviction, confidence, relationshipDepth },
  };
}

describe("rank statistics", () => {
  test("identical inputs ⇒ τ = ρ = 1, even with ties", () => {
    const x = [1, 2, 2, 3, 5, 5, 5];
    expect(kendallTauB(x, x)).toBe(1);
    expect(spearmanRho(x, x)).toBeCloseTo(1, 12);
  });

  test("reversed inputs ⇒ τ = ρ = −1", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [5, 4, 3, 2, 1];
    expect(kendallTauB(x, y)).toBe(-1);
    expect(spearmanRho(x, y)).toBeCloseTo(-1, 12);
  });

  test("known τ_b value", () => {
    // x: 1 2 3 4 ; y: 1 3 2 4 ⇒ 5 concordant, 1 discordant ⇒ 4/6
    expect(kendallTauB([1, 2, 3, 4], [1, 3, 2, 4])).toBeCloseTo(4 / 6, 12);
  });

  test("top-K Jaccard", () => {
    const a = new Map([
      ["p", 3],
      ["q", 2],
      ["r", 1],
      ["s", 0],
    ]);
    const b = new Map([
      ["p", 3],
      ["q", 2],
      ["s", 1],
      ["r", 0],
    ]);
    expect(topKJaccard(a, b, 2)).toBe(1);
    expect(topKJaccard(a, b, 3)).toBe(0.5);
    expect(topKJaccard(a, b, 10)).toBe(1);
  });
});

describe("referralSignalDrift", () => {
  test("same spec ⇒ τ = 1, Jaccard = 1, verdict stable, no movers", () => {
    const r = referralSignalDrift(baseline, computeAllReferralSignals(data.people, data.referrals));
    expect(r.kendallTau).toBe(1);
    expect(r.spearman).toBeCloseTo(1, 12);
    expect(r.topKJaccard[10]).toBe(1);
    expect(r.topKJaccard[25]).toBe(1);
    expect(r.maxAbsShift).toBe(0);
    expect(r.verdict).toBe("stable");
    expect(r.crossedInsufficiency).toEqual({ gained: [], lost: [] });
    expect(r.crossedFraction).toBe(0);
    expect(r.n).toBe(data.people.filter((p) => baseline.get(p.id)?.incomingCount).length);
    expect(r.labels).toEqual({ before: "0.1.0", after: "0.1.0" });
  });

  test("small tweak 0.45/0.35/0.20 ⇒ stable or review, never breaking", () => {
    const after = computeAllReferralSignals(data.people, data.referrals, {
      spec: withWeights(0.45, 0.35, 0.2),
    });
    const r = referralSignalDrift(baseline, after);
    expect(["stable", "review"]).toContain(r.verdict);
    expect(r.kendallTau).toBeGreaterThan(0.85);
  });

  test("swap 0.2/0.3/0.5 ⇒ review or breaking with movers", () => {
    const after = computeAllReferralSignals(data.people, data.referrals, {
      spec: withWeights(0.2, 0.3, 0.5),
    });
    const r = referralSignalDrift(baseline, after);
    expect(["review", "breaking"]).toContain(r.verdict);
    expect(r.largestMovers.length).toBeGreaterThan(0);
    expect(r.largestMovers.length).toBeLessThanOrEqual(10);
    expect(Math.abs(r.largestMovers[0]?.delta ?? 0)).toBe(r.maxAbsShift);
    expect(r.labels.after).toBe("0.2.0");
  });

  test("people with zero referrals are excluded from n on both sides", () => {
    const r = referralSignalDrift(baseline, baseline);
    for (const m of r.largestMovers)
      expect(baseline.get(m.personId)?.incomingCount).toBeGreaterThan(0);
  });

  test("formatDriftReport is human-readable", () => {
    const text = formatDriftReport(referralSignalDrift(baseline, baseline));
    expect(text).toContain("Drift report — referral_signal");
    expect(text).toContain("Verdict: STABLE");
    expect(text).toContain("Kendall τ_b 1.000");
  });
});

describe("capabilityDrift", () => {
  const before = computeCapabilityVectors(data.people, data.comparisons);

  test("same spec ⇒ stable", () => {
    const after = computeCapabilityVectors(data.people, data.comparisons);
    const r = capabilityDrift(before, after, "problem_solving");
    expect(r.verdict).toBe("stable");
    expect(r.kendallTau).toBe(1);
    expect(r.dimension).toBe("problem_solving");
    expect(r.n).toBeGreaterThan(5);
  });

  test("raising minComparisons moves people across the insufficiency boundary", () => {
    const after = computeCapabilityVectors(data.people, data.comparisons, {
      spec: { ...BRADLEY_TERRY_V1_0_0, version: "1.1.0", minComparisons: 8 },
    });
    const r = capabilityDrift(before, after, "problem_solving");
    expect(r.crossedInsufficiency.lost.length).toBeGreaterThan(0);
    expect(r.crossedInsufficiency.gained).toEqual([]);
    expect(r.labels.after).toBe("1.1.0");
    expect(formatDriftReport(r)).toContain("lost");
    // The survivors keep their order (τ stays high), but dropping people out
    // of the estimable set is itself a change the verdict must not call stable.
    const crossed = r.crossedInsufficiency.gained.length + r.crossedInsufficiency.lost.length;
    expect(r.crossedFraction).toBeCloseTo(crossed / (r.n + crossed), 12);
    expect(r.crossedFraction).toBeGreaterThan(DEFAULT_DRIFT_THRESHOLDS.maxCrossedFraction);
    expect(r.verdict).not.toBe("stable");
  });

  test("crossing more than the breaking fraction is breaking even with perfect τ", () => {
    // A threshold nobody meets empties the after-side entirely: everyone is lost.
    const after = computeCapabilityVectors(data.people, data.comparisons, {
      spec: { ...BRADLEY_TERRY_V1_0_0, version: "1.3.0", minComparisons: 1000 },
    });
    const r = capabilityDrift(before, after, "problem_solving");
    expect(r.n).toBe(0);
    expect(r.kendallTau).toBe(1);
    expect(r.crossedFraction).toBe(1);
    expect(r.crossedFraction).toBeGreaterThan(BREAKING_CROSSED_FRACTION);
    expect(r.verdict).toBe("breaking");
    expect(formatDriftReport(r)).toContain(`breaking > ${BREAKING_CROSSED_FRACTION}`);
  });

  test("default thresholds include the crossed-fraction bound", () => {
    expect(DEFAULT_DRIFT_THRESHOLDS.maxCrossedFraction).toBe(0.1);
    expect(BREAKING_CROSSED_FRACTION).toBe(0.3);
    const text = formatDriftReport(capabilityDrift(before, before, "agency"));
    expect(text).toContain("Crossed insufficiency: 0.00 of");
  });

  test("a much larger λ compresses θ but is measured in percentile space", () => {
    const after = computeCapabilityVectors(data.people, data.comparisons, {
      spec: { ...BRADLEY_TERRY_V1_0_0, version: "1.2.0", regularization: 2 },
    });
    const r = capabilityDrift(before, after, "problem_solving");
    expect(r.n).toBeGreaterThan(5);
    expect(r.kendallTau).toBeGreaterThan(0.5);
    expect(["stable", "review", "breaking"]).toContain(r.verdict);
  });
});
