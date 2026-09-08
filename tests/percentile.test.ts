import { describe, expect, test } from "bun:test";
import { ordinal, rankPercentiles } from "../src/domain/rank.ts";
import { percentileWithin } from "../src/inference/percentile.ts";

describe("percentileWithin", () => {
  test("three ordered thetas ⇒ 0 / 50 / 100", () => {
    const pct = percentileWithin([
      { id: "lo", theta: -1 },
      { id: "mid", theta: 0 },
      { id: "hi", theta: 2 },
    ]);
    expect(pct.get("lo")).toBe(0);
    expect(pct.get("mid")).toBe(50);
    expect(pct.get("hi")).toBe(100);
  });

  test("ties get the average of the ranks they span", () => {
    const pct = percentileWithin([
      { id: "a", theta: 1 },
      { id: "b", theta: 1 },
      { id: "c", theta: 0 },
      { id: "d", theta: 3 },
    ]);
    // ranks: c=1, a/b share 2&3 ⇒ 2.5, d=4 ⇒ (2.5−1)/3·100 = 50
    expect(pct.get("c")).toBe(0);
    expect(pct.get("a")).toBe(50);
    expect(pct.get("b")).toBe(50);
    expect(pct.get("d")).toBe(100);
  });

  test("single value ⇒ 50; empty ⇒ empty", () => {
    expect(percentileWithin([{ id: "x", theta: 9 }]).get("x")).toBe(50);
    expect(percentileWithin([]).size).toBe(0);
  });

  test("shares the rule with rankPercentiles", () => {
    const items = [
      { id: "a", theta: 0.2 },
      { id: "b", theta: -0.4 },
      { id: "c", theta: 1.1 },
    ];
    const viaRank = rankPercentiles(items.map((i) => ({ id: i.id, value: i.theta })));
    expect(percentileWithin(items)).toEqual(viaRank);
  });
});

describe("ordinal", () => {
  test("suffixes", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(93)).toBe("93rd");
    expect(ordinal(100)).toBe("100th");
    expect(ordinal(0)).toBe("0th");
    expect(ordinal(87.6)).toBe("88th");
  });
});
