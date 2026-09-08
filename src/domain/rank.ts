/**
 * Rank → percentile, shared by scoring and inference so both sides of the
 * under-recognition gap use the same rule.
 *
 *   pct = 100 · (rank − 1) / (n − 1)   for n ≥ 2, ascending rank, ties get the
 *                                       average of the ranks they span
 *   pct = 50                            for n = 1 (callers usually mark this
 *                                       insufficient anyway)
 */

export interface Ranked {
  id: string;
  value: number;
}

export function rankPercentiles(items: readonly Ranked[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = items.length;
  if (n === 0) return out;
  if (n === 1) {
    const only = items[0];
    if (only) out.set(only.id, 50);
    return out;
  }

  const sorted = [...items].sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1]?.value === sorted[i]?.value) j++;
    // ranks i+1 .. j+1 (1-based) share the average rank
    const avgRank = (i + 1 + (j + 1)) / 2;
    const pct = (100 * (avgRank - 1)) / (n - 1);
    for (let k = i; k <= j; k++) {
      const item = sorted[k];
      if (item) out.set(item.id, pct);
    }
    i = j + 1;
  }
  return out;
}

/** "1st", "2nd", "3rd", "11th", "93rd" … for display. */
export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1:
      return `${v}st`;
    case 2:
      return `${v}nd`;
    case 3:
      return `${v}rd`;
    default:
      return `${v}th`;
  }
}
