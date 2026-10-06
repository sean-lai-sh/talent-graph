/**
 * SEA-79 review regressions: each block fails if its bug comes back.
 */
import { describe, expect, test } from "bun:test";
import { computeWorld } from "../apps/club/lib/engine/computeView.ts";
import { decide, emptyState, initialState } from "../apps/club/lib/engine.ts";
import { type LoadedSpecs, loadSpecs } from "../src/config.ts";
import { JUDGE_RELIABILITY_V4_1_0 } from "../src/models/registry.ts";

/** Registered current versions, never the ambient env. */
const SPECS = loadSpecs({}, { warn: () => {} });
const SHADOW: LoadedSpecs = { ...SPECS, judge_reliability: JUDGE_RELIABILITY_V4_1_0 };

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
