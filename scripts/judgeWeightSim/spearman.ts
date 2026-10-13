/** Spearman correlation. Copied from the PR #116 scenario harness so the pipeline file can stay off that sweep. */

function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.v === order[i]?.v) j++;
    for (let n = i; n <= j; n++) out[(order[n] as { i: number }).i] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(x: readonly number[], y: readonly number[]): number {
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  const mean = (n + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (rx[i] as number) - mean;
    const dy = (ry[i] as number) - mean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}
