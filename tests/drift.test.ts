import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BREAKING_CROSSED_FRACTION,
  capabilityDrift,
  DEFAULT_DRIFT_THRESHOLDS,
  formatDriftReport,
  judgeReliabilityDrift,
  kendallTauB,
  referralSignalDrift,
  spearmanRho,
  topKJaccard,
} from "../src/analysis/drift.ts";
import { loadSpecs } from "../src/config.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeJudgeCalibration, judgeWeightedSignalOptions } from "../src/judges/reliability.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  JUDGE_RELIABILITY_V2_0_0,
  JUDGE_RELIABILITY_V4_0_0,
  REFERRAL_SIGNAL_V0_1_0,
} from "../src/models/registry.ts";
import type { ReferralSignalSpec } from "../src/models/spec.ts";
import { type DriftKind, driftKinds, type PipelineKind } from "../src/pipeline/advance.ts";
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

  test("a judge-weighted side is labelled as such, not as the plain spec", () => {
    // The label leak: `specVersion` is `spec.version` on both sides, so a V0
    // vs V2 comparison used to report "0.1.0 → 0.1.0" for a review-grade
    // change. Judge weighting is part of what produced the number.
    const calibration = computeJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: new Date("2026-12-31T00:00:00.000Z"),
    });
    const weighted = computeAllReferralSignals(
      data.people,
      data.referrals,
      judgeWeightedSignalOptions(calibration, JUDGE_RELIABILITY_V2_0_0, REFERRAL_SIGNAL_V0_1_0),
    );
    const r = referralSignalDrift(baseline, weighted);
    expect(r.labels.before).toBe("0.1.0");
    expect(r.labels.after).toBe("0.1.0 (judge-weighted)");
    expect(r.labels.before).not.toBe(r.labels.after);
    // The same comparison the other way round, and a plain-vs-plain one.
    expect(referralSignalDrift(weighted, baseline).labels).toEqual({
      before: "0.1.0 (judge-weighted)",
      after: "0.1.0",
    });
    expect(referralSignalDrift(baseline, baseline).labels).toEqual({
      before: "0.1.0",
      after: "0.1.0",
    });
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

/* ------------------------------------------------------------------ *
 * #55 T4 — judge-reliability drift and the drift CLI.
 * ------------------------------------------------------------------ */

describe("judgeReliabilityDrift", () => {
  const T = new Date("2026-12-31T00:00:00.000Z");
  const calibration = computeJudgeCalibration({
    people: data.people,
    referrals: data.referrals,
    outcomes: data.outcomes,
    opportunities: data.opportunities,
    now: T,
  });

  test("a run against itself is stable, on either measure", () => {
    for (const measure of ["reliability", "bias"] as const) {
      const r = judgeReliabilityDrift(calibration, calibration, measure);
      expect(r.kind).toBe("judge_reliability");
      expect(r.measure).toBe(measure);
      expect(r.kendallTau).toBeCloseTo(1, 10);
      expect(r.verdict).toBe("stable");
      expect(r.maxAbsShift).toBe(0);
      expect(formatDriftReport(r)).toContain(`judge_reliability · ${measure}`);
    }
  });

  test("a judge with no evaluated prediction has no value: missing is not low", () => {
    const r = judgeReliabilityDrift(calibration, calibration);
    const withEvidence = [...calibration.estimates.values()].filter((e) => e.evaluatedCount >= 1);
    expect(withEvidence.length).toBeGreaterThan(0);
    expect(r.n).toBe(withEvidence.length);
    expect(r.n).toBeLessThan(calibration.estimates.size);
    // The unevaluated judges are simply absent, not counted as crossings:
    // they have no value on either side.
    expect(r.crossedFraction).toBe(0);
  });

  test("a shorter observation window moves the numbers it is meant to move", () => {
    const shorter = computeJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: T,
      spec: { ...JUDGE_RELIABILITY_V2_0_0, version: "2.1.0", observationWindowDays: 30 },
    });
    const r = judgeReliabilityDrift(calibration, shorter);
    expect(r.labels).toEqual({ before: "2.0.0", after: "2.1.0" });
    expect(["stable", "review", "breaking"]).toContain(r.verdict);
  });
});

/* ------------------------------------------------------------------ *
 * SEA-78 — the w and ω measures compare the weights actually used.
 * ------------------------------------------------------------------ */

