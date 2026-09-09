import { describe, expect, test } from "bun:test";
import type { Opportunity, Outcome } from "../src/domain/types.ts";
import { residualOutcomes } from "../src/judges/outcomes.ts";
import {
  classifyResidualSlope,
  DEFAULT_SLOPE_MIN_GAP_DAYS,
  residualSlope,
  residualSlopes,
} from "../src/judges/slope.ts";
import {
  CURRENT_SPECS,
  JUDGE_RELIABILITY_V2_0_0,
  JUDGE_RELIABILITY_V3_0_0,
} from "../src/models/registry.ts";
import type { JudgeReliabilitySpec } from "../src/models/spec.ts";

const ORIGIN = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(ORIGIN.getTime() + n * DAY);

const V2 = JUDGE_RELIABILITY_V2_0_0;
const V3 = JUDGE_RELIABILITY_V3_0_0;

let seq = 0;

function outcome(
  personId: string,
  value: number | null,
  observedDay: number,
  kind = "shipped_project",
): Outcome {
  seq++;
  return {
    id: `o-${seq}`,
    personId,
    opportunityId: null,
    kind,
    value,
    observedAt: day(observedDay),
    createdAt: day(observedDay),
  };
}

function opportunity(personId: string, startedDay: number): Opportunity {
  seq++;
  return {
    id: `op-${seq}`,
    personId,
    kind: "grant",
    description: "seeded",
    startedAt: day(startedDay),
    endedAt: null,
    createdAt: day(startedDay),
  };
}

/** Three-person kind, all observed on `observedDay`. Residuals are defined. */
function triad(observedDay: number, kind = "shipped_project"): Outcome[] {
  return [
    outcome("lo", 1, observedDay, kind),
    outcome("mid", 5, observedDay, kind),
    outcome("hi", 9, observedDay, kind),
  ];
}

