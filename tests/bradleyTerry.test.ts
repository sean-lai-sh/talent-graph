import { describe, expect, test } from "bun:test";
import type { Comparison, ComparisonOutcome } from "../src/domain/types.ts";
import {
  type ComparisonObservation,
  fitBradleyTerry,
  thetaMap,
  toObservations,
} from "../src/inference/bradleyTerry.ts";
import { sigmoid } from "../src/inference/logistic.ts";
import { BRADLEY_TERRY_V1_0_0 } from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";

function wins(w: string, l: string, times: number, weight?: number): ComparisonObservation[] {
  return Array.from({ length: times }, () =>
    weight === undefined ? { winnerId: w, loserId: l } : { winnerId: w, loserId: l, weight },
  );
}

function theta(run: ReturnType<typeof fitBradleyTerry>, id: string): number {
  const f = run.fits.find((x) => x.personId === id);
  if (!f) throw new Error(`no fit for ${id}`);
  return f.theta;
}

function allFinite(run: ReturnType<typeof fitBradleyTerry>): boolean {
  return run.fits.every((f) => Number.isFinite(f.theta));
}

describe("fitBradleyTerry — the eight mandated properties", () => {
  test("1. A beats B ×10 ⇒ θ_A > θ_B", () => {
    const run = fitBradleyTerry(["A", "B"], wins("A", "B", 10));
    expect(theta(run, "A")).toBeGreaterThan(theta(run, "B"));
    expect(run.converged).toBe(true);
  });

  test("2. transitive chain A>B, B>C ⇒ θ_A > θ_B > θ_C", () => {
    const run = fitBradleyTerry(["A", "B", "C"], [...wins("A", "B", 10), ...wins("B", "C", 10)]);
    expect(theta(run, "A")).toBeGreaterThan(theta(run, "B"));
    expect(theta(run, "B")).toBeGreaterThan(theta(run, "C"));
  });

  test("3. symmetric record ⇒ |θ_A − θ_B| < 1e-6", () => {
    const run = fitBradleyTerry(["A", "B"], [...wins("A", "B", 5), ...wins("B", "A", 5)]);
    expect(Math.abs(theta(run, "A") - theta(run, "B"))).toBeLessThan(1e-6);
  });

  test("4. zero mean per component; translation leaves probabilities unchanged", () => {
    const obs = [
      ...wins("A", "B", 4),
      ...wins("B", "C", 3),
      ...wins("X", "Y", 6),
      ...wins("Y", "X", 1),
    ];
    const run = fitBradleyTerry(["A", "B", "C", "X", "Y"], obs);
    for (const comp of run.components) {
      const members = run.fits.filter((f) => f.componentId === comp.componentId);
      const mean = members.reduce((s, f) => s + f.theta, 0) / members.length;
      expect(Math.abs(mean)).toBeLessThan(1e-9);
    }
    const a = theta(run, "A");
    const b = theta(run, "B");
    const shift = 3.7;
    expect(sigmoid(a + shift - (b + shift))).toBeCloseTo(sigmoid(a - b), 12);
  });

  test("5. regularisation shrinks a sparse node monotonically in λ", () => {
    // A has 30 comparisons elsewhere; D has a single win over A.
    const obs = [...wins("A", "E", 15), ...wins("F", "A", 15), ...wins("D", "A", 1)];
    const ids = ["A", "D", "E", "F"];
    const strong = fitBradleyTerry(ids, obs, { regularization: 0.1 });
    const weak = fitBradleyTerry(ids, obs, { regularization: 0.001 });
    expect(Math.abs(theta(strong, "D"))).toBeLessThan(Math.abs(theta(weak, "D")));
    expect(theta(weak, "D")).toBeGreaterThan(theta(weak, "A"));
  });

  test("6. disjoint groups get distinct componentIds and fit independently", () => {
    const g1 = [...wins("A", "B", 4), ...wins("B", "C", 2)];
    const g2 = [...wins("X", "Y", 7), ...wins("Y", "X", 2)];
    const together = fitBradleyTerry(["A", "B", "C", "X", "Y"], [...g1, ...g2], { label: "t" });
    const separate1 = fitBradleyTerry(["A", "B", "C"], g1, { label: "t" });
    const separate2 = fitBradleyTerry(["X", "Y"], g2, { label: "t" });

    const comps = new Set(together.fits.map((f) => f.componentId));
    expect(comps).toEqual(new Set(["t:A", "t:X"]));
    for (const id of ["A", "B", "C"]) {
      expect(Math.abs(theta(together, id) - theta(separate1, id))).toBeLessThan(1e-6);
    }
    for (const id of ["X", "Y"]) {
      expect(Math.abs(theta(together, id) - theta(separate2, id))).toBeLessThan(1e-6);
    }
  });

  test("7. more data ⇒ larger gap at fixed λ", () => {
    const few = fitBradleyTerry(["A", "B"], wins("A", "B", 2));
    const many = fitBradleyTerry(["A", "B"], wins("A", "B", 40));
    expect(theta(many, "A") - theta(many, "B")).toBeGreaterThan(theta(few, "A") - theta(few, "B"));
  });

  test("8. extreme record with tiny λ stays finite", () => {
    const run = fitBradleyTerry(["A", "B"], wins("A", "B", 1000), {
      regularization: 1e-9,
      maxIterations: 200,
    });
    expect(allFinite(run)).toBe(true);
    expect(theta(run, "A")).toBeGreaterThan(theta(run, "B"));
    expect(Number.isFinite(run.negLogLik)).toBe(true);
    expect(typeof run.converged).toBe("boolean");
    expect(run.iterations).toBeLessThanOrEqual(200);
  });
});

