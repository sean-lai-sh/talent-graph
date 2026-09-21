import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeWorld } from "../apps/club/lib/engine/computeView.ts";
import type { EngineDeps } from "../apps/club/lib/engine/transitions.ts";
import {
  computeView,
  decide,
  EXAMPLE_T_START,
  initialState,
  setStatus,
} from "../apps/club/lib/engine.ts";
import type { ClubSnapshot, ClubState } from "../apps/club/lib/types.ts";
import { loadSpecs } from "../src/config.ts";
import { getSpec } from "../src/models/registry.ts";
import { createPredictionSnapshot } from "../src/models/snapshot.ts";
import type { ModelSpecKind } from "../src/models/spec.ts";

/**
 * #55 T5 — the Club runs `advance()` and its decision snapshots carry the
 * provenance of the pass they were taken on.
 *
 * Specs are passed explicitly everywhere, including through the transitions:
 * `decide` and `setStatus` reach the view through `EngineDeps`, whose default
 * falls back to `loadSpecs()` and therefore to the environment. `PINNED`
 * closes that hole, so `TG_TOP_K_REFERRALS=2 bun test` pins the same numbers
 * and the same spec versions as a bare run.
 */

const root = join(import.meta.dir, "..");
/** The registered specs, read from an empty environment on purpose. */
const specs = loadSpecs({}, { warn: () => {} });
/** The transitions' view side, pinned to those specs. */
const PINNED: EngineDeps = { computeWorld: (state: ClubState) => computeWorld(state, specs) };
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * `computeView(initialState())` at both ends of the example round, as
 * `origin/main` (9193c09) produced it before the Club adopted `advance()`.
 * Recomputed from the pre-change tree; the whole view is hashed, so a moved
 * number anywhere in it — counts, dossiers, candidate rows, member options —
 * breaks this.
 */
const CLUB_VIEW_GOLDEN = {
  end: "b08d26c2fcf19abed26988ee95c7bcb6a2f49465f38e5dbff0fe30c761570adc",
  start: "1efc2af6e8e0b9ecb0fc5713f06262faed06bcf08484ccc16eba27dd78199097",
};

const PASS_KINDS: readonly ModelSpecKind[] = [
  "referral_signal",
  "bradley_terry",
  "judge_reliability",
];

/** Run id format 2: `kind/model@specVersion:inputHash:paramHash`. */
const RUN_ID = /^([a-z_]+)\/[a-z_0-9]+@([^:]+):[0-9a-f]+:[0-9a-f]+$/;

function assertProvenance(snapshot: ClubSnapshot): void {
  const runIds = snapshot.modelRunIds;
  if (runIds === undefined) throw new Error(`snapshot ${snapshot.id} carries no run ids`);
  expect(runIds.length).toBeGreaterThan(0);
  for (const id of runIds) expect(id, `${id} is not a format-2 run id`).toMatch(RUN_ID);

  const versions = snapshot.specVersions;
  if (versions === undefined) throw new Error(`snapshot ${snapshot.id} carries no spec versions`);
  for (const kind of PASS_KINDS) {
    const version = versions[kind as keyof typeof versions];
    expect(typeof version).toBe("string");
    // A stored version is `ModelRun.specVersion`: a registered version, or one
    // carrying the `+env` build tag when a `TG_*` override moved a number.
    // Every pass under test runs on explicit registered specs, so no `+env`
    // tag is reachable here and `getSpec` — which throws on an unknown
    // version — must resolve each one.
    expect(version).not.toContain("+env");
    expect(getSpec(kind, version).version).toBe(version);
  }
}

