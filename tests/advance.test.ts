/**
 * `advance()` — the one place the calibration → weights → signal order is
 * written — plus the `bun run demo` golden.
 *
 * The golden is a byte-for-byte capture of the script's stdout. `demo.ts`
 * never reads the clock (it pins T and the profile epoch as literals), so the
 * only thing that could move the bytes is a `TG_*` override in the ambient
 * environment: the spawn below strips those keys, and nothing else about the
 * output depends on when it runs.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_ENV_KEYS, loadSpecs } from "../src/config.ts";
import { DIMENSIONS } from "../src/domain/constants.ts";
import type { Referral } from "../src/domain/types.ts";
import {
  advance,
  baselineReferralRun,
  judgeWeightedReferralRun,
  type Observations,
} from "../src/pipeline/advance.ts";
import { generateSeed } from "../src/seed/generate.ts";

const ROOT = join(import.meta.dir, "..");
const GOLDEN = join(ROOT, "tests", "fixtures", "demo-golden.txt");
const RUN_IDS = join(ROOT, "tests", "fixtures", "run-ids-golden.json");

/** The evaluation time step demo.ts pins; the golden run ids use it too. */
const T = new Date("2026-12-31T00:00:00.000Z");

/** Explicit specs: registered current versions, never the ambient env. */
const specs = loadSpecs({}, { warn: () => {} });

const data = generateSeed();
const observations: Observations = {
  people: data.people,
  referrals: data.referrals,
  comparisons: data.comparisons,
  outcomes: data.outcomes,
  opportunities: data.opportunities,
};

describe("bun run demo is byte-identical to the committed golden", () => {
  test("stdout matches tests/fixtures/demo-golden.txt", () => {
    // `TG_*` overrides would legitimately change the numbers; the golden is
    // the un-overridden run, so the child starts without them.
    const env: Record<string, string> = {};
    const banned = new Set<string>(Object.values(CONFIG_ENV_KEYS));
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !banned.has(k)) env[k] = v;
    }
    const proc = Bun.spawnSync(["bun", "run", join(ROOT, "scripts", "demo.ts")], {
      cwd: ROOT,
      env,
    });
    expect(new TextDecoder().decode(proc.stderr)).toBe("");
    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout)).toBe(readFileSync(GOLDEN, "utf8"));
  });
});

describe("advance returns one run per kind", () => {
  const result = advance(null, observations, specs, T);

  test("state.runs has a key for every kind that ran, and only those", () => {
    expect(Object.keys(result.state.runs).sort()).toEqual([
      "bradley_terry",
      "judge_reliability",
      "referral_signal",
    ]);
    for (const [kind, run] of Object.entries(result.state.runs)) {
      expect(run, kind).toBeDefined();
      expect((run as { kind: string }).kind).toBe(kind);
    }
  });

  test("no key is present with an undefined value (absence is the shape)", () => {
    const sparse = advance(null, { ...observations, comparisons: [] }, specs, T);
    for (const [kind, run] of Object.entries(sparse.state.runs)) {
      expect(run, `${kind} present but undefined`).not.toBeUndefined();
    }
  });

  test("the V0 baseline and the judge-weighted run are told apart by lineage", () => {
    const baseline = baselineReferralRun(result);
    const weighted = judgeWeightedReferralRun(result);
    expect(baseline.upstreamRuns).toEqual([]);
    expect(weighted.upstreamRuns.some((u) => u.role === "judge_weights")).toBe(true);
    expect(weighted.upstreamRuns[0]?.runId).toBe(result.state.runs.judge_reliability?.id as string);
    // Two runs of one kind, never one run merging two kinds.
    for (const run of result.runs) {
      expect(["referral_signal", "bradley_terry", "judge_reliability"]).toContain(run.kind);
    }
  });

  test("calibration is evaluated before the judge-weighted signal run", () => {
    const ids = result.runs.map((r) => r.id);
    const calibration = result.state.runs.judge_reliability?.id as string;
    const weighted = judgeWeightedReferralRun(result).id;
    expect(ids.indexOf(calibration)).toBeLessThan(ids.indexOf(weighted));
  });
});

