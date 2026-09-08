import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "../src/domain/constants.ts";
import type { Comparison, Dimension, Person } from "../src/domain/types.ts";
import {
  computeCapabilityVectors,
  estimatedEntries,
  formatDimensionEstimate,
  poolConfidence,
} from "../src/inference/capabilityVector.ts";
import { runCapabilityVectors } from "../src/modelRun.ts";
import { BRADLEY_TERRY_V1_0_0 } from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let n = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function win(w: string, l: string, dimension: Dimension = "problem_solving", day = 0): Comparison {
  n++;
  return {
    id: `c-${n}`,
    evaluatorId: "judge",
    personAId: w,
    personBId: l,
    dimension,
    outcome: "a",
    winnerId: w,
    confidence: 3,
    createdAt: new Date(T0.getTime() + day * 86_400_000),
  };
}

/** Round-robin where earlier ids beat later ids `times` each. */
function roundRobin(ids: string[], dimension: Dimension, times = 2): Comparison[] {
  const out: Comparison[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (let t = 0; t < times; t++)
        out.push(win(ids[i] as string, ids[j] as string, dimension, t));
    }
  }
  return out;
}

describe("computeCapabilityVectors", () => {
  test("person with 1 comparison ⇒ insufficient_evidence with the right reason", () => {
    const people = ["A", "B", "C", "D"].map(person);
    const comps = [...roundRobin(["A", "B", "C"], "taste"), win("D", "A", "taste")];
    const run = computeCapabilityVectors(people, comps);
    const d = run.vectors.get("D")?.dimensions.taste;
    expect(d?.state).toBe("insufficient_evidence");
    expect(d?.state === "insufficient_evidence" && d.reason).toBe(
      "1 comparison; need at least 3; 1 unique opponent; need at least 2",
    );
    expect(formatDimensionEstimate(d as never)).toContain("Insufficient Evidence (");
  });

  test("enough comparisons but only one opponent ⇒ insufficient", () => {
    const people = ["A", "B", "C"].map(person);
    const comps = [
      ...roundRobin(["A", "B", "C"], "agency"),
      win("A", "B", "agency"),
      win("A", "B", "agency"),
    ];
    // Add D who has 4 comparisons all against A.
    const d = person("D");
    const comps2 = [
      ...comps,
      win("D", "A", "agency"),
      win("D", "A", "agency"),
      win("A", "D", "agency"),
      win("D", "A", "agency"),
    ];
    const run = computeCapabilityVectors([...people, d], comps2);
    const est = run.vectors.get("D")?.dimensions.agency;
    expect(est?.state).toBe("insufficient_evidence");
    expect(est?.state === "insufficient_evidence" && est.reason).toContain("1 unique opponent");
  });

  test("percentiles are relative to the person's own pool", () => {
    const small = ["S1", "S2", "S3"];
    const big = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10"];
    const people = [...small, ...big].map(person);
    const comps = [...roundRobin(small, "output", 2), ...roundRobin(big, "output", 1)];
    const run = computeCapabilityVectors(people, comps);
    const s1 = run.vectors.get("S1")?.dimensions.output;
    const s2 = run.vectors.get("S2")?.dimensions.output;
    const s3 = run.vectors.get("S3")?.dimensions.output;
    const b1 = run.vectors.get("B1")?.dimensions.output;
    const b10 = run.vectors.get("B10")?.dimensions.output;
    expect(s1?.state).toBe("estimated");
    expect(s1?.state === "estimated" && s1.percentile).toBe(100);
    expect(s2?.state === "estimated" && s2.percentile).toBe(50);
    expect(s3?.state === "estimated" && s3.percentile).toBe(0);
    expect(s1?.state === "estimated" && s1.poolSize).toBe(3);
    expect(s1?.state === "estimated" && s1.componentId).toBe("output:S1");
    expect(b1?.state === "estimated" && b1.percentile).toBe(100);
    expect(b10?.state === "estimated" && b10.percentile).toBe(0);
    expect(b1?.state === "estimated" && b1.poolSize).toBe(10);
    expect(b1?.state === "estimated" && b1.componentId).toBe("output:B1");
  });

  test("Candidate-F shape: estimated on one dimension, insufficient on another", () => {
    const ids = ["F", "P1", "P2", "P3", "P4"];
    const people = ids.map(person);
    const comps = [
      ...roundRobin(ids, "problem_solving", 2),
      ...roundRobin(["P1", "P2", "P3", "P4"], "generativity", 2),
    ];
    const run = computeCapabilityVectors(people, comps);
    const f = run.vectors.get("F");
    expect(f?.dimensions.problem_solving.state).toBe("estimated");
    expect(f?.dimensions.generativity.state).toBe("insufficient_evidence");
    expect(f?.dimensions.generativity.comparisonCount).toBe(0);
    for (const d of DIMENSIONS) expect(f?.dimensions[d]).toBeDefined();
  });

  test("estimated entries carry evidence: recent ≤5, tallies, pool info, explanation", () => {
    const ids = ["A", "B", "C", "D"];
    const comps = roundRobin(ids, "taste", 3);
    const run = computeCapabilityVectors(ids.map(person), comps);
    const a = run.vectors.get("A")?.dimensions.taste;
    expect(a?.state).toBe("estimated");
    if (a?.state !== "estimated") throw new Error("expected estimated");
    expect(a.recent.length).toBeLessThanOrEqual(5);
    expect(a.recent.every((c) => c.personAId === "A" || c.personBId === "A")).toBe(true);
    expect(a.wins).toBe(9);
    expect(a.losses).toBe(0);
    expect(a.comparisonCount).toBe(9);
    expect(a.opponentCount).toBe(3);
    expect(a.poolComparisonCount).toBe(18);
    expect(a.poolConfidence).toBe("low");
    expect(run.vectors.get("A")?.explanation).toContain("should not be interpreted as an absolute");
    expect(formatDimensionEstimate(a)).toBe(
      "Estimated percentile: 100th · Comparisons: 9 · Unique opponents: 3",
    );
  });

  test("thresholds come from the spec unless overridden", () => {
    const ids = ["A", "B", "C"];
    const comps = roundRobin(ids, "agency", 1); // each person: 2 comparisons, 2 opponents
    const strict = computeCapabilityVectors(ids.map(person), comps);
    expect(strict.vectors.get("A")?.dimensions.agency.state).toBe("insufficient_evidence");
    const lenient = computeCapabilityVectors(ids.map(person), comps, {
      spec: { ...BRADLEY_TERRY_V1_0_0, minComparisons: 2 },
    });
    expect(lenient.vectors.get("A")?.dimensions.agency.state).toBe("estimated");
    const override = computeCapabilityVectors(ids.map(person), comps, { minComparisons: 2 });
    expect(override.options.minComparisons).toBe(2);
  });

  test("no scalar aggregate exists on the vector", () => {
    const run = computeCapabilityVectors(["A", "B"].map(person), []);
    const v = run.vectors.get("A") as object;
    for (const key of ["overall", "total", "score", "average", "mean"]) {
      expect(key in v).toBe(false);
    }
  });

  test("seed: Cleo and Alice estimated high on problem_solving; Fox generativity insufficient; Dev insufficient everywhere", () => {
    const data = generateSeed();
    const run = computeCapabilityVectors(data.people, data.comparisons);
    const cleo = run.vectors.get("p-cleo")?.dimensions.problem_solving;
    const alice = run.vectors.get("p-alice")?.dimensions.problem_solving;
    expect(cleo?.state).toBe("estimated");
    expect(alice?.state).toBe("estimated");
    expect(cleo?.state === "estimated" && cleo.percentile).toBeGreaterThanOrEqual(75);
    expect(alice?.state === "estimated" && alice.percentile).toBeGreaterThanOrEqual(70);
    expect(run.vectors.get("p-fox")?.dimensions.generativity.state).toBe("insufficient_evidence");
    expect(run.vectors.get("p-fox")?.dimensions.problem_solving.state).toBe("estimated");
    for (const d of DIMENSIONS) {
      expect(run.vectors.get("p-dev")?.dimensions[d].state).toBe("insufficient_evidence");
    }
    expect(estimatedEntries(run).length).toBeGreaterThan(20);
  });

  test("previous run warm-starts and, with κ, anchors the refit", () => {
    const data = generateSeed();
    const first = computeCapabilityVectors(data.people, data.comparisons);
    const extra = win("p-bram", "p-cleo", "problem_solving", 200);
    const anchored = computeCapabilityVectors(data.people, [...data.comparisons, extra], {
      previous: first,
      anchorStrength: 10,
    });
    const free = computeCapabilityVectors(data.people, [...data.comparisons, extra]);
    expect(anchored.options.anchored).toBe(true);
    expect(anchored.runsByDimension.problem_solving.options.anchorStrength).toBe(10);
    const prevTheta = first.runsByDimension.problem_solving.fits.find(
      (f) => f.personId === "p-cleo",
    )?.theta as number;
    const anchoredTheta = anchored.runsByDimension.problem_solving.fits.find(
      (f) => f.personId === "p-cleo",
    )?.theta as number;
    const freeTheta = free.runsByDimension.problem_solving.fits.find((f) => f.personId === "p-cleo")
      ?.theta as number;
    expect(Math.abs(anchoredTheta - prevTheta)).toBeLessThanOrEqual(
      Math.abs(freeTheta - prevTheta),
    );
  });
});

describe("poolConfidence heuristic", () => {
  test("bands", () => {
    expect(poolConfidence(15, 6)).toBe("high");
    expect(poolConfidence(14, 6)).toBe("medium");
    expect(poolConfidence(6, 3)).toBe("medium");
    expect(poolConfidence(5, 10)).toBe("low");
    expect(poolConfidence(20, 2)).toBe("low");
  });
});

describe("runCapabilityVectors", () => {
  test("records the full spec and the resolved thresholds", () => {
    const data = generateSeed();
    const run = runCapabilityVectors(data.people, data.comparisons, T0);
    expect(run.modelType).toBe("bradley_terry_v1");
    expect(run.modelVersion).toBe("1.0.0");
    expect(run.parameters.spec).toEqual(BRADLEY_TERRY_V1_0_0);
    expect(run.parameters.minComparisons).toBe(3);
    expect(run.parameters.anchored).toBe(false);
    expect(run.outputs.vectors.size).toBe(data.people.length);
    expect("previous" in run.parameters).toBe(false);
  });
});