describe("#55 T5 club snapshots carry provenance", () => {
  test("(a) every newly written snapshot carries a run id and a resolvable spec version", () => {
    const start = initialState();
    const admitted = decide(start, "p-cleo", "admit", PINNED);
    expect(admitted.error).toBeUndefined();
    const denied = decide(admitted.state, "p-bram", "deny", PINNED);
    expect(denied.error).toBeUndefined();
    const archived = setStatus(denied.state, "p-alice", "archived", PINNED);
    expect(archived.error).toBeUndefined();

    expect(archived.state.snapshots).toHaveLength(3);
    for (const snapshot of archived.state.snapshots) assertProvenance(snapshot);

    // The id formula is untouched: decision-addressed, as every stored
    // snapshot already is.
    const cleo = archived.state.snapshots.find((s) => s.personId === "p-cleo");
    expect(cleo?.id).toBe(`snap:p-cleo:admitted:${start.now}`);
    expect(cleo?.values.referralSignal).toBe(7);
    expect(cleo?.values.incomingCount).toBe(1);
  });

  test("(b) a document written before the new fields still loads, and keeps its shape", () => {
    const start = initialState();
    const legacy = {
      id: "snap:p-cleo:admitted:2026-01-01T00:00:00.000Z",
      personId: "p-cleo",
      personName: "Cleo Marsh",
      decision: "admitted",
      values: { referralSignal: 7, incomingCount: 1 },
      createdAt: "2026-01-01T00:00:00.000Z",
    } as ClubSnapshot;
    const stored: ClubState = { ...start, snapshots: [legacy] };

    const view = computeView(stored, specs);
    expect(view.snapshots).toHaveLength(1);
    const loaded = view.snapshots[0] as ClubSnapshot;
    // Absent, not `undefined`: missing provenance is missing, never empty.
    expect("modelRunIds" in loaded).toBe(false);
    expect("specVersions" in loaded).toBe(false);

    const after = decide(stored, "p-dev", "start_review", PINNED);
    expect(after.error).toBeUndefined();
    expect(after.state.snapshots).toHaveLength(2);
    assertProvenance(after.state.snapshots[0] as ClubSnapshot);
    const kept = after.state.snapshots[1] as ClubSnapshot;
    expect("modelRunIds" in kept).toBe(false);
    expect("specVersions" in kept).toBe(false);

    // Optional in the Convex validator, like `feedbackRequests` / `config`.
    const schema = readFileSync(join(root, "apps/club/convex/schema.ts"), "utf8");
    expect(schema).toContain("modelRunIds: v.optional(v.array(v.string()))");
    expect(schema).toMatch(/specVersions: v\.optional\(/);
  });

  test("(c) ClubView values are identical before and after the advance() adoption", () => {
    const state = initialState();
    expect(sha(computeView(state, specs))).toBe(CLUB_VIEW_GOLDEN.end);
    expect(sha(computeView({ ...state, now: EXAMPLE_T_START }, specs))).toBe(
      CLUB_VIEW_GOLDEN.start,
    );
  });

  test("(d) a decide computes the world once, not twice", () => {
    const start = initialState();
    let passes = 0;
    const result = decide(start, "p-cleo", "admit", {
      computeWorld: (state: ClubState) => {
        passes++;
        return PINNED.computeWorld(state);
      },
    });
    expect(result.error).toBeUndefined();
    expect(passes).toBe(1);
    expect(result.state.snapshots).toHaveLength(1);
    // The one pass is memoised, not skipped: the view handed back is exactly
    // the view a second pass over the written state would have produced.
    expect(JSON.stringify(result.view)).toBe(JSON.stringify(computeView(result.state, specs)));
  });

  test("decision snapshots are no longer truncated at twenty", () => {
    let state = initialState();
    for (let i = 0; i < 25; i++) {
      const at = new Date(Date.parse(state.now) + 3_600_000).toISOString();
      const step = decide(
        { ...state, now: at },
        "p-cleo",
        i % 2 === 0 ? "admit" : "reopen",
        PINNED,
      );
      expect(step.error).toBeUndefined();
      state = step.state;
    }
    expect(state.snapshots).toHaveLength(25);
    expect(new Set(state.snapshots.map((s) => s.id)).size).toBe(25);
    for (const snapshot of state.snapshots) assertProvenance(snapshot);
  });

  test("perf: a decision's provenance costs microseconds, not a second pass (risk 6)", () => {
    const start = initialState();
    const { provenance } = computeWorld(start, specs);
    expect(provenance.modelRunIds.length).toBeGreaterThan(0);
    expect(new Set(provenance.modelRunIds).size).toBe(provenance.modelRunIds.length);

    const values = { referralSignal: 7, incomingCount: 1 };
    const now = new Date(start.now);
    const runs = 500;
    // Warm up, then measure: `createPredictionSnapshot` hashes a payload of a
    // handful of run ids and two numbers, not the observations.
    for (let i = 0; i < 50; i++) {
      createPredictionSnapshot({
        personId: "p-cleo",
        modelRunIds: provenance.modelRunIds,
        values,
        decision: "admitted",
        now,
      });
    }
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      createPredictionSnapshot({
        personId: "p-cleo",
        modelRunIds: provenance.modelRunIds,
        values,
        decision: "admitted",
        now,
      });
    }
    const perCall = (performance.now() - t0) / runs;
    expect(perCall).toBeLessThan(1);
  });
});