describe("advance reproduces the golden run ids", () => {
  const golden = JSON.parse(readFileSync(RUN_IDS, "utf8")) as Record<string, { id: string }>;
  const result = advance(null, observations, specs, T);

  test("referral_signal (plain), judge_reliability, bradley_terry and the weighted run", () => {
    expect(baselineReferralRun(result).id).toBe(golden.referral_signal?.id as string);
    expect(result.state.runs.judge_reliability?.id).toBe(golden.judge_calibration?.id as string);
    expect(result.state.runs.bradley_terry?.id).toBe(golden.capability?.id as string);
    expect(judgeWeightedReferralRun(result).id).toBe(
      golden.referral_signal_judge_weighted?.id as string,
    );
  });
});

describe("asOf drops referrals made after `now`", () => {
  const future: Referral = {
    id: "ref-from-the-future",
    referrerId: data.people[0]?.id as string,
    candidateId: data.people[1]?.id as string,
    conviction: 5,
    confidence: 5,
    relationshipDepth: 5,
    evidenceType: "firsthand_work",
    evidenceText: "made after the evaluation time step",
    createdAt: new Date(T.getTime() + 86_400_000),
    updatedAt: new Date(T.getTime() + 86_400_000),
  };
  const withFuture: Observations = {
    ...observations,
    referrals: [...data.referrals, future],
  };
  const plain = advance(null, observations, specs, T);

  test("asOf true excludes it: the run is the one the seed alone produces", () => {
    const asOf = advance(null, withFuture, specs, T, { asOf: true });
    expect(baselineReferralRun(asOf).inputHash).toBe(baselineReferralRun(plain).inputHash);
    expect(baselineReferralRun(asOf).id).toBe(baselineReferralRun(plain).id);
  });

  test("asOf false (the default) includes it", () => {
    const included = advance(null, withFuture, specs, T, { asOf: false });
    expect(baselineReferralRun(included).inputHash).not.toBe(baselineReferralRun(plain).inputHash);
    expect(baselineReferralRun(advance(null, withFuture, specs, T)).inputHash).toBe(
      baselineReferralRun(included).inputHash,
    );
  });
});

describe("anchor refits the capability fit on the previous run", () => {
  const first = advance(null, observations, specs, T);

  test("anchor true records the previous run as `anchor` lineage", () => {
    const second = advance(first.state, observations, specs, T, { anchor: true });
    const anchored = second.state.runs.bradley_terry;
    expect(anchored?.upstreamRuns.map((u) => u.role)).toEqual(["anchor"]);
    expect(anchored?.upstreamRuns[0]?.runId).toBe(first.state.runs.bradley_terry?.id as string);
    expect(anchored?.outputs.options.anchored).toBe(true);
  });

  test("anchor default false leaves the refit unanchored", () => {
    const second = advance(first.state, observations, specs, T);
    expect(second.state.runs.bradley_terry?.upstreamRuns).toEqual([]);
    expect(second.state.runs.bradley_terry?.id).toBe(first.state.runs.bradley_terry?.id as string);
  });

  test("anchor true with no previous run is simply unanchored", () => {
    const cold = advance(null, observations, specs, T, { anchor: true });
    expect(cold.state.runs.bradley_terry?.upstreamRuns).toEqual([]);
  });
});