describe("judgeReliabilityDrift on w and ω", () => {
  const T = new Date("2026-12-31T00:00:00.000Z");
  const calibrate = (spec = JUDGE_RELIABILITY_V2_0_0) =>
    computeJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: T,
      spec,
    });
  const v2 = calibrate();
  const v4 = calibrate(JUDGE_RELIABILITY_V4_0_0);
  const evaluated = (run: typeof v4) =>
    [...run.estimates.values()].filter((e) => e.evaluatedCount >= 1);
  const moverOf = (r: ReturnType<typeof judgeReliabilityDrift>, judgeId: string) =>
    r.largestMovers.find((m) => m.personId === judgeId);

  test("v4 against itself is stable on w and ω", () => {
    for (const measure of ["weight", "omega"] as const) {
      const r = judgeReliabilityDrift(v4, v4, measure);
      expect(r.measure).toBe(measure);
      expect(r.verdict).toBe("stable");
      expect(r.maxAbsShift).toBe(0);
      expect(r.n).toBe(evaluated(v4).length);
      expect(formatDriftReport(r)).toContain(`judge_reliability · ${measure}`);
    }
  });

  test("the ω arm compares the weights the signal is handed, on each side", () => {
    const r = judgeReliabilityDrift(v2, v4, "omega");
    const usedBefore = judgeWeightedSignalOptions(
      v2,
      JUDGE_RELIABILITY_V2_0_0,
      REFERRAL_SIGNAL_V0_1_0,
    ).judgeReliability;
    const usedAfter = judgeWeightedSignalOptions(
      v4,
      JUDGE_RELIABILITY_V4_0_0,
      REFERRAL_SIGNAL_V0_1_0,
    ).judgeReliability;
    expect(r.largestMovers.length).toBeGreaterThan(0);
    for (const m of r.largestMovers) {
      expect(m.before).toBeCloseTo((usedBefore.get(m.personId) as number) * 100, 10);
      expect(m.after).toBeCloseTo((usedAfter.get(m.personId) as number) * 100, 10);
    }
    // ω differs from p̂ under v4, so this arm is not the reliability arm relabelled.
    const rel = judgeReliabilityDrift(v2, v4, "reliability");
    expect(r.maxAbsShift).not.toBeCloseTo(rel.maxAbsShift, 6);
  });

  test("the w arm reads w under v4, not ω and not p̂", () => {
    const r = judgeReliabilityDrift(v4, v4, "weight");
    expect(r.n).toBeGreaterThan(0);
    const e = evaluated(v4)[0];
    if (e === undefined || e.weight === undefined || e.omega === undefined) {
      throw new Error("expected a v4 estimate with w and ω");
    }
    expect(e.weight).not.toBeCloseTo(e.omega, 6);
    const shifted = {
      ...v4,
      estimates: new Map(
        [...v4.estimates].map(([id, x]) => [
          id,
          id === e.judgeId ? { ...x, weight: (x.weight as number) / 2 } : x,
        ]),
      ),
    };
    const moved = judgeReliabilityDrift(v4, shifted, "weight");
    const mover = moverOf(moved, e.judgeId);
    expect(mover?.before).toBeCloseTo(e.weight * 100, 10);
    expect(mover?.after).toBeCloseTo((e.weight / 2) * 100, 10);
    // The ω arm does not see a w-only edit.
    expect(judgeReliabilityDrift(v4, shifted, "omega").maxAbsShift).toBe(0);
  });

  test("v2 has no w or ω: read as p̂ (the weight v2 uses), never as low or zero", () => {
    for (const measure of ["weight", "omega"] as const) {
      const r = judgeReliabilityDrift(v2, v2, measure);
      const rel = judgeReliabilityDrift(v2, v2, "reliability");
      // Every evaluated judge is valued on both sides: nobody crossed, nobody is 0.
      expect(r.n).toBe(rel.n);
      expect(r.crossedFraction).toBe(0);
      expect(r.verdict).toBe("stable");
      for (const m of r.largestMovers) {
        expect(m.before).toBeCloseTo(
          (v2.estimates.get(m.personId)?.reliability as number) * 100,
          10,
        );
        expect(m.before).toBeGreaterThan(0);
      }
      // v2 → v4 is a value change for every judge, not a population change.
      const across = judgeReliabilityDrift(v2, v4, measure);
      expect(across.crossedInsufficiency).toEqual({ gained: [], lost: [] });
      expect(across.n).toBe(rel.n);
    }
  });

  test("a v4 run missing w or ω throws instead of reading as 0", () => {
    const broken = {
      ...v4,
      estimates: new Map(
        [...v4.estimates].map(([id, x]) => {
          const { omega: _omega, ...rest } = x;
          return [id, rest];
        }),
      ),
    };
    expect(() => judgeReliabilityDrift(v4, broken, "omega")).toThrow(/no omega/);
  });
});