describe("fitBradleyTerry — extras", () => {
  test("tallies: wins + losses === comparisonCount; opponentCount distinct", () => {
    const run = fitBradleyTerry(["A", "B", "C"], [...wins("A", "B", 3), ...wins("C", "A", 2)]);
    const a = run.fits.find((f) => f.personId === "A");
    expect(a).toMatchObject({ wins: 3, losses: 2, comparisonCount: 5, opponentCount: 2 });
    for (const f of run.fits) expect(f.wins + f.losses).toBe(f.comparisonCount);
  });

  test("a person with no observations has θ exactly 0 in a singleton component", () => {
    const run = fitBradleyTerry(["A", "B", "Z"], wins("A", "B", 3));
    const z = run.fits.find((f) => f.personId === "Z");
    expect(z?.theta).toBe(0);
    expect(z?.componentSize).toBe(1);
    expect(z?.comparisonCount).toBe(0);
  });

  test("observations naming unknown ids are ignored", () => {
    const run = fitBradleyTerry(["A", "B"], [...wins("A", "B", 3), ...wins("ghost", "A", 50)]);
    expect(run.fits).toHaveLength(2);
    expect(theta(run, "A")).toBeGreaterThan(theta(run, "B"));
  });

  test("λ = 0 on a balanced graph still converges", () => {
    const run = fitBradleyTerry(
      ["A", "B", "C"],
      [...wins("A", "B", 3), ...wins("B", "A", 1), ...wins("B", "C", 2), ...wins("C", "A", 1)],
      {
        regularization: 0,
      },
    );
    expect(run.converged).toBe(true);
    expect(allFinite(run)).toBe(true);
  });

  test("reads λ from the spec when no override is given", () => {
    const run = fitBradleyTerry(["A", "B"], wins("A", "B", 5), {
      spec: { ...BRADLEY_TERRY_V1_0_0, version: "1.1.0", regularization: 5 },
    });
    expect(run.options.specVersion).toBe("1.1.0");
    expect(run.options.regularization).toBe(5);
    expect(Math.abs(theta(run, "A"))).toBeLessThan(
      Math.abs(theta(fitBradleyTerry(["A", "B"], wins("A", "B", 5)), "A")),
    );
  });

  test("determinism: same inputs ⇒ identical output", () => {
    const data = generateSeed();
    const ids = data.people.map((p) => p.id);
    const obs = toObservations(data.comparisons, "problem_solving");
    expect(fitBradleyTerry(ids, obs)).toEqual(fitBradleyTerry(ids, obs));
  });

  test("rejects invalid solver parameters", () => {
    expect(() => fitBradleyTerry(["A"], [], { regularization: -1 })).toThrow();
    expect(() => fitBradleyTerry(["A"], [], { tolerance: 0 })).toThrow();
  });
});

