/**
 * Golden run ids for the seed, and the format 1 → format 2 id mapping.
 *
 * Every output value is pinned to what the pre-`defineModel` code produced:
 * T3 changes run *ids* once (RUN_ID_FORMAT 2) and no number at all, which is
 * what `outputsHash` proves — the mapping fixture carries the format 1
 * `outputsHash` beside the format 1 id, and this file asserts the current
 * code still produces it.
 *
 * Run with `REGENERATE=1 bun test tests/defineModelGolden.test.ts` (then `bun
 * run format`) to rewrite the golden — only ever legitimate when a spec
 * version deliberately changes, or with a further RUN_ID_FORMAT bump. The
 * mapping fixture's `oldId`/`oldOutputsHash` are history and are never
 * regenerated.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeWeightOptions } from "../src/judges/reliability.ts";
import {
  hashInputs,
  type ModelRun,
  RUN_ID_FORMAT,
  runCapabilityVectors,
  runJudgeCalibration,
  runReferralSignals,
  type UpstreamRun,
} from "../src/modelRun.ts";
import { getSpec } from "../src/models/registry.ts";
import { validateSpec } from "../src/models/spec.ts";
import { generateSeed } from "../src/seed/generate.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "run-ids-golden.json");
const MAPPING = join(import.meta.dir, "fixtures", "run-ids-format2-mapping.json");
const NOW = new Date("2026-06-01T00:00:00.000Z");
const T = new Date("2026-12-31T00:00:00.000Z");

interface GoldenEntry {
  id: string;
  kind: string;
  specVersion: string;
  inputHash: string;
  /** Digest of the whole outputs graph: every seed number, bit for bit. */
  outputsHash: string;
  parameterKeys: string[];
  upstreamRuns: UpstreamRun[];
}

/** One row of the format 1 → format 2 mapping. */
interface MappingEntry {
  oldId: string;
  newId: string;
  kind: string;
  specVersion: string;
  upstreamRuns: UpstreamRun[];
  /** Format 1's `outputsHash`. Equal to format 2's: no number moved. */
  oldOutputsHash: string;
}

function entry(run: ModelRun): GoldenEntry {
  return {
    id: run.id,
    kind: run.kind,
    specVersion: run.specVersion,
    inputHash: run.inputHash,
    outputsHash: hashInputs(run.outputs),
    parameterKeys: Object.keys(run.parameters).sort(),
    upstreamRuns: [...run.upstreamRuns],
  };
}

/** Every run the golden pins, built from the seed at fixed clock values. */
function seedRuns(): Record<string, ModelRun> {
  const data = generateSeed();

  const signals = runReferralSignals(data.people, data.referrals, NOW);
  const calibration = runJudgeCalibration({
    people: data.people,
    referrals: data.referrals,
    outcomes: data.outcomes,
    opportunities: data.opportunities,
    now: T,
  });
  const weighted = runReferralSignals(data.people, data.referrals, T, {
    ...judgeWeightOptions(calibration.outputs),
    judgeRunId: calibration.id,
  });
  const capability = runCapabilityVectors(data.people, data.comparisons, NOW);
  const anchored = runCapabilityVectors(data.people, data.comparisons, NOW, {
    previous: capability.outputs,
    previousRunId: capability.id,
    anchorStrength: 1,
  });

  return {
    referral_signal: signals,
    referral_signal_judge_weighted: weighted,
    judge_calibration: calibration,
    capability,
    capability_anchored: anchored,
  };
}

function goldenRuns(): Record<string, GoldenEntry> {
  return Object.fromEntries(Object.entries(seedRuns()).map(([name, run]) => [name, entry(run)]));
}

describe("golden run ids", () => {
  test("the seed's run ids and outputs are unchanged", () => {
    const actual = goldenRuns();
    if (process.env.REGENERATE === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, GoldenEntry>;
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, got] of Object.entries(actual)) {
      expect(got, name).toEqual(expected[name] as GoldenEntry);
    }
  });
});

