import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidedByPersonId } from "../apps/club/lib/clubRole.ts";
import { admissionObservations } from "../apps/club/lib/engine/admission.ts";
import { computeWorld } from "../apps/club/lib/engine/computeView.ts";
import { runClubPass } from "../apps/club/lib/engine/pass.ts";
import { decide, emptyState, initialState } from "../apps/club/lib/engine.ts";
import type { ClubSnapshot, ClubState } from "../apps/club/lib/types.ts";
import { type LoadedSpecs, loadSpecs } from "../src/config.ts";
import {
  type AdmissionObservations,
  type Channel,
  scoringDecisions,
} from "../src/judges/admission.ts";
import { judgeWeightOptions } from "../src/judges/reliability.ts";
import { runJudgeCalibration } from "../src/models/definitions/judgeReliability.ts";
import { runReferralSignals } from "../src/models/definitions/referralSignal.ts";
import { JUDGE_RELIABILITY_V4_1_0 } from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";

const SPECS = loadSpecs({}, { warn: () => {} });
const V4_1: LoadedSpecs = { ...SPECS, judge_reliability: JUDGE_RELIABILITY_V4_1_0 };
const RUN_IDS = join(import.meta.dir, "fixtures", "run-ids-golden.json");
const T = new Date("2026-12-31T00:00:00.000Z");

describe("a club pass under spec 4.1.0 uses the weighted signal", () => {
  test("an empty club computes a view", () => {
    expect(() => computeWorld(emptyState("2026-06-01T00:00:00.000Z"), V4_1)).not.toThrow();
  });

  test("the seeded club with a council decision runs a separate judge-weighted signal", () => {
    const seeded = initialState();
    const candidate = seeded.people.find((p) => p.status === "candidate");
    if (candidate === undefined) throw new Error("seed has no candidate");
    const state = decide(seeded, candidate.id, "admit").state;
    const world = computeWorld(state, V4_1);
    const signalRuns = world.provenance.modelRunIds.filter((id) =>
      id.startsWith("referral_signal/"),
    );
    expect(signalRuns).toHaveLength(2);
    expect(new Set(signalRuns).size).toBe(2);
  });

  test("the council's V2 signal is the ω-weighted run, not the unweighted baseline", () => {
    const data = generateSeed();
    const pass = runClubPass({
      people: data.people,
      referrals: data.referrals,
      comparisons: data.comparisons,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      admission: { decisions: [], channels: new Map() },
      now: T,
      specs: V4_1,
    });
    expect(pass.provenance.specVersions.judge_reliability).toBe("4.1.0");
    const expected = runReferralSignals(data.people, data.referrals, T, {
      ...judgeWeightOptions(pass.calibration),
    }).outputs;
    const differs = [...pass.v2].some(([id, r]) => r.signal !== pass.v0.get(id)?.signal);
    expect(differs).toBe(true);
    for (const [id, r] of pass.v2) {
      expect(r.signal).toBeCloseTo(expected.get(id)?.signal ?? Number.NaN, 12);
    }
  });
});

describe("2.0.0 run ids do not move when the club hands over admission observations", () => {
  const golden = JSON.parse(readFileSync(RUN_IDS, "utf8")) as Record<string, { id: string }>;
  const data = generateSeed();
  const candidate = data.people.find((p) => p.status === "candidate");
  if (candidate === undefined) throw new Error("seed has no candidate");
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

describe("decisions recorded at the same instant", () => {
  test("a referral is scored on the decision recorded first, not the newest snapshot", () => {
    const at = "2026-06-01T00:00:00.000Z";
    const snap = (decision: string): ClubSnapshot => ({
      id: `snap:bob:${decision}:${at}`,
      personId: "bob",
      personName: "Bob",
      decision,
      values: { referralSignal: 1, incomingCount: 1 },
      createdAt: at,
    });
    const state: ClubState = { ...emptyState(at), snapshots: [snap("denied"), snap("admitted")] };
    const ref = { id: "r-alice", candidateId: "bob", createdAt: new Date(at) };
    const scored = scoringDecisions([ref], admissionObservations(state).decisions, new Date(at));
    expect(scored.get("r-alice")?.outcome).toBe("admitted");
  });
});

describe("decidedBy that cannot be resolved", () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, warn: (line: string) => lines.push(line) };
  };

  test("one matching person row resolves without a warning", () => {
    const { lines, warn } = capture();
    expect(decidedByPersonId(["p-admin"], warn)).toBe("p-admin");
    expect(lines).toEqual([]);
  });

  test("no matching person row warns and records no decidedBy", () => {
    const { lines, warn } = capture();
    expect(decidedByPersonId([], warn)).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("decidedBy");
  });

  test("duplicate matching person rows warn and record no decidedBy", () => {
    const { lines, warn } = capture();
    expect(decidedByPersonId(["p-a", "p-b"], warn)).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("decidedBy");
  });
});
