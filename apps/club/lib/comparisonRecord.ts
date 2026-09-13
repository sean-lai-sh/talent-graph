import { DIMENSIONS } from "../../../src/domain/constants.ts";
import type { Dimension } from "../../../src/domain/types.ts";
import type { ComparisonHistoryRow, ComparisonResult } from "./types.ts";

export type InformativeResult = "won" | "lost" | "tie";

export type InformativeRow = ComparisonHistoryRow & { result: InformativeResult };

export type TraitRecord = {
  dimension: Dimension;
  label: string;
  won: ComparisonHistoryRow[];
  lost: ComparisonHistoryRow[];
  tie: ComparisonHistoryRow[];
};

const INFORMATIVE: ReadonlySet<ComparisonResult> = new Set<InformativeResult>([
  "won",
  "lost",
  "tie",
]);

function isInformative(row: ComparisonHistoryRow): row is InformativeRow {
  return INFORMATIVE.has(row.result);
}

export function informativeComparisons(rows: ComparisonHistoryRow[]): InformativeRow[] {
  return rows.filter(isInformative);
}

export function recordsByTrait(rows: ComparisonHistoryRow[]): TraitRecord[] {
  const table = new Map<Dimension, TraitRecord>();
  for (const row of informativeComparisons(rows)) {
    let record = table.get(row.dimension);
    if (!record) {
      record = { dimension: row.dimension, label: row.dimensionLabel, won: [], lost: [], tie: [] };
      table.set(row.dimension, record);
    }
    record[row.result].push(row);
  }
  return DIMENSIONS.flatMap((dimension) => {
    const record = table.get(dimension);
    return record ? [record] : [];
  });
}

export function recordSummary(record: TraitRecord): string {
  const counts = [record.won.length, record.lost.length];
  if (record.tie.length > 0) counts.push(record.tie.length);
  return counts.join("–");
}
