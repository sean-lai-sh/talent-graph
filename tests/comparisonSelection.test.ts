import { describe, expect, test } from "bun:test";
import { DIMENSION_PROMPTS } from "../src/domain/constants.ts";
import type { Comparison, Dimension, Person } from "../src/domain/types.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { selectComparisons } from "../src/inference/comparisonSelection.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-03-01T00:00:00.000Z");
let n = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function cmp(
  a: string,
  b: string,
  outcome: "a" | "b" | "skip" = "a",
  createdAt = T0,
  dimension: Dimension = "taste",
): Comparison {
  n++;
  return {
    id: `c-${n}`,
    evaluatorId: "judge",
    personAId: a,
    personBId: b,
    dimension,
    outcome,
    winnerId: outcome === "a" ? a : outcome === "b" ? b : null,
    confidence: null,
    createdAt,
  };
}

function find(props: ReturnType<typeof selectComparisons>, a: string, b: string) {
  return props.find(
    (p) => (p.personAId === a && p.personBId === b) || (p.personAId === b && p.personBId === a),
  );
}

describe("selectComparisons", () => {
  test("never-compared pair outranks a pair compared yesterday, all else equal", () => {
    // Four people in one dense pool, then one pair compared yesterday.
    const ids = ["A", "B", "C", "D"];
    const comps: Comparison[] = [];
    for (const x of ids)
      for (const y of ids) if (x < y) comps.push(cmp(x, y, "a"), cmp(y, x, "a"), cmp(x, y, "a"));
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    comps.push(cmp("A", "B", "skip", yesterday));
    const run = computeCapabilityVectors(ids.map(person), comps);
    const props = selectComparisons("taste", run, comps, { now: NOW, limit: 100 });
    const ab = find(props, "A", "B");
    const cd = find(props, "C", "D");
    expect(ab?.parts.novelty).toBeCloseTo(1 / 30, 12);
    // C/D were compared at T0, ~59 days ago ⇒ novelty saturates at 1.
    expect(cd?.parts.novelty).toBe(1);
    expect((cd?.priority ?? 0) > (ab?.priority ?? 0)).toBe(true);
  });

  test("close θ pair outranks far θ pair", () => {
    const ids = ["A", "B", "C"];
    // A ≫ C, B ≈ A: A beats C a lot, A and B split.
    const comps = [
      ...Array.from({ length: 6 }, () => cmp("A", "C")),
      ...Array.from({ length: 3 }, () => cmp("A", "B")),
      ...Array.from({ length: 3 }, () => cmp("B", "A")),
      ...Array.from({ length: 6 }, () => cmp("B", "C")),
    ];
    const run = computeCapabilityVectors(ids.map(person), comps);
    const props = selectComparisons("taste", run, comps, { now: NOW, limit: 100 });
    const ab = find(props, "A", "B");
    const ac = find(props, "A", "C");
    expect((ab?.parts.closeness ?? 0) > (ac?.parts.closeness ?? 0)).toBe(true);
  });

  test("a sparse person is proposed more often than a heavily compared one", () => {
    const data = generateSeed();
    const run = computeCapabilityVectors(data.people, data.comparisons);
    const props = selectComparisons("problem_solving", run, data.comparisons, {
      now: NOW,
      limit: 40,
    });
    const count = (id: string) =>
      props.filter((p) => p.personAId === id || p.personBId === id).length;
    // Dev has ≤2 comparisons; Fox has ≥10 on problem_solving.
    expect(count("p-dev")).toBeGreaterThan(count("p-fox"));
  });

  test("evaluator is never proposed and candidatePool restricts pairs", () => {
    const data = generateSeed();
    const run = computeCapabilityVectors(data.people, data.comparisons);
    const props = selectComparisons("agency", run, data.comparisons, {
      now: NOW,
      evaluatorId: "p-alice",
      candidatePool: ["p-alice", "p-bram", "p-cleo", "p-fox"],
      limit: 100,
    });
    expect(props.length).toBe(3);
    for (const p of props) {
      expect(p.personAId).not.toBe("p-alice");
      expect(p.personBId).not.toBe("p-alice");
      expect(p.personAId < p.personBId).toBe(true);
      expect(p.prompt).toBe(DIMENSION_PROMPTS.agency);
      expect(p.dimension).toBe("agency");
    }
  });

  test("insufficient side ⇒ closeness 0.5; cross-component uses the bonus", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z", "Lone"];
    const comps = [
      ...["A", "B", "C"].flatMap((x) =>
        ["A", "B", "C"].filter((y) => x < y).flatMap((y) => [cmp(x, y), cmp(y, x)]),
      ),
      ...["X", "Y", "Z"].flatMap((x) =>
        ["X", "Y", "Z"].filter((y) => x < y).flatMap((y) => [cmp(x, y), cmp(y, x)]),
      ),
    ];
    const run = computeCapabilityVectors(ids.map(person), comps, { minComparisons: 2 });
    const props = selectComparisons("taste", run, comps, {
      now: NOW,
      limit: 100,
      crossComponentBonus: 1.5,
    });
    expect(find(props, "A", "Lone")?.parts.closeness).toBe(0.5);
    expect(find(props, "A", "X")?.parts.closeness).toBe(0.75);
    expect(find(props, "A", "B")?.parts.closeness).toBeCloseTo(1, 6);
  });

  test("deterministic and honours limit and weights", () => {
    const data = generateSeed();
    const run = computeCapabilityVectors(data.people, data.comparisons);
    const opts = { now: NOW, limit: 5, weights: { a: 2, b: 0, c: 1 } };
    const first = selectComparisons("output", run, data.comparisons, opts);
    const second = selectComparisons("output", run, data.comparisons, opts);
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    for (const p of first) {
      expect(p.priority).toBeCloseTo(2 * p.parts.uncertainty + p.parts.novelty, 12);
    }
    for (let i = 1; i < first.length; i++) {
      expect((first[i - 1]?.priority ?? 0) >= (first[i]?.priority ?? 0)).toBe(true);
    }
  });
});
