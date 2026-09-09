import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome, Person, Referral, Scale5 } from "../src/domain/types.ts";
import { buildOutcomeCohort } from "../src/judges/outcomes.ts";
import {
  computeJudgeCalibration,
  estimateJudgeReliability,
  reliabilityWeights,
  scoreReferralPredictions,
} from "../src/judges/reliability.ts";
import {
  computeScoutInformationGain,
  DEFAULT_SCOUT_SHRINKAGE,
  scoreScoutPredictions,
  scoutSlopeGapDays,
} from "../src/judges/scout.ts";
import { residualSlope } from "../src/judges/slope.ts";
import { JUDGE_RELIABILITY_V2_0_0, JUDGE_RELIABILITY_V3_0_0 } from "../src/models/registry.ts";
import type { JudgeReliabilitySpec } from "../src/models/spec.ts";
import { computeReferralSignal } from "../src/scoring/referralSignal.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(T0.getTime() + n * DAY);
const REF_DAY = 20;
const NOW = day(400);
const V2 = JUDGE_RELIABILITY_V2_0_0;
const V3 = JUDGE_RELIABILITY_V3_0_0;

let seq = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function referral(
  from: string,
  to: string,
  conviction: Scale5,
  createdDay = REF_DAY,
  overrides: Partial<Referral> = {},
): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: from,
    candidateId: to,
    conviction,
    confidence: conviction,
    relationshipDepth: conviction,
    evidenceType: "firsthand_work",
    evidenceText: "Seen it.",
    createdAt: day(createdDay),
    updatedAt: day(createdDay),
    ...overrides,
  };
}

function outcome(
  personId: string,
  value: number | null,
  observedDay: number,
  kind = "shipped_project",
): Outcome {
  seq++;
  return {
    id: `o-${seq}`,
    personId,
    opportunityId: null,
    kind,
    value,
    observedAt: day(observedDay),
    createdAt: day(observedDay),
  };
}

/** Three-person kind at t0 plus a later spike so `id` (the low name) rises. */
function isolatedRise(id: string, t0Day = REF_DAY): Outcome[] {
  const kind = `rise-${id}`;
  return [
    outcome(id, 1, t0Day, kind),
    outcome(`${id}-mid`, 5, t0Day, kind),
    outcome(`${id}-hi`, 9, t0Day, kind),
    outcome(id, 100, t0Day + 70, kind),
  ];
}

/** Shared triad: `lo` rises after t0, `hi` falls. Outcomes exist at t1. */
function compoundingTriad(t0Day = REF_DAY): Outcome[] {
  return [
    outcome("lo", 1, t0Day),
    outcome("mid", 5, t0Day),
    outcome("hi", 9, t0Day),
    outcome("lo", 100, t0Day + 70),
  ];
}

function willCompound(
  from: string,
  to: string,
  conviction: Scale5 = 3,
  createdDay = REF_DAY,
): Referral {
  return referral(from, to, conviction, createdDay, { forecastKind: "will_compound" });
}

function slopeOf(personId: string, outcomes: Outcome[], spec: JudgeReliabilitySpec = V2) {
  const t0 = day(REF_DAY);
  const t1 = day(REF_DAY + scoutSlopeGapDays(spec));
  return residualSlope({ personId, outcomes, t0, t1, spec });
}

function definedDelta(
  personId: string,
  outcomes: Outcome[],
  spec: JudgeReliabilitySpec = V2,
): number {
  const slope = slopeOf(personId, outcomes, spec);
  if (slope.state !== "defined" || slope.delta === null) {
    throw new Error(`expected defined slope for ${personId}, got ${slope.state}`);
  }
  return slope.delta;
}

