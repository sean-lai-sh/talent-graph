import { describe, expect, test } from "bun:test";
import { summarizeEvaluations } from "../src/analysis/rubricSummary.ts";
import { DIMENSIONS } from "../src/domain/constants.ts";
import type { Evaluation } from "../src/domain/types.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let seq = 0;
function evaluation(
  evaluatorId: string,
  dimension: Evaluation["dimension"],
  score: Evaluation["score"],
): Evaluation {
  seq++;
  return {
    id: `e-${seq}`,
    evaluatorId,
    candidateId: "c",
    dimension,
    score,
    confidence: score === null ? null : 3,
    evidenceText: "Observed.",
    createdAt: T0,
    updatedAt: T0,
  };
}

describe("rubricSummary", () => {
  test("every dimension is present; empty input is all null / zero", () => {
    const s = summarizeEvaluations([]);
    for (const d of DIMENSIONS) {
      expect(s[d]).toEqual({ dimension: d, mean: null, scored: 0, notObserved: 0, evaluators: 0 });
    }
  });

  test("mean over scored only; not-observed counted separately; evaluators distinct", () => {
    const s = summarizeEvaluations([
      evaluation("a", "agency", 4),
      evaluation("b", "agency", 2),
      evaluation("b", "agency", null),
      evaluation("c", "agency", null),
      evaluation("a", "taste", 1),
    ]);
    expect(s.agency).toEqual({
      dimension: "agency",
      mean: 3,
      scored: 2,
      notObserved: 2,
      evaluators: 3,
    });
    expect(s.taste).toEqual({
      dimension: "taste",
      mean: 1,
      scored: 1,
      notObserved: 0,
      evaluators: 1,
    });
    expect(s.output.mean).toBeNull();
  });

  test("a score of 0 is a score, not missing", () => {
    const s = summarizeEvaluations([evaluation("a", "output", 0)]);
    expect(s.output.mean).toBe(0);
    expect(s.output.scored).toBe(1);
  });

  test("seed: Cleo has one rubric evaluation, on output", () => {
    const data = generateSeed();
    const s = summarizeEvaluations(data.evaluations.filter((e) => e.candidateId === "p-cleo"));
    expect(s.output.scored).toBe(1);
    expect(s.output.mean).toBe(2);
    expect(DIMENSIONS.filter((d) => s[d].scored + s[d].notObserved > 0)).toEqual(["output"]);
  });
});
