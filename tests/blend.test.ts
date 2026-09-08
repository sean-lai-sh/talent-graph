import { describe, expect, test } from "bun:test";
import { alphaSchedule, blendRuns } from "../src/models/blend.ts";

const before = new Map<string, number | null>([
  ["a", 10],
  ["b", 50],
  ["c", null],
  ["d", 20],
]);
const after = new Map<string, number | null>([
  ["a", 30],
  ["b", 50],
  ["c", 80],
  ["e", 5],
]);

describe("blendRuns", () => {
  test("α = 0 ⇒ before, α = 1 ⇒ after, α = 0.5 ⇒ midpoint", () => {
    expect(blendRuns(before, after, 0).get("a")).toBe(10);
    expect(blendRuns(before, after, 1).get("a")).toBe(30);
    expect(blendRuns(before, after, 0.5).get("a")).toBe(20);
    expect(blendRuns(before, after, 0.25).get("b")).toBe(50);
  });

  test("null on either side ⇒ null (missing ≠ low)", () => {
    const out = blendRuns(before, after, 0.5);
    expect(out.get("c")).toBeNull();
    expect(out.get("d")).toBeNull();
    expect(out.get("e")).toBeNull();
    expect(out.size).toBe(5);
  });

  test("rejects α outside [0,1]", () => {
    expect(() => blendRuns(before, after, 1.5)).toThrow();
    expect(() => blendRuns(before, after, -0.1)).toThrow();
  });
});

describe("alphaSchedule", () => {
  const start = new Date("2026-03-01T00:00:00Z");
  const end = new Date("2026-03-11T00:00:00Z");

  test("linear: 0 at start, 1 at end, clamped, midpoint 0.5", () => {
    expect(alphaSchedule("linear", { start, end, now: start })).toBe(0);
    expect(alphaSchedule("linear", { start, end, now: end })).toBe(1);
    expect(alphaSchedule("linear", { start, end, now: new Date("2026-03-06T00:00:00Z") })).toBe(
      0.5,
    );
    expect(alphaSchedule("linear", { start, end, now: new Date("2026-02-01T00:00:00Z") })).toBe(0);
    expect(alphaSchedule("linear", { start, end, now: new Date("2026-04-01T00:00:00Z") })).toBe(1);
    expect(() => alphaSchedule("linear", { start, now: start })).toThrow();
  });

  test("byObservations: fraction of saturation, clamped, 0 before start", () => {
    expect(
      alphaSchedule("byObservations", {
        start,
        now: end,
        newObservationsSince: 25,
        saturationCount: 100,
      }),
    ).toBe(0.25);
    expect(
      alphaSchedule("byObservations", {
        start,
        now: end,
        newObservationsSince: 500,
        saturationCount: 100,
      }),
    ).toBe(1);
    expect(
      alphaSchedule("byObservations", {
        start,
        now: new Date("2026-01-01T00:00:00Z"),
        newObservationsSince: 50,
        saturationCount: 100,
      }),
    ).toBe(0);
    expect(() => alphaSchedule("byObservations", { start, now: end })).toThrow();
  });
});