describe("anchored refit and warm start (#15)", () => {
  const base = [
    ...wins("A", "B", 6),
    ...wins("B", "C", 6),
    ...wins("A", "C", 3),
    ...wins("C", "A", 1),
  ];
  const ids = ["A", "B", "C"];

  test("κ = 0 with a warm start equals the plain fit to within tolerance", () => {
    const cold = fitBradleyTerry(ids, base);
    const warm = fitBradleyTerry(ids, base, { anchor: { theta: thetaMap(cold), strength: 0 } });
    for (const id of ids) expect(Math.abs(theta(cold, id) - theta(warm, id))).toBeLessThan(1e-5);
    expect(warm.iterations).toBeLessThanOrEqual(cold.iterations);
    expect(warm.options.anchoredCount).toBe(3);
  });

  test("κ = 10 keeps θ within 0.1 of the previous run after one new comparison", () => {
    const previous = fitBradleyTerry(ids, base);
    const updated = [...base, ...wins("C", "A", 1)];
    const anchored = fitBradleyTerry(ids, updated, {
      anchor: { theta: thetaMap(previous), strength: 10 },
    });
    const free = fitBradleyTerry(ids, updated);
    for (const id of ids) {
      expect(Math.abs(theta(anchored, id) - theta(previous, id))).toBeLessThan(0.1);
    }
    // The anchored fit moves less than the free refit does.
    const moveAnchored = ids.reduce(
      (s, id) => s + Math.abs(theta(anchored, id) - theta(previous, id)),
      0,
    );
    const moveFree = ids.reduce((s, id) => s + Math.abs(theta(free, id) - theta(previous, id)), 0);
    expect(moveAnchored).toBeLessThan(moveFree);
  });

  test("anchor strength falls back to the spec's anchorStrength", () => {
    const prev = fitBradleyTerry(ids, base);
    const run = fitBradleyTerry(ids, base, {
      spec: { ...BRADLEY_TERRY_V1_0_0, anchorStrength: 2 },
      anchor: { theta: thetaMap(prev) },
    });
    expect(run.options.anchorStrength).toBe(2);
  });

  test("warm start on the seed reproduces the cold fit", () => {
    const data = generateSeed();
    const seedIds = data.people.map((p) => p.id);
    const obs = toObservations(data.comparisons, "problem_solving");
    const cold = fitBradleyTerry(seedIds, obs, { label: "problem_solving" });
    const warm = fitBradleyTerry(seedIds, obs, {
      label: "problem_solving",
      anchor: { theta: thetaMap(cold), strength: 0 },
    });
    for (const id of seedIds)
      expect(Math.abs(theta(cold, id) - theta(warm, id))).toBeLessThan(1e-4);
  });
});

describe("toObservations", () => {
  const T0 = new Date("2026-01-01T00:00:00.000Z");
  function cmp(
    outcome: ComparisonOutcome,
    dimension: Comparison["dimension"] = "agency",
  ): Comparison {
    return {
      id: `c-${outcome}`,
      evaluatorId: "j",
      personAId: "A",
      personBId: "B",
      dimension,
      outcome,
      winnerId: outcome === "a" ? "A" : outcome === "b" ? "B" : null,
      confidence: 4,
      createdAt: T0,
    };
  }

  test("drops skip / insufficient_observation and other dimensions", () => {
    const obs = toObservations(
      [cmp("a"), cmp("b"), cmp("skip"), cmp("insufficient_observation"), cmp("a", "taste")],
      "agency",
    );
    expect(obs).toEqual([
      { winnerId: "A", loserId: "B", weight: 1 },
      { winnerId: "B", loserId: "A", weight: 1 },
    ]);
  });

  test("tie handling", () => {
    expect(toObservations([cmp("tie")], "agency")).toEqual([]);
    expect(toObservations([cmp("tie")], "agency", { tieHandling: "ignore" })).toEqual([]);
    expect(toObservations([cmp("tie")], "agency", { tieHandling: "half" })).toEqual([
      { winnerId: "A", loserId: "B", weight: 0.5 },
      { winnerId: "B", loserId: "A", weight: 0.5 },
    ]);
  });

  test("confidence never reaches the observation", () => {
    const [o] = toObservations([cmp("a")], "agency");
    expect(o && "confidence" in o).toBe(false);
  });
});