/**
 * `resolveOptions` re-derives the effective solver thresholds rather than
 * reading them off the outputs, so a future change to how the solver
 * defaults them would silently desynchronise the record from the numbers.
 * Cheap guard: the two must agree, with and without overrides. Under run id
 * format 2 `anchored` is no longer a parameter — whether the fit was anchored
 * is `upstreamRuns`, so that is what must agree with `outputs.options`.
 */
describe("recorded solver options match the ones the fit used", () => {
  const data = generateSeed();
  const prior = runCapabilityVectors(data.people, data.comparisons, NOW);
  const cases: Array<[string, Parameters<typeof runCapabilityVectors>[3]]> = [
    ["defaults", {}],
    ["minComparisons override", { minComparisons: 99 }],
    ["minOpponents override", { minOpponents: 7 }],
    ["tieHandling override", { tieHandling: "half" }],
    ["anchored", { previous: prior.outputs, previousRunId: prior.id, anchorStrength: 1 }],
  ];

  for (const [name, opts] of cases) {
    test(name, () => {
      const run = runCapabilityVectors(data.people, data.comparisons, NOW, opts);
      expect(run.parameters.minComparisons).toBe(run.outputs.options.minComparisons);
      expect(run.parameters.minOpponents).toBe(run.outputs.options.minOpponents);
      expect(run.parameters.tieHandling).toBe(run.outputs.options.tieHandling);
      expect(run.upstreamRuns.some((u) => u.role === "anchor")).toBe(run.outputs.options.anchored);
    });
  }
});

describe("every run the pipeline can produce is resolvable", () => {
  const runs = Object.entries(seedRuns());

  test("getSpec(run.kind, run.specVersion) succeeds for every seed run", () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const [name, run] of runs) {
      // Including the judge-weighted run, whose format 1 version tag
      // `0.1.0+judge_reliability` getSpec threw on.
      const spec = getSpec(run.kind, run.specVersion);
      expect(spec.kind, name).toBe(run.kind);
      expect(spec.version, name).toBe(run.specVersion);
    }
  });

  test("every emitted specVersion passes the spec validator", () => {
    for (const [name, run] of runs) {
      expect(validateSpec(getSpec(run.kind, run.specVersion)), name).toEqual({ ok: true });
      // The SEMVER rule the validator applies, stated against the emitted
      // string rather than against the registered spec it resolved to.
      expect(run.specVersion, name).toMatch(/^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/);
    }
  });

  test("the id carries the kind and version getSpec is called with", () => {
    for (const [name, run] of runs) {
      expect(run.id.startsWith(`${run.kind}/`), name).toBe(true);
      expect(run.id.includes(`@${run.specVersion}:`), name).toBe(true);
    }
  });
});

describe("format 1 → format 2 run id mapping", () => {
  const mapping = JSON.parse(readFileSync(MAPPING, "utf8")) as Record<string, MappingEntry>;
  const actual = goldenRuns();

  test("RUN_ID_FORMAT is 2", () => {
    expect(RUN_ID_FORMAT).toBe(2);
  });

  test("every seed run is mapped, and every newId is what the code emits now", () => {
    expect(Object.keys(mapping).sort()).toEqual(Object.keys(actual).sort());
    for (const [name, got] of Object.entries(actual)) {
      const row = mapping[name] as MappingEntry;
      expect(row.newId, name).toBe(got.id);
      expect(row.kind, name).toBe(got.kind);
      expect(row.specVersion, name).toBe(got.specVersion);
      expect(row.upstreamRuns, name).toEqual(got.upstreamRuns);
    }
  });

  test("ids changed exactly once, for every kind", () => {
    for (const [name, row] of Object.entries(mapping)) {
      expect(row.oldId, name).not.toBe(row.newId);
      // Format 1 stamped `modelType@version`; format 2 stamps `kind/model@version`.
      expect(row.oldId.includes("/"), name).toBe(false);
      expect(row.newId.includes("/"), name).toBe(true);
    }
  });

  test("no number moved: outputsHash is identical under both formats", () => {
    for (const [name, got] of Object.entries(actual)) {
      expect((mapping[name] as MappingEntry).oldOutputsHash, name).toBe(got.outputsHash);
    }
  });
});
