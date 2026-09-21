/**
 * Golden run ids for the seed.
 *
 * The ids and every output value are pinned to what the pre-`defineModel`
 * code produced. `defineModel` is a refactor: the id formula, the
 * `parameters` keys and the numbers must all survive it untouched. Run with
 * `REGENERATE=1 bun test tests/defineModelGolden.test.ts` (then `bun run
 * format`) to rewrite the fixture — only ever legitimate when a spec version
 * deliberately changes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeWeightOptions } from "../src/judges/reliability.ts";
import {
  hashInputs,
  type ModelRun,
  runCapabilityVectors,
  runJudgeCalibration,
  runReferralSignals,
} from "../src/modelRun.ts";
import { generateSeed } from "../src/seed/generate.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "run-ids-golden.json");
const NOW = new Date("2026-06-01T00:00:00.000Z");
const T = new Date("2026-12-31T00:00:00.000Z");

interface GoldenEntry {
  id: string;
  modelType: string;
  modelVersion: string;
  inputHash: string;
  /** Digest of the whole outputs graph: every seed number, bit for bit. */
  outputsHash: string;
  parameterKeys: string[];
}

function entry(run: ModelRun): GoldenEntry {
  return {
    id: run.id,
    modelType: run.modelType,
    modelVersion: run.modelVersion,
    inputHash: run.inputHash,
    outputsHash: hashInputs(run.outputs),
    parameterKeys: Object.keys(run.parameters).sort(),
  };
}

/** Every run the golden pins, built from the seed at fixed clock values. */
function goldenRuns(): Record<string, GoldenEntry> {
  const data = generateSeed();

  const signals = runReferralSignals(data.people, data.referrals, NOW);
  const calibration = runJudgeCalibration({
    people: data.people,
    referrals: data.referrals,
    outcomes: data.outcomes,
    opportunities: data.opportunities,
    now: T,
  });
  const weighted = runReferralSignals(
    data.people,
    data.referrals,
    T,
    judgeWeightOptions(calibration.outputs),
  );
  const capability = runCapabilityVectors(data.people, data.comparisons, NOW);
  const anchored = runCapabilityVectors(data.people, data.comparisons, NOW, {
    previous: capability.outputs,
    previousRunId: capability.id,
    anchorStrength: 1,
  });

  return {
    referral_signal: entry(signals),
    referral_signal_judge_weighted: entry(weighted),
    judge_calibration: entry(calibration),
    capability: entry(capability),
    capability_anchored: entry(anchored),
  };
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