describe("drift", () => {
  const first = advance(null, observations, specs, T);

  test("no previous state ⇒ nothing to compare", () => {
    expect(first.drift).toEqual([]);
  });

  test("drift false skips the comparison entirely", () => {
    expect(advance(first.state, observations, specs, T, { drift: false }).drift).toEqual([]);
  });

  test("a previous state ⇒ one report per kind (per dimension for capability)", () => {
    const second = advance(first.state, observations, specs, T);
    const kinds = second.drift.map((r) => r.kind);
    expect(kinds).toContain("referral_signal");
    expect(kinds).toContain("bradley_terry");
    expect(kinds).toContain("judge_reliability");
    expect(kinds.filter((k) => k === "bradley_terry")).toHaveLength(DIMENSIONS.length);
    // Same observations, same specs: nothing moved.
    for (const r of second.drift) {
      expect(r.verdict, `${r.kind} ${r.dimension ?? r.measure ?? ""}`).toBe("stable");
      expect(r.kendallTau).toBeCloseTo(1, 10);
    }
  });

  /**
   * The split-brain the CLI used to paper over: a calibration spec that only
   * flips `applyBiasCorrection` leaves both per-judge maps identical, so the
   * `reliability` and `bias` arms read STABLE while every judge-weighted
   * signal moves. A caller reading `advance().drift` has to see that too.
   */
  const withBiasCorrection = {
    ...specs,
    judge_reliability: {
      ...specs.judge_reliability,
      version: "3.0.0+fixture",
      applyBiasCorrection: true,
    },
  };

  const judgeArms = (result: { drift: readonly { kind: string; measure?: string }[] }) =>
    result.drift.filter((r) => r.kind === "judge_reliability").map((r) => r.measure);

  test("a calibration-only change is reported on the weighted signals", () => {
    const second = advance(first.state, observations, withBiasCorrection, T);
    expect(judgeArms(second)).toEqual(["reliability", "bias", "weighted referral signals"]);

    const weighted = second.drift.find((r) => r.measure === "weighted referral signals");
    if (weighted === undefined) throw new Error("no weighted arm");
    expect(weighted.kind).toBe("judge_reliability");
    expect(weighted.labels).toEqual({ before: "2.0.0", after: "3.0.0+fixture" });
    expect(weighted.maxAbsShift).toBeGreaterThan(0);
    expect(weighted.verdict).not.toBe("stable");

    // The two per-judge arms are the ones that see nothing.
    for (const measure of ["reliability", "bias"] as const) {
      const arm = second.drift.find((r) => r.measure === measure);
      expect(arm?.verdict, measure).toBe("stable");
      expect(arm?.maxAbsShift, measure).toBe(0);
    }
  });

  test("identical specs ⇒ all three judge arms, all stable", () => {
    const second = advance(first.state, observations, specs, T);
    expect(judgeArms(second)).toEqual(["reliability", "bias", "weighted referral signals"]);
    for (const r of second.drift.filter((d) => d.kind === "judge_reliability")) {
      expect(r.verdict, r.measure).toBe("stable");
    }
  });

  /**
   * The rule the arm must not break: one kind's report never attributes
   * another kind's movement. When the Referral Signal spec moved too, the
   * weighted signals moved for two reasons and the calibration cannot be
   * blamed for the pair, so the arm is simply absent.
   */
  test("a Referral Signal spec change suppresses the weighted arm", () => {
    const both = {
      ...withBiasCorrection,
      referral_signal: {
        ...specs.referral_signal,
        version: "0.2.0+fixture",
        weights: { conviction: 0.2, confidence: 0.3, relationshipDepth: 0.5 },
      },
    };
    const second = advance(first.state, observations, both, T);
    expect(judgeArms(second)).toEqual(["reliability", "bias"]);
    expect(second.drift.some((r) => r.kind === "referral_signal")).toBe(true);
  });

  test("explicit thresholds are carried into every report", () => {
    const strict = {
      minKendallTau: 0.99,
      minTop10Jaccard: 0.99,
      maxP95Shift: 0.5,
      maxCrossedFraction: 0.01,
    };
    const second = advance(first.state, observations, specs, T, { drift: strict });
    expect(second.drift.length).toBeGreaterThan(0);
    for (const r of second.drift) expect(r.thresholds).toEqual(strict);
  });
});
