/**
 * SEA-79 review regressions: each block fails if its bug comes back.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeWorld } from "../apps/club/lib/engine/computeView.ts";
import { runClubPass } from "../apps/club/lib/engine/pass.ts";
import { decide, emptyState, initialState } from "../apps/club/lib/engine.ts";
import { type LoadedSpecs, loadSpecs } from "../src/config.ts";
import type { AdmissionObservations, Channel } from "../src/judges/admission.ts";
import { judgeWeightOptions } from "../src/judges/reliability.ts";
import { runJudgeCalibration } from "../src/models/definitions/judgeReliability.ts";
import { runReferralSignals } from "../src/models/definitions/referralSignal.ts";
import { JUDGE_RELIABILITY_V4_1_0 } from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";

/** Registered current versions, never the ambient env. */
const SPECS = loadSpecs({}, { warn: () => {} });
const SHADOW: LoadedSpecs = { ...SPECS, judge_reliability: JUDGE_RELIABILITY_V4_1_0 };
const RUN_IDS = join(import.meta.dir, "fixtures", "run-ids-golden.json");
/** The golden run ids' evaluation time step. */
const T = new Date("2026-12-31T00:00:00.000Z");

describe("a club pass under the shadow spec 4.1.0", () => {
  test("an empty club computes a view", () => {
    expect(() => computeWorld(emptyState("2026-06-01T00:00:00.000Z"), SHADOW)).not.toThrow();
  });

  test("the seeded club with a council decision computes a view, weighted = baseline", () => {
    const seeded = initialState();
    const candidate = seeded.people.find((p) => p.status === "candidate");
    if (candidate === undefined) throw new Error("seed has no candidate");
    const state = decide(seeded, candidate.id, "admit").state;
    const world = computeWorld(state, SHADOW);
    // Shadow mode: the weighted run is the baseline, so the pass lists it once.
    const signalRuns = world.provenance.modelRunIds.filter((id) =>
      id.startsWith("referral_signal/"),
    );
    expect(signalRuns).toHaveLength(1);
  });
});

describe("2.0.0 run ids do not move when the club hands over admission observations", () => {
  const golden = JSON.parse(readFileSync(RUN_IDS, "utf8")) as Record<string, { id: string }>;
  const data = generateSeed();
  const candidate = data.people.find((p) => p.status === "candidate");
  if (candidate === undefined) throw new Error("seed has no candidate");
  /** A non-empty admission input: one decision and one channel. */
  const admission: AdmissionObservations = {
    decisions: [
      { candidateId: candidate.id, outcome: "admitted", at: T, signal: 1, signalWithout: [] },
    ],
    channels: new Map<string, Channel>([[candidate.id, "outbound"]]),
  };

  test("runJudgeCalibration: calibration and weighted run ids match the golden", () => {
    const calibration = runJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      admission,
      now: T,
    });
    expect(calibration.outputs.options.specVersion).toBe("2.0.0");
    expect(calibration.id).toBe(golden.judge_calibration?.id as string);
    const weighted = runReferralSignals(data.people, data.referrals, T, {
      ...judgeWeightOptions(calibration.outputs),
      judgeRunId: calibration.id,
    });
    expect(weighted.id).toBe(golden.referral_signal_judge_weighted?.id as string);
  });

  test("runClubPass: calibration and weighted run ids match the golden", () => {
    const pass = runClubPass({
      people: data.people,
      referrals: data.referrals,
      comparisons: data.comparisons,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      admission,
      now: T,
      specs: SPECS,
    });
    expect(pass.provenance.specVersions.judge_reliability).toBe("2.0.0");
    expect(pass.provenance.modelRunIds).toContain(golden.judge_calibration?.id as string);
    expect(pass.provenance.modelRunIds).toContain(
      golden.referral_signal_judge_weighted?.id as string,
    );
  });

  test("computeWorld: a council decision in the club leaves the run ids on the golden", () => {
    const seeded = initialState();
    const state = decide(seeded, candidate.id, "admit").state;
    const ids = computeWorld(state, SPECS).provenance.modelRunIds;
    expect(ids).toContain(golden.judge_calibration?.id as string);
    expect(ids).toContain(golden.referral_signal_judge_weighted?.id as string);
  });
});
