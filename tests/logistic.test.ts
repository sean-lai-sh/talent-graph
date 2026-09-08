import { describe, expect, test } from "bun:test";
import { log1pExp, logSigmoid, sigmoid } from "../src/inference/logistic.ts";

describe("logistic helpers", () => {
  test("logSigmoid(0) ≈ −ln 2", () => {
    expect(logSigmoid(0)).toBeCloseTo(-Math.LN2, 12);
  });

  test("logSigmoid(−1000) is finite and ≈ −1000", () => {
    const v = logSigmoid(-1000);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeCloseTo(-1000, 6);
  });

  test("logSigmoid(1000) ≈ 0", () => {
    expect(logSigmoid(1000)).toBeCloseTo(0, 12);
    expect(logSigmoid(1000) <= 0).toBe(true);
  });

  test("sigmoid(±1000) ∈ {0, 1} without NaN", () => {
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
    expect(sigmoid(0)).toBe(0.5);
    expect(Number.isNaN(sigmoid(Number.MAX_VALUE))).toBe(false);
  });

  test("log1pExp is stable for |x| > 700 and matches log(1+e^x) in range", () => {
    expect(log1pExp(800)).toBeCloseTo(800, 6);
    expect(log1pExp(-800)).toBeCloseTo(0, 12);
    expect(log1pExp(2)).toBeCloseTo(Math.log(1 + Math.exp(2)), 12);
    expect(logSigmoid(3)).toBeCloseTo(-log1pExp(-3), 12);
  });

  test("the naive formula fails where the stable one does not", () => {
    const naive = Math.log(1 / (1 + Math.exp(800)));
    expect(Number.isFinite(naive)).toBe(false);
    expect(Number.isFinite(logSigmoid(-800))).toBe(true);
  });
});
