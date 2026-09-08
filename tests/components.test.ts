import { describe, expect, test } from "bun:test";
import type { Comparison, ComparisonOutcome, Dimension } from "../src/domain/types.ts";
import { comparisonComponents, connectedComponents } from "../src/inference/components.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let n = 0;

function cmp(
  a: string,
  b: string,
  dimension: Dimension = "taste",
  outcome: ComparisonOutcome = "a",
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
    createdAt: T0,
  };
}

const ids = ["a", "b", "c", "x", "y", "z", "lonely"];
const triangles = [
  cmp("a", "b"),
  cmp("b", "c"),
  cmp("c", "a"),
  cmp("x", "y"),
  cmp("y", "z"),
  cmp("z", "x"),
];

describe("comparisonComponents", () => {
  test("two disjoint triangles ⇒ two components plus a singleton", () => {
    const { components, byPerson } = comparisonComponents(ids, triangles, "taste");
    expect(components.map((c) => c.componentId)).toEqual(["taste:a", "taste:lonely", "taste:x"]);
    expect(byPerson.get("b")).toBe("taste:a");
    expect(byPerson.get("z")).toBe("taste:x");
    expect(byPerson.get("lonely")).toBe("taste:lonely");
    expect(components.find((c) => c.componentId === "taste:a")?.comparisonCount).toBe(3);
    expect(components.find((c) => c.componentId === "taste:lonely")?.members).toEqual(["lonely"]);
  });

  test("one bridging comparison merges the triangles", () => {
    const { components } = comparisonComponents(ids, [...triangles, cmp("c", "x")], "taste");
    expect(components.map((c) => c.componentId)).toEqual(["taste:a", "taste:lonely"]);
    expect(components[0]?.members).toEqual(["a", "b", "c", "x", "y", "z"]);
  });

  test("a skip or insufficient_observation does not bridge; a tie only when included", () => {
    const skip = comparisonComponents(ids, [...triangles, cmp("c", "x", "taste", "skip")], "taste");
    expect(skip.components).toHaveLength(3);
    const insufficient = comparisonComponents(
      ids,
      [...triangles, cmp("c", "x", "taste", "insufficient_observation")],
      "taste",
    );
    expect(insufficient.components).toHaveLength(3);

    const tieIgnored = comparisonComponents(
      ids,
      [...triangles, cmp("c", "x", "taste", "tie")],
      "taste",
    );
    expect(tieIgnored.components).toHaveLength(3);
    const tieIncluded = comparisonComponents(
      ids,
      [...triangles, cmp("c", "x", "taste", "tie")],
      "taste",
      { includeTies: true },
    );
    expect(tieIncluded.components).toHaveLength(2);
  });

  test("components on taste do not leak into agency", () => {
    const { components } = comparisonComponents(ids, triangles, "agency");
    expect(components).toHaveLength(ids.length);
    for (const c of components) expect(c.comparisonCount).toBe(0);
  });

  test("edges to unknown ids are ignored", () => {
    const { components } = connectedComponents(
      ["a", "b"],
      [
        ["a", "ghost"],
        ["ghost", "b"],
      ],
      "t",
    );
    expect(components).toHaveLength(2);
  });
});
