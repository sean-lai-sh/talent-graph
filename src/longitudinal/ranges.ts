/**
 * The numeric guards every judgment value passes, live or recorded.
 *
 * One home for them because they are applied twice on purpose: when an answer
 * arrives from the judgment service (`apps/club/lib/longitudinal/jevRecord.ts`,
 * before anything is written down) and again when a stored record is read
 * (`./projections.ts`). Two copies of the same rule would let arrival and
 * projection disagree about what a confidence is, which is the one thing that
 * must never happen — a record that passed on the way in and fails on the way
 * out is a judgment that was paid for and cannot be used.
 *
 * Nothing here clamps or coerces. A value outside the range its field is
 * defined on is not an extreme reading to be pulled back to the edge; it is a
 * value this pipeline cannot represent, and reading it as anything at all
 * would put a number nothing produced into a claim.
 *
 * Deliberately not on the barrel: these are internal guards, not vocabulary.
 */

import { JudgmentInvariantError } from "./records.ts";

/** A number that is actually a number, or a broken invariant. */
export function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new JudgmentInvariantError(`${what} must be a finite number (got ${String(value)})`);
  }
  return value;
}

/**
 * A number inside the range its field is defined on, or a broken invariant.
 *
 * Finiteness is checked first, so `NaN` is reported as what it is rather than
 * as an out-of-range value. Both ends are inclusive.
 */
export function inRange(value: unknown, low: number, high: number, what: string): number {
  const number = finite(value, what);
  if (number < low || number > high) {
    throw new JudgmentInvariantError(
      `${what} must be in [${low}, ${high}] (got ${String(number)})`,
    );
  }
  return number;
}

/** A probability or a confidence: the unit interval, both ends inclusive. */
export function unit(value: unknown, what: string): number {
  return inRange(value, 0, 1, what);
}
