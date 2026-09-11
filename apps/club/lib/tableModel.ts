/** Pure list helpers for the candidate table. Nulls sort last in both directions. */

export type SortDir = "asc" | "desc";

export function sortRows<T>(
  rows: readonly T[],
  key: (row: T) => number | string | null | undefined,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const aNull = ka === null || ka === undefined;
    const bNull = kb === null || kb === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof ka === "string" || typeof kb === "string") {
      return sign * String(ka).localeCompare(String(kb));
    }
    return sign * (ka - kb);
  });
}
