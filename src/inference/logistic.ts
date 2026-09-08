/**
 * Numerically stable logistic helpers.
 *
 * Why not `Math.log(1 / (1 + Math.exp(-x)))`? For x ≈ −800, `Math.exp(800)`
 * overflows to Infinity, `1 / Infinity` is 0, and `Math.log(0)` is −Infinity.
 * The gradient then becomes NaN and the whole fit is poisoned. Branching on
 * the sign keeps every intermediate finite for any |x| a double can hold.
 */

/** σ(x) = 1 / (1 + e^−x), never NaN, exactly 0 or 1 in the tails. */
export function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }
  const ex = Math.exp(x);
  return ex / (1 + ex);
}

/** softplus(x) = log(1 + e^x), stable for |x| > 700. */
export function log1pExp(x: number): number {
  if (x > 0) return x + Math.log1p(Math.exp(-x));
  return Math.log1p(Math.exp(x));
}

/** log σ(x) = −softplus(−x); ≈ x for very negative x, ≈ 0 for very positive x. */
export function logSigmoid(x: number): number {
  return x < 0 ? x - Math.log1p(Math.exp(x)) : -Math.log1p(Math.exp(-x));
}