describe("scripts/drift.ts CLI", () => {
  const script = join(import.meta.dir, "..", "scripts", "drift.ts");
  const run = (...args: string[]) =>
    Bun.spawnSync(["bun", "run", script, ...args], { cwd: join(import.meta.dir, "..") });
  const text = (b: Uint8Array) => new TextDecoder().decode(b);

  test("a kind the pipeline does not run exits 2 and names the ones it does", () => {
    const proc = run("--kind", "career_evidence", "--before", "1.0.0", "--after", "env");
    expect(proc.exitCode).toBe(2);
    const err = text(proc.stderr);
    expect(err).toContain("unknown kind career_evidence");
    for (const kind of driftKinds(loadSpecs({}, { warn: () => {} }))) {
      expect(err).toContain(kind);
    }
  });

  /**
   * Compile-time half of the same rule: a registered spec kind that
   * `LoadedSpecs` does not carry is not a `DriftKind`, so the CLI cannot
   * index the loaded specs with it. `career_evidence` is exactly that case
   * — #54 T5 registered it as a `ModelSpecKind`, and no pass evaluates it,
   * so it is not a `PipelineKind` and there is nothing to drift-compare.
   */
  test("DriftKind is exactly the kinds LoadedSpecs carries", () => {
    // @ts-expect-error a kind LoadedSpecs has no key for is not a DriftKind
    const notDriftable: DriftKind = "career_evidence";
    // @ts-expect-error a kind `advance` never runs is not a PipelineKind
    const notRun: PipelineKind = "career_evidence";
    expect(notDriftable as string).toBe("career_evidence");
    expect(notRun as string).toBe("career_evidence");
    expect(driftKinds(loadSpecs({}, { warn: () => {} }))).toEqual([
      "bradley_terry",
      "judge_reliability",
      "referral_signal",
    ]);
  });

  test("--kind judge_reliability reports both measures", () => {
    const proc = run("--kind", "judge_reliability", "--before", "2.0.0", "--after", "env");
    expect(proc.exitCode).toBe(0);
    const out = text(proc.stdout);
    expect(out).toContain("judge_reliability · reliability");
    expect(out).toContain("judge_reliability · bias");
    // The third arm: what the calibration does to the weighted signals.
    expect(out).toContain("judge_reliability · weighted referral signals");
    expect(out).toContain("Overall verdict across 3 reports:");
  });

  test("--v0-vs-v2 compares the unweighted run against the judge-weighted one", () => {
    const proc = run("--v0-vs-v2");
    expect(proc.exitCode).toBe(0);
    const out = text(proc.stdout);
    expect(out).toContain("referral_signal (0.1.0 → 0.1.0 (judge-weighted))");
    expect(out).toContain("Largest movers:");
  });

  test("--v0-vs-v2 refuses a --kind that has no V2 variant", () => {
    const proc = run("--v0-vs-v2", "--kind", "bradley_terry");
    expect(proc.exitCode).toBe(2);
    expect(text(proc.stderr)).toContain("--v0-vs-v2 compares referral_signal runs");
  });

  test("--kind referral_signal still compares the V0 runs of two specs", () => {
    const proc = run("--kind", "referral_signal", "--before", "0.1.0", "--after", "env");
    expect(proc.exitCode).toBe(0);
    expect(text(proc.stdout)).toContain("referral_signal (0.1.0 → 0.1.0)");
  });

  /**
   * The gate itself. A candidate spec is fed as JSON — `--after-json` is the
   * only way to compare against something the registry has never seen, which
   * is exactly the shape of a pull request that has not landed yet.
   */
  const fixture = (name: string) =>
    readFileSync(join(import.meta.dir, "fixtures", `${name}.json`), "utf8");

  test("a breaking weight swap exits 1", () => {
    const proc = run(
      "--kind",
      "referral_signal",
      "--before",
      "0.1.0",
      "--after-json",
      fixture("drift-breaking-weight-swap"),
    );
    const out = text(proc.stdout);
    expect(out).toContain("Verdict: BREAKING");
    expect(proc.exitCode).toBe(1);
  });

  test("a stable bump — same numbers, new version — exits 0", () => {
    const proc = run(
      "--kind",
      "referral_signal",
      "--before",
      "0.1.0",
      "--after-json",
      fixture("drift-stable-bump"),
    );
    const out = text(proc.stdout);
    expect(out).toContain("referral_signal (0.1.0 → 0.1.1+fixture)");
    expect(out).toContain("Verdict: STABLE");
    expect(proc.exitCode).toBe(0);
  });

  test("--max-verdict stable fails the breaking swap too, and breaking never fails", () => {
    const args = [
      "--kind",
      "referral_signal",
      "--before",
      "0.1.0",
      "--after-json",
      fixture("drift-breaking-weight-swap"),
    ];
    expect(run(...args, "--max-verdict", "stable").exitCode).toBe(1);
    expect(run(...args, "--max-verdict", "breaking").exitCode).toBe(0);
  });

  test("--max-verdict stable is not satisfied by a review verdict", () => {
    const proc = run("--v0-vs-v2", "--max-verdict", "stable");
    const out = text(proc.stdout);
    expect(out).toContain("Verdict: REVIEW");
    expect(proc.exitCode).toBe(1);
  });

  test("an unknown --max-verdict is a usage error, not a pass", () => {
    const proc = run(
      "--kind",
      "referral_signal",
      "--before",
      "0.1.0",
      "--after",
      "env",
      "--max-verdict",
      "nitpick",
    );
    expect(proc.exitCode).toBe(2);
    expect(text(proc.stderr)).toContain("unknown --max-verdict nitpick");
  });

  /**
   * The blind spot this arm closes: `applyBiasCorrection false → true` leaves
   * every judge's `reliability` and `bias` untouched — both maps are
   * identical, both reports are STABLE — while `advance` starts feeding that
   * nonzero bias map into the judge-weighted Referral Signal run. The two
   * per-judge reports cannot see it, because the movement is not in them.
   */
  test("a calibration spec that only moves the weighted signals is still caught", () => {
    const proc = run(
      "--kind",
      "judge_reliability",
      "--before",
      "2.0.0",
      "--after-json",
      fixture("drift-judge-bias-correction"),
    );
    const out = text(proc.stdout);
    expect(out).toContain("judge_reliability · reliability (2.0.0 → 3.0.0+fixture)");
    expect(out).toContain("judge_reliability · bias (2.0.0 → 3.0.0+fixture)");
    expect(out).toContain("judge_reliability · weighted referral signals (2.0.0 → 3.0.0+fixture)");
    expect(out).toContain("Overall verdict across 3 reports:");

    // The per-judge arms are the ones that see nothing; the weighted arm is
    // the one that moves, and the overall verdict is taken from all three.
    const sections = out.split("Drift report — ").slice(1);
    expect(sections).toHaveLength(3);
    const [reliability, bias, weighted] = sections as [string, string, string];
    for (const quiet of [reliability, bias]) {
      expect(quiet).toContain("Verdict: STABLE");
      expect(quiet).toContain("max 0.00");
    }
    const maxShift = Number(/· max (\d+\.\d+)/.exec(weighted)?.[1]);
    expect(maxShift).toBeGreaterThan(0);
    expect(weighted).not.toContain("Verdict: STABLE");
    expect(out).not.toContain("Overall verdict across 3 reports: STABLE");
  });

  test("a calibration stable bump leaves all three arms stable", () => {
    const proc = run(
      "--kind",
      "judge_reliability",
      "--before",
      "2.0.0",
      "--after-json",
      fixture("drift-judge-stable-bump"),
    );
    const out = text(proc.stdout);
    expect(out.split("Drift report — ")).toHaveLength(4);
    expect(out).toContain("judge_reliability · weighted referral signals (2.0.0 → 2.0.1+fixture)");
    expect(out).toContain("Overall verdict across 3 reports: STABLE");
    expect(out).not.toContain("Verdict: REVIEW");
    expect(out).not.toContain("Verdict: BREAKING");
    expect(proc.exitCode).toBe(0);
  });

  test("--after-json may not reuse a registered version", () => {
    const masquerade = JSON.stringify({
      ...(JSON.parse(fixture("drift-breaking-weight-swap")) as Record<string, unknown>),
      version: "0.1.0",
    });
    const proc = run("--kind", "referral_signal", "--before", "0.1.0", "--after-json", masquerade);
    expect(proc.exitCode).toBe(2);
    expect(text(proc.stderr)).toContain("referral_signal@0.1.0 is a registered version");
  });
});
