import { describe, expect, test } from "bun:test";
import {
  informativeComparisons,
  recordSummary,
  recordsByTrait,
} from "../apps/club/lib/comparisonRecord.ts";
import type { ComparisonHistoryRow } from "../apps/club/lib/types.ts";

let seq = 0;

function row(
  overrides: Partial<ComparisonHistoryRow> & Pick<ComparisonHistoryRow, "result" | "otherName">,
): ComparisonHistoryRow {
  seq += 1;
  return {
    id: `c${seq}`,
    dimension: "agency",
    dimensionLabel: "Agency",
    otherId: overrides.otherName.toLowerCase(),
    otherStatus: "candidate",
    evaluatorId: "owner",
    evaluatorName: "Owner",
    outcome: "a",
    confidence: 4,
    evidenceText: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function names(rows: ComparisonHistoryRow[]): string[] {
  return rows.map((r) => r.otherName);
}

function shape(rows: ComparisonHistoryRow[]) {
  return recordsByTrait(rows).map((r) => ({
    dimension: r.dimension,
    label: r.label,
    won: names(r.won),
    lost: names(r.lost),
    tie: names(r.tie),
  }));
}

describe("recordsByTrait", () => {
  test("two losses on Agency make one record with losers in input order", () => {
    const rows = [
      row({ result: "lost", otherName: "Kai" }),
      row({ result: "lost", otherName: "Noor" }),
    ];
    expect(shape(rows)).toEqual([
      { dimension: "agency", label: "Agency", won: [], lost: ["Kai", "Noor"], tie: [] },
    ]);
  });

  test("skip and not_observed rows are dropped", () => {
    const rows = [
      row({ result: "skip", otherName: "Kai" }),
      row({ result: "won", otherName: "Noor" }),
      row({ result: "not_observed", otherName: "Ada" }),
    ];
    expect(names(informativeComparisons(rows))).toEqual(["Noor"]);
    expect(shape(rows)).toEqual([
      { dimension: "agency", label: "Agency", won: ["Noor"], lost: [], tie: [] },
    ]);
    expect(
      shape([
        row({ result: "skip", otherName: "Kai" }),
        row({ result: "not_observed", otherName: "Ada" }),
      ]),
    ).toEqual([]);
  });

  test("a tie on Taste lands only in tie", () => {
    const rows = [
      row({ result: "tie", otherName: "Kai", dimension: "taste", dimensionLabel: "Taste" }),
    ];
    expect(shape(rows)).toEqual([
      { dimension: "taste", label: "Taste", won: [], lost: [], tie: ["Kai"] },
    ]);
  });

  test("traits follow DIMENSIONS order regardless of input order", () => {
    const rows = [
      row({ result: "won", otherName: "Kai" }),
      row({
        result: "lost",
        otherName: "Noor",
        dimension: "problem_solving",
        dimensionLabel: "Problem solving",
      }),
    ];
    expect(shape(rows)).toEqual([
      {
        dimension: "problem_solving",
        label: "Problem solving",
        won: [],
        lost: ["Noor"],
        tie: [],
      },
      { dimension: "agency", label: "Agency", won: ["Kai"], lost: [], tie: [] },
    ]);
  });

  test("empty input gives no records while one row gives one", () => {
    expect(recordsByTrait([])).toEqual([]);
    expect(shape([row({ result: "won", otherName: "Kai" })])).toEqual([
      { dimension: "agency", label: "Agency", won: ["Kai"], lost: [], tie: [] },
    ]);
  });
});

describe("recordSummary", () => {
  test("won–lost with en dash, and a third count only when ties exist", () => {
    const noTies = recordsByTrait([
      row({ result: "lost", otherName: "Kai" }),
      row({ result: "lost", otherName: "Noor" }),
    ]);
    expect(noTies.map(recordSummary)).toEqual(["0\u20132"]);
    const withTie = recordsByTrait([
      row({ result: "won", otherName: "Kai" }),
      row({ result: "tie", otherName: "Noor" }),
    ]);
    expect(withTie.map(recordSummary)).toEqual(["1\u20130\u20131"]);
  });
});
