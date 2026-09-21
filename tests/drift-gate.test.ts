import { describe, expect, test } from "bun:test";
import { currentSpecVersions, movedSpecs } from "../scripts/drift-gate.ts";
import { CURRENT_SPECS } from "../src/models/registry.ts";
import type { ModelSpec } from "../src/models/spec.ts";

/** Two registry snapshots, as `kind → current version`. */
const BASE = { referral_signal: "0.1.0", bradley_terry: "1.0.0", judge_reliability: "2.0.0" };

describe("drift gate: which kinds moved", () => {
  test("an unchanged registry moves nothing", () => {
    expect(movedSpecs(BASE, { ...BASE })).toEqual([]);
  });

  test("one bumped kind is one move", () => {
    expect(movedSpecs(BASE, { ...BASE, referral_signal: "0.2.0" })).toEqual([
      { kind: "referral_signal", before: "0.1.0", after: "0.2.0" },
    ]);
  });

  test("several moves come back in kind order", () => {
    expect(
      movedSpecs(BASE, { ...BASE, referral_signal: "0.2.0", judge_reliability: "2.1.0" }),
    ).toEqual([
      { kind: "judge_reliability", before: "2.0.0", after: "2.1.0" },
      { kind: "referral_signal", before: "0.1.0", after: "0.2.0" },
    ]);
  });

  test("a build tag is a different version, and is compared as one", () => {
    expect(movedSpecs(BASE, { ...BASE, referral_signal: "0.1.0+env" })).toEqual([
      { kind: "referral_signal", before: "0.1.0", after: "0.1.0+env" },
    ]);
  });

  /**
   * A kind that only one side has cannot produce a drift report: there is no
   * pair of runs to compare. The gate says nothing about it rather than
   * inventing a baseline — the CHANGELOG invariant is what covers a new kind's
   * first version.
   */
  test("a kind added or removed is not a move", () => {
    expect(movedSpecs(BASE, { ...BASE, career_evidence: "1.0.0" })).toEqual([]);
    const { judge_reliability: _dropped, ...withoutJudge } = BASE;
    expect(movedSpecs(BASE, withoutJudge)).toEqual([]);
  });

  test("currentSpecVersions reads the version off each registered spec", () => {
    expect(currentSpecVersions(CURRENT_SPECS as unknown as Record<string, ModelSpec>)).toEqual({
      referral_signal: "0.1.0",
      bradley_terry: "1.0.0",
      judge_reliability: "2.0.0",
    });
  });

  /** The real registry against itself: HEAD vs HEAD never fails the gate. */
  test("the live registry compared against itself moves nothing", () => {
    const live = currentSpecVersions(CURRENT_SPECS as unknown as Record<string, ModelSpec>);
    expect(movedSpecs(live, live)).toEqual([]);
  });
});