describe("scoutSlopeGapDays (window rule)", () => {
  test("t1 − t0 is max(observationWindowDays, slopeMinGapDays ?? 90)", () => {
    expect(V2.slopeMinGapDays).toBeUndefined();
    expect(scoutSlopeGapDays(V2)).toBe(Math.max(V2.observationWindowDays, 90));
    expect(scoutSlopeGapDays(V2)).toBe(180);

    expect(V3.slopeMinGapDays).toBe(90);
    expect(scoutSlopeGapDays(V3)).toBe(Math.max(V3.observationWindowDays, 90));
    expect(scoutSlopeGapDays(V3)).toBe(180);

    const gapFromMin: JudgeReliabilitySpec = {
      ...V3,
      observationWindowDays: 40,
      slopeMinGapDays: 90,
    };
    expect(scoutSlopeGapDays(gapFromMin)).toBe(90);

    const gapFromWindow: JudgeReliabilitySpec = {
      ...V3,
      observationWindowDays: 200,
      slopeMinGapDays: 30,
    };
    expect(scoutSlopeGapDays(gapFromWindow)).toBe(200);
  });

  test("scored rows use t0 = createdAt and t1 = createdAt + gap; undefined slope is skipped", () => {
    const outcomes = compoundingTriad();
    const ref = willCompound("u", "lo");
    const { predictions } = scoreScoutPredictions({ referrals: [ref], outcomes, spec: V2 });
    expect(predictions).toHaveLength(1);
    expect(predictions[0]?.t0.getTime()).toBe(ref.createdAt.getTime());
    expect(predictions[0]?.t1.getTime()).toBe(
      ref.createdAt.getTime() + scoutSlopeGapDays(V2) * DAY,
    );
    expect(slopeOf("lo", outcomes).state).toBe("defined");

    const tight: JudgeReliabilitySpec = { ...V3, observationWindowDays: 40, slopeMinGapDays: 90 };
    const { predictions: tightRows } = scoreScoutPredictions({
      referrals: [ref],
      outcomes,
      spec: tight,
    });
    expect(tightRows[0]?.t1.getTime()).toBe(ref.createdAt.getTime() + 90 * DAY);

    // No residual at t0 (outcomes only after the window) ⇒ skip, not IG = 0.
    const lateOnly = [outcome("ghost", 1, 300), outcome("g2", 5, 300), outcome("g3", 9, 300)];
    const ghost = willCompound("u", "ghost");
    const scored = scoreScoutPredictions({ referrals: [ghost], outcomes: lateOnly, spec: V2 });
    expect(scored.predictions).toHaveLength(0);
    expect(scored.skipped).toEqual([{ referralId: ghost.id, reason: "undefined_slope" }]);
    const gain = computeScoutInformationGain({
      people: [person("u")],
      referrals: [ghost],
      outcomes: lateOnly,
      now: NOW,
      spec: V2,
    });
    expect(gain.get("u")).toMatchObject({ gain: 0, evaluatedCount: 0, rawGain: null });
  });
});

