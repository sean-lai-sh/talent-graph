import { describe, expect, test } from "bun:test";
import type { Opportunity, Outcome } from "../src/domain/types.ts";
import { residualOutcomes } from "../src/judges/outcomes.ts";
import { residualSlope } from "../src/judges/slope.ts";
import { contributionTrajectory } from "../src/judges/trajectory.ts";
import { JUDGE_RELIABILITY_V3_0_0 } from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";
import {
  SEED_FLAT_SLOPE_TOLERANCE,
  SEED_TRAJECTORY_T0,
  SEED_TRAJECTORY_T1,
} from "../src/seed/outcomes.ts";

const ORIGIN = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(ORIGIN.getTime() + n * DAY);
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

function triad(observedDay: number): Outcome[] {
  return [
    outcome("lo", 1, observedDay),
    outcome("mid", 5, observedDay),
    outcome("hi", 9, observedDay),
  ];
}

describe("contributionTrajectory", () => {
  test("N cutoffs → N points and N-1 slopes; slopes match residualSlope", () => {
    const outcomes = [...triad(20), outcome("lo", 100, 80)];
    const opportunities = [opportunity("lo", 40)];
    const cutoffs = [day(20), day(20 + 90), day(20 + 180)];
    const traj = contributionTrajectory({
      personId: "lo",
      cutoffs,
      outcomes,
      opportunities,
      spec: V3,
    });

    expect(traj.personId).toBe("lo");
    expect(traj.points).toHaveLength(cutoffs.length);
    expect(traj.slopes).toHaveLength(cutoffs.length - 1);

    for (let i = 0; i < cutoffs.length; i++) {
      const at = cutoffs[i] as Date;
      const residual =
        residualOutcomes(outcomes, opportunities, V3, at).get("lo")?.residual ?? null;
      expect(traj.points[i]?.at.getTime()).toBe(at.getTime());
      expect(traj.points[i]?.residual).toBe(residual);
      expect(traj.points[i]?.state).toBe("point");
    }

    for (let i = 0; i < cutoffs.length - 1; i++) {
      const expected = residualSlope({
        personId: "lo",
        outcomes,
        opportunities,
        t0: cutoffs[i] as Date,
        t1: cutoffs[i + 1] as Date,
        spec: V3,
      });
      expect(traj.slopes[i]).toEqual(expected);
    }
  });

  test("zero and one cutoff produce no slopes; caller order is not sorted", () => {
    const outcomes = triad(10);
    expect(contributionTrajectory({ personId: "mid", cutoffs: [], outcomes, spec: V3 })).toEqual({
      personId: "mid",
      points: [],
      slopes: [],
    });

    const single = contributionTrajectory({
      personId: "mid",
      cutoffs: [day(10)],
      outcomes,
      spec: V3,
    });
    expect(single.points).toHaveLength(1);
    expect(single.slopes).toHaveLength(0);
    expect(single.points[0]?.state).toBe("point");
    expect(single.points[0]?.residual).toBe(
      residualOutcomes(outcomes, [], V3, day(10)).get("mid")?.residual as number,
    );

    // Reversed pair: still two points, one undefined_window slope.
    const reversed = contributionTrajectory({
      personId: "mid",
      cutoffs: [day(100), day(10)],
      outcomes,
      spec: V3,
    });
    expect(reversed.points).toHaveLength(2);
    expect(reversed.slopes).toHaveLength(1);
    expect(reversed.slopes[0]).toEqual(
      residualSlope({
        personId: "mid",
        outcomes,
        t0: day(100),
        t1: day(10),
        spec: V3,
      }),
    );
    expect(reversed.slopes[0]?.state).toBe("undefined_window");
  });

  test("missing residual is null; returned dates are copies", () => {
    const outcomes = triad(10);
    const t0 = day(10);
    const traj = contributionTrajectory({
      personId: "nobody",
      cutoffs: [t0],
      outcomes,
      spec: V3,
    });
    expect(traj.points[0]?.residual).toBeNull();
    traj.points[0]?.at.setTime(0);
    expect(t0.getTime()).not.toBe(0);
  });
});

describe("generateSeed sloped personas", () => {
  const data = generateSeed();

  test("Cleo has a defined positive ΔR* on the documented demo window", () => {
    const slope = residualSlope({
      personId: "p-cleo",
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      t0: SEED_TRAJECTORY_T0,
      t1: SEED_TRAJECTORY_T1,
    });
    expect(slope.state).toBe("defined");
    expect(slope.delta).not.toBeNull();
    expect(slope.delta as number).toBeGreaterThan(0);
    expect(slope.residualT0 as number).toBeLessThan(slope.residualT1 as number);
  });

  test("Bram has a high intercept and a flat slope within the documented tolerance", () => {
    const slope = residualSlope({
      personId: "p-bram",
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      t0: SEED_TRAJECTORY_T0,
      t1: SEED_TRAJECTORY_T1,
    });
    expect(slope.state).toBe("defined");
    expect(slope.delta).not.toBeNull();
    expect(Math.abs(slope.delta as number)).toBeLessThanOrEqual(SEED_FLAT_SLOPE_TOLERANCE);
    expect(slope.residualT0 as number).toBeGreaterThan(0);
    expect(SEED_FLAT_SLOPE_TOLERANCE).toBe(0.05);
    expect((SEED_TRAJECTORY_T1.getTime() - SEED_TRAJECTORY_T0.getTime()) / DAY).toBe(90);
  });

  test("generateSeed() twice yields equal ids and dates", () => {
    const a = generateSeed();
    const b = generateSeed();
    expect(a.outcomes.map((o) => ({ id: o.id, at: o.observedAt.getTime() }))).toEqual(
      b.outcomes.map((o) => ({ id: o.id, at: o.observedAt.getTime() })),
    );
    expect(a.opportunities.map((o) => ({ id: o.id, at: o.startedAt.getTime() }))).toEqual(
      b.opportunities.map((o) => ({ id: o.id, at: o.startedAt.getTime() })),
    );
    expect(a.referrals.map((r) => ({ id: r.id, at: r.createdAt.getTime() }))).toEqual(
      b.referrals.map((r) => ({ id: r.id, at: r.createdAt.getTime() })),
    );
    expect(a).toEqual(b);
  });
});