describe("residualSlope", () => {
  test("same residual at both cutoffs (valid 90-day gap) ⇒ delta === 0, defined", () => {
    const outcomes = triad(10);
    const t0 = day(10);
    const t1 = day(100);
    const slope = residualSlope({ personId: "mid", outcomes, t0, t1, spec: V3 });
    const r0 = residualOutcomes(outcomes, [], V3, t0).get("mid")?.residual;
    const r1 = residualOutcomes(outcomes, [], V3, t1).get("mid")?.residual;
    expect(r0).toBeDefined();
    expect(r1).toBe(r0);
    expect(slope.state).toBe("defined");
    expect(slope.delta).toBe(0);
    expect(slope.residualT0).toBe(r0 as number);
    expect(slope.residualT1).toBe(r1 as number);
    expect(slope.personId).toBe("mid");
    expect(slope.t0.getTime()).toBe(t0.getTime());
    expect(slope.t1.getTime()).toBe(t1.getTime());
  });

  test("residual rise ⇒ positive delta; fall ⇒ negative; both match residualOutcomes", () => {
    // t0: lo < mid < hi. t1: lo adds a very high later outcome and rises;
    // hi's within-kind rank drops, so their residual falls.
    const early = triad(20);
    const laterHigh = outcome("lo", 100, 80);
    const outcomes = [...early, laterHigh];
    const t0 = day(20);
    const t1 = day(20 + 90);
    const at0 = residualOutcomes(outcomes, [], V3, t0);
    const at1 = residualOutcomes(outcomes, [], V3, t1);
    expect(at0.get("lo")?.residual).toBeDefined();
    expect(at1.get("lo")?.residual).toBeDefined();
    expect(at1.get("lo")?.residual as number).toBeGreaterThan(at0.get("lo")?.residual as number);
    expect(at1.get("hi")?.residual as number).toBeLessThan(at0.get("hi")?.residual as number);

    const rose = residualSlope({ personId: "lo", outcomes, t0, t1, spec: V3 });
    const fell = residualSlope({ personId: "hi", outcomes, t0, t1, spec: V3 });
    expect(rose.state).toBe("defined");
    expect(fell.state).toBe("defined");
    expect(rose.delta).toBe((at1.get("lo")?.residual as number) - (at0.get("lo")?.residual as number));
    expect(fell.delta).toBe((at1.get("hi")?.residual as number) - (at0.get("hi")?.residual as number));
    expect(rose.delta as number).toBeGreaterThan(0);
    expect(fell.delta as number).toBeLessThan(0);
  });

  test("no outcomes by t0 ⇒ insufficient_early (even if t1 has a residual)", () => {
    // `late` is absent from the t0 snapshot and present at t1. Early side fails first.
    const outcomes = [...triad(20), outcome("late", 7, 80)];
    const t0 = day(20);
    const t1 = day(20 + 90);
    expect(residualOutcomes(outcomes, [], V3, t0).has("late")).toBe(false);
    expect(residualOutcomes(outcomes, [], V3, t1).has("late")).toBe(true);

    const slope = residualSlope({ personId: "late", outcomes, t0, t1, spec: V3 });
    expect(slope.state).toBe("insufficient_early");
    expect(slope.residualT0).toBeNull();
    expect(slope.residualT1).toBe(residualOutcomes(outcomes, [], V3, t1).get("late")?.residual as number);
    expect(slope.delta).toBeNull();
  });

  test("outcomes only after t1 (none by t0 either) ⇒ insufficient_early", () => {
    // Documented: both sides missing still names the early failure. `future`
    // has nothing ≤ t0 and nothing ≤ t1; their only outcomes land after t1.
    const outcomes = [...triad(20), outcome("future", 8, 200)];
    const t0 = day(20);
    const t1 = day(20 + 90);
    expect(residualOutcomes(outcomes, [], V3, t0).has("future")).toBe(false);
    expect(residualOutcomes(outcomes, [], V3, t1).has("future")).toBe(false);

    const slope = residualSlope({ personId: "future", outcomes, t0, t1, spec: V3 });
    expect(slope.state).toBe("insufficient_early");
    expect(slope.residualT0).toBeNull();
    expect(slope.residualT1).toBeNull();
    expect(slope.delta).toBeNull();
  });

  test("tiny later kind does not drop a t0 residual; insufficient_late is the late-only miss", () => {
    // Fixture: `lo` has a residual at t0 from `shipped_project` (kind size 3).
    // Between t0 and t1 they pick up two `unicorn_exit` rows — below
    // minKindSize, dropped. residualOutcomes at t1 still includes the early
    // kind, so the snapshot stays defined (inclusion is monotonic in the
    // cutoff). insufficient_late is the complementary state: valid window,
    // residual at t0, none at t1. residualOutcomes cannot produce that pair
    // from one outcomes list; classifyResidualSlope locks the precedence.
    const outcomes = [
      ...triad(20),
      outcome("lo", 1e9, 80, "unicorn_exit"),
      outcome("x", 2, 80, "unicorn_exit"),
    ];
    const t0 = day(20);
    const t1 = day(20 + 90);
    expect(residualOutcomes(outcomes, [], V3, t0).has("lo")).toBe(true);
    expect(residualOutcomes(outcomes, [], V3, t1).has("lo")).toBe(true);
    expect(residualSlope({ personId: "lo", outcomes, t0, t1, spec: V3 }).state).toBe("defined");

    expect(classifyResidualSlope(t0, t1, 0.25, null, 90)).toBe("insufficient_late");
    expect(classifyResidualSlope(t0, t1, 0.25, 0.1, 90)).toBe("defined");
    expect(classifyResidualSlope(t0, t1, null, null, 90)).toBe("insufficient_early");
    expect(classifyResidualSlope(t1, t0, 0.25, 0.1, 90)).toBe("undefined_window");
  });

  test("t1 < t0 or gap too small ⇒ undefined_window, delta null; residuals still filled", () => {
    const outcomes = triad(10);
    const t0 = day(100);
    const earlier = day(10);
    const tooClose = day(10 + 89);

    const reversed = residualSlope({ personId: "mid", outcomes, t0, t1: earlier, spec: V3 });
    expect(reversed.state).toBe("undefined_window");
    expect(reversed.delta).toBeNull();
    // t1 is before the outcomes, so the late snapshot is empty; t0 is after.
    expect(reversed.residualT0).toBe(residualOutcomes(outcomes, [], V3, t0).get("mid")?.residual as number);
    expect(reversed.residualT1).toBeNull();

    const equal = residualSlope({ personId: "mid", outcomes, t0: day(10), t1: day(10), spec: V3 });
    expect(equal.state).toBe("undefined_window");
    expect(equal.delta).toBeNull();
    expect(equal.residualT0).not.toBeNull();
    expect(equal.residualT1).toBe(equal.residualT0);

    const short = residualSlope({ personId: "mid", outcomes, t0: day(10), t1: tooClose, spec: V3 });
    expect((tooClose.getTime() - day(10).getTime()) / DAY).toBe(89);
    expect(short.state).toBe("undefined_window");
    expect(short.delta).toBeNull();
    expect(short.residualT0).not.toBeNull();
    expect(short.residualT1).not.toBeNull();
  });

  test("2.0.0 spec (no slopeMinGapDays) still applies the 90-day default without mutating the spec", () => {
    expect(V2.slopeMinGapDays).toBeUndefined();
    expect(DEFAULT_SLOPE_MIN_GAP_DAYS).toBe(90);
    const outcomes = triad(10);
    const keysBefore = Object.keys(V2);
    const exact = residualSlope({
      personId: "mid",
      outcomes,
      t0: day(10),
      t1: day(10 + 90),
      spec: V2,
    });
    const shy = residualSlope({
      personId: "mid",
      outcomes,
      t0: day(10),
      t1: day(10 + 89),
      spec: V2,
    });
    expect(exact.state).toBe("defined");
    expect(exact.delta).toBe(0);
    expect(shy.state).toBe("undefined_window");
    expect(shy.delta).toBeNull();
    expect(Object.keys(V2)).toEqual(keysBefore);
    expect("slopeMinGapDays" in V2).toBe(false);
    expect(V2.slopeMinGapDays).toBeUndefined();
  });

  test("omitted spec uses CURRENT_SPECS.judge_reliability (2.0.0) and the 90-day default", () => {
    expect(CURRENT_SPECS.judge_reliability).toBe(V2);
    const outcomes = triad(10);
    const slope = residualSlope({ personId: "mid", outcomes, t0: day(10), t1: day(10 + 90) });
    expect(slope.state).toBe("defined");
    expect(residualSlope({ personId: "mid", outcomes, t0: day(10), t1: day(10 + 89) }).state).toBe(
      "undefined_window",
    );
  });

  test("V3 slopeMinGapDays is read from the spec; a custom gap is honoured", () => {
    expect(V3.slopeMinGapDays).toBe(90);
    const outcomes = triad(10);
    const wide: JudgeReliabilitySpec = { ...V3, slopeMinGapDays: 200 };
    const tight: JudgeReliabilitySpec = { ...V3, slopeMinGapDays: 30 };
    const t0 = day(10);
    const t1 = day(10 + 120);
    expect(residualSlope({ personId: "mid", outcomes, t0, t1, spec: V3 }).state).toBe("defined");
    expect(residualSlope({ personId: "mid", outcomes, t0, t1, spec: wide }).state).toBe(
      "undefined_window",
    );
    expect(residualSlope({ personId: "mid", outcomes, t0, t1: day(10 + 30), spec: tight }).state).toBe(
      "defined",
    );
  });

  test("forwards opportunities into residualOutcomes at each cutoff", () => {
    // Opportunity starts after the t0 latest-outcome clock, so it is ignored
    // at t0. A later outcome moves the clock past the grant; t1 residual
    // is opportunity-corrected and the delta matches residualOutcomes.
    const early = triad(20);
    const later = outcome("lo", 4, 80);
    const opps = [opportunity("lo", 40), opportunity("peer", 40)];
    const extraPeer = outcome("peer", 3, 80);
    const outcomes = [...early, later, extraPeer];
    const t0 = day(20);
    const t1 = day(20 + 90);
    const at0 = residualOutcomes(outcomes, opps, V3, t0);
    const at1 = residualOutcomes(outcomes, opps, V3, t1);
    expect(at0.get("lo")?.opportunityCount).toBe(0);
    expect(at1.get("lo")?.opportunityCount).toBe(1);
    const slope = residualSlope({ personId: "lo", outcomes, opportunities: opps, t0, t1, spec: V3 });
    expect(slope.state).toBe("defined");
    expect(slope.delta).toBe((at1.get("lo")?.residual as number) - (at0.get("lo")?.residual as number));
  });

  test("returned dates are copies; a residual of 0 is defined, not missing", () => {
    const outcomes = triad(10);
    const t0 = day(10);
    const t1 = day(100);
    const at0 = residualOutcomes(outcomes, [], V3, t0);
    // No opportunity correction ⇒ mid's residual is 0.
    expect(at0.get("mid")?.residual).toBe(0);
    const slope = residualSlope({ personId: "mid", outcomes, t0, t1, spec: V3 });
    expect(slope.state).toBe("defined");
    expect(slope.residualT0).toBe(0);
    expect(slope.delta).toBe(0);
    slope.t0.setTime(0);
    slope.t1.setTime(0);
    expect(t0.getTime()).not.toBe(0);
    expect(t1.getTime()).not.toBe(0);
  });
});

describe("residualSlopes", () => {
  test("returns one row per id, in order, sharing the t0/t1 snapshots", () => {
    const outcomes = [...triad(20), outcome("late", 7, 80), outcome("future", 8, 200)];
    const t0 = day(20);
    const t1 = day(20 + 90);
    const rows = residualSlopes({
      personIds: ["mid", "late", "future", "nobody"],
      outcomes,
      t0,
      t1,
      spec: V3,
    });
    expect(rows.map((r) => r.personId)).toEqual(["mid", "late", "future", "nobody"]);
    expect(rows.map((r) => r.state)).toEqual([
      "defined",
      "insufficient_early",
      "insufficient_early",
      "insufficient_early",
    ]);
    expect(rows[0]?.delta).toBe(0);
    expect(rows[1]?.delta).toBeNull();
    expect(residualSlopes({ personIds: [], outcomes, t0, t1, spec: V3 })).toEqual([]);

    const single = residualSlope({ personId: "late", outcomes, t0, t1, spec: V3 });
    expect(rows[1]).toEqual(single);
  });
});