describe("scoreScoutPredictions / computeScoutInformationGain", () => {
  test("omitted or unspecified forecastKind ⇒ no IG rows; Ĝ_u is the prior 0", () => {
    const outcomes = compoundingTriad();
    const omitted = referral("u", "lo", 5);
    const unspecified = referral("v", "lo", 5, REF_DAY, { forecastKind: "unspecified" });
    expect(omitted.forecastKind).toBeUndefined();

    const scored = scoreScoutPredictions({
      referrals: [omitted, unspecified],
      outcomes,
      spec: V2,
    });
    expect(scored.predictions).toHaveLength(0);
    expect(scored.skipped.map((s) => s.reason)).toEqual(["not_will_compound", "not_will_compound"]);

    const gains = computeScoutInformationGain({
      people: [person("u"), person("v")],
      referrals: [omitted, unspecified],
      outcomes,
      now: NOW,
      spec: V2,
    });
    expect(gains.get("u")).toMatchObject({
      judgeId: "u",
      gain: 0,
      evaluatedCount: 0,
      rawGain: null,
    });
    expect(gains.get("v")).toMatchObject({ gain: 0, evaluatedCount: 0, rawGain: null });
    expect(gains.get("u")?.updatedAt).toEqual(NOW);
    expect(gains.get("u")?.updatedAt).not.toBe(NOW);
  });

  test("will_compound + positive ΔR* + π = 0 ⇒ IG = ΔR*", () => {
    const outcomes = compoundingTriad();
    const delta = definedDelta("lo", outcomes);
    expect(delta).toBeGreaterThan(0);

    const ref = willCompound("u", "lo", 2);
    const scored = scoreScoutPredictions({ referrals: [ref], outcomes, spec: V2 });
    expect(scored.predictions).toHaveLength(1);
    expect(scored.predictions[0]?.priorSignal).toBe(0);
    expect(scored.predictions[0]?.delta).toBe(delta);
    expect(scored.predictions[0]?.informationGain).toBe(delta);

    const gains = computeScoutInformationGain({
      people: [person("u")],
      referrals: [ref],
      outcomes,
      now: NOW,
      spec: V2,
    });
    expect(gains.get("u")?.rawGain).toBe(delta);
    expect(gains.get("u")?.evaluatedCount).toBe(1);
  });

  test("π = 1 ⇒ IG = 0 even if the slope is huge", () => {
    const outcomes = compoundingTriad();
    const delta = definedDelta("lo", outcomes);
    expect(delta).toBeGreaterThan(0);

    // Five max-strength V0 referrals from *other* judges before t_uv fill Top-K.
    const priors = ["s1", "s2", "s3", "s4", "s5"].map((id) => referral(id, "lo", 5, 1));
    expect(computeReferralSignal("lo", priors).s).toBe(1);

    const scoutRef = willCompound("u", "lo", 5);
    const scored = scoreScoutPredictions({
      referrals: [...priors, scoutRef],
      outcomes,
      spec: V2,
    });
    const row = scored.predictions.find((p) => p.referralId === scoutRef.id);
    expect(row?.priorSignal).toBe(1);
    expect(row?.delta).toBe(delta);
    expect(row?.informationGain).toBe(0);

    const gains = computeScoutInformationGain({
      people: [person("u")],
      referrals: [...priors, scoutRef],
      outcomes,
      now: NOW,
      spec: V2,
    });
    expect(gains.get("u")?.rawGain).toBe(0);
    expect(gains.get("u")?.gain).toBe(0);
    expect(gains.get("u")?.evaluatedCount).toBe(1);
  });

  test("negative ΔR* ⇒ IG = 0 via max(·, 0) and the row still counts toward n", () => {
    const outcomes = compoundingTriad();
    const delta = definedDelta("hi", outcomes);
    expect(delta).toBeLessThan(0);

    const ref = willCompound("u", "hi", 5);
    const scored = scoreScoutPredictions({ referrals: [ref], outcomes, spec: V2 });
    expect(scored.predictions).toHaveLength(1);
    expect(scored.predictions[0]?.informationGain).toBe(0);
    expect(scored.predictions[0]?.delta).toBe(delta);

    const gains = computeScoutInformationGain({
      people: [person("u")],
      referrals: [ref],
      outcomes,
      now: NOW,
      spec: V2,
    });
    // Eligible (not a skip): raw mean 0, n = 1, shrunk Ĝ = 0. Distinct from n = 0.
    expect(gains.get("u")).toMatchObject({
      evaluatedCount: 1,
      rawGain: 0,
      gain: 0,
    });
  });

  test("same slope, different conviction ⇒ same IG (x_uv does not enter)", () => {
    const outcomes = compoundingTriad();
    const delta = definedDelta("lo", outcomes);
    // Same createdAt: neither referral is in the other's π (strictly before t_uv).
    const mild = willCompound("mild", "lo", 1);
    const hot = willCompound("hot", "lo", 5);
    expect(mild.createdAt.getTime()).toBe(hot.createdAt.getTime());
    expect(mild.conviction).not.toBe(hot.conviction);

    const scored = scoreScoutPredictions({ referrals: [mild, hot], outcomes, spec: V2 });
    expect(scored.predictions).toHaveLength(2);
    expect(scored.predictions[0]?.priorSignal).toBe(0);
    expect(scored.predictions[1]?.priorSignal).toBe(0);
    expect(scored.predictions[0]?.delta).toBe(delta);
    expect(scored.predictions[1]?.delta).toBe(delta);
    expect(scored.predictions[0]?.informationGain).toBe(scored.predictions[1]?.informationGain);
    expect(scored.predictions[0]?.informationGain).toBe(delta);
  });

  test("shrinkage closed form: 1 hit vs 5 identical hits, λ = 3", () => {
    expect(DEFAULT_SCOUT_SHRINKAGE).toBe(3);
    expect(V2.scoutShrinkage).toBeUndefined();
    expect(V3.scoutShrinkage).toBe(3);

    const oneId = "c1";
    const fiveIds = ["c2", "c3", "c4", "c5", "c6"];
    const outcomes = [oneId, ...fiveIds].flatMap((id) => isolatedRise(id));
    const oneRef = willCompound("one", oneId);
    const fiveRefs = fiveIds.map((id) => willCompound("five", id));

    const deltas = [oneId, ...fiveIds].map((id) => definedDelta(id, outcomes));
    expect(deltas.every((d) => d === deltas[0])).toBe(true);
    const g = deltas[0] as number;
    expect(g).toBeGreaterThan(0);

    const gains = computeScoutInformationGain({
      people: [person("one"), person("five")],
      referrals: [oneRef, ...fiveRefs],
      outcomes,
      now: NOW,
      spec: V2,
    });
    expect(gains.get("one")?.evaluatedCount).toBe(1);
    expect(gains.get("five")?.evaluatedCount).toBe(5);
    expect(gains.get("one")?.rawGain).toBeCloseTo(g, 12);
    expect(gains.get("five")?.rawGain).toBeCloseTo(g, 12);
    // Ĝ = n/(n+3) · mean(IG) + 3/(n+3) · 0
    expect(gains.get("one")?.gain).toBeCloseTo((1 / 4) * g, 12);
    expect(gains.get("five")?.gain).toBeCloseTo((5 / 8) * g, 12);

    const custom: JudgeReliabilitySpec = { ...V3, scoutShrinkage: 7 };
    const customGains = computeScoutInformationGain({
      people: [person("one")],
      referrals: [oneRef],
      outcomes,
      now: NOW,
      spec: custom,
    });
    expect(customGains.get("one")?.gain).toBeCloseTo((1 / 8) * g, 12);
  });

  test("computeJudgeCalibration reliability maps are identical with scout attached", () => {
    const people = ["u", "lo", "mid", "hi"].map(person);
    const refs = [willCompound("u", "lo", 4), referral("u", "hi", 5)];
    const outcomes = compoundingTriad();

    const run = computeJudgeCalibration({
      people,
      referrals: refs,
      outcomes,
      now: NOW,
      spec: V2,
    });
    const cohort = buildOutcomeCohort(outcomes, [], V2, NOW);
    const { predictions } = scoreReferralPredictions(refs, cohort);
    const estimates = estimateJudgeReliability(
      people.map((p) => p.id),
      predictions,
      V2,
    );

    expect([...run.estimates.entries()]).toEqual([...estimates.entries()]);
    expect(reliabilityWeights(run)).toEqual(
      new Map([...estimates.values()].map((e) => [e.judgeId, e.reliability])),
    );
    expect(run.scout.get("u")?.evaluatedCount).toBe(1);
    expect(run.scout.get("u")?.rawGain).toBe(definedDelta("lo", outcomes));
    expect(run.estimates.get("u")?.reliability).toBe(estimates.get("u")?.reliability);
  });

  test("src/judges/scout.ts does not import inference or read conviction / x_uv", () => {
    const source = readFileSync(join(import.meta.dir, "../src/judges/scout.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(/from\s+["'][^"']*\/inference\//.test(code)).toBe(false);
    expect(/\breferralStrength\b/.test(code)).toBe(false);
    expect(/\bconviction\b/.test(code)).toBe(false);
    expect(/\bx_uv\b/.test(code)).toBe(false);
  });
});
