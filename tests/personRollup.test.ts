import { describe, expect, test } from "bun:test";
import { rankPercentiles } from "../src/domain/rank.ts";
import type {
  LevelDistribution,
  RoleChoice,
  RoleDistribution,
} from "../src/longitudinal/claimRubricV12.ts";
import type { EvidenceTier } from "../src/longitudinal/claimValue.ts";
import { CLAIM_VALUE_V1_2_0, scoreClaimValueV12 } from "../src/longitudinal/claimValue.ts";
import {
  type AlphaSlope,
  alphaSlopes,
  PERSON_ROLLUP,
  type PersonRollup,
  PINNED_PERSON_ROLLUP_HASH,
  personRollupHash,
  personRollups,
  type RollupClaim,
} from "../src/longitudinal/personRollup.ts";
import type { LongitudinalResidualSlope, ResidualSlopeState } from "../src/longitudinal/types.ts";
import { JUDGE_RELIABILITY_V2_0_0 } from "../src/models/registry.ts";

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _SlopeStates = Assert<Same<AlphaSlope["state"], ResidualSlopeState>>;
type _NotResidualSlope = Assert<AlphaSlope extends LongitudinalResidualSlope ? false : true>;

function mass(level: 0 | 1 | 2 | 3 | 4): LevelDistribution {
  const probabilities = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  probabilities[level] = 1;
  return { score: 0, confidence: 1, probabilities };
}

function role(choice: RoleChoice): RoleDistribution {
  return {
    choice,
    confidence: 1,
    probabilities: {
      original_author: choice === "original_author" ? 1 : 0,
      major_contributor: choice === "major_contributor" ? 1 : 0,
      maintainer: choice === "maintainer" ? 1 : 0,
      minor_part: choice === "minor_part" ? 1 : 0,
    },
  };
}

function selection(
  selectivity: LevelDistribution,
  pool: LevelDistribution,
  tier: EvidenceTier = "externally_verified",
) {
  return scoreClaimValueV12(
    { claimClass: "selection", selectivity, pool_strength: pool, companyEvidence: null },
    tier,
  );
}

function output(
  difficulty: LevelDistribution,
  scale: LevelDistribution,
  roleDistribution: RoleDistribution | null = role("original_author"),
  tier: EvidenceTier = "externally_verified",
) {
  return scoreClaimValueV12(
    { claimClass: "output", difficulty, scale, role: roleDistribution },
    tier,
  );
}

function day(n: number): Date {
  return new Date(Date.UTC(2020, 0, 1 + n));
}

function row(
  personId: string,
  id: string,
  score: { claimClass: "selection" | "output"; claimValue: number },
  status: RollupClaim["status"] = "accepted",
  observedAt = day(0),
): RollupClaim {
  return {
    id,
    personId,
    claimClass: score.claimClass,
    claimValue: score.claimValue,
    status,
    observedAt,
  };
}

function defined(person: PersonRollup | undefined) {
  if (!person || person.substance === null) {
    throw new Error(`expected a defined alpha for ${person?.personId ?? "missing"}`);
  }
  const alpha = person.alpha;
  if (alpha.state !== "defined") {
    throw new Error(`expected a defined alpha for ${person.personId}`);
  }
  return { ...person, alpha };
}

const HIRE = selection(mass(4), mass(3));
const OPEN_POOL = selection(mass(4), mass(2));
const MID_HIRE = selection(mass(2), mass(1));
const BIG_OUTPUT = output(mass(3), mass(3));
const INTERN_OUTPUT = output(mass(4), mass(3));
const THIN_OUTPUT = output(mass(1), mass(1));
const LEVEL_OUTPUT = output(mass(2), mass(2));
const SMALL_OUTPUT = output(mass(2), mass(1));
const EMPTY_OUTPUT = output(mass(1), mass(0));
const LIBRARY = output(mass(4), mass(3), role("maintainer"));
const STRONG_SMALL_POOL = output(mass(4), mass(2));

function background(): RollupClaim[] {
  const claims: RollupClaim[] = [];
  for (let i = 0; i < 8; i++) {
    claims.push(row(`b0-${i}`, `b0-${i}-out`, THIN_OUTPUT));
    claims.push(row(`b1-${i}`, `b1-${i}-sel`, MID_HIRE));
    claims.push(row(`b1-${i}`, `b1-${i}-out`, SMALL_OUTPUT));
    claims.push(row(`b2-${i}`, `b2-${i}-sel`, OPEN_POOL));
    claims.push(row(`b2-${i}`, `b2-${i}-out`, LEVEL_OUTPUT));
    claims.push(row(`b3-${i}`, `b3-${i}-sel`, HIRE));
    claims.push(row(`b3-${i}`, `b3-${i}-out`, BIG_OUTPUT));
  }
  for (let i = 0; i < 24; i++) {
    claims.push(row(`lift-${i}`, `lift-${i}-sel`, MID_HIRE));
    claims.push(row(`lift-${i}`, `lift-${i}-out`, STRONG_SMALL_POOL));
  }
  return claims;
}

function profiles(maintainerAt = day(0)): RollupClaim[] {
  return [
    row("matched", "matched-sel", HIRE),
    row("matched", "matched-out", BIG_OUTPUT),
    row("thin", "thin-sel", HIRE),
    row("thin", "thin-out", THIN_OUTPUT),
    row("intern", "intern-sel", HIRE),
    row("intern", "intern-out", INTERN_OUTPUT),
    row("maintainer", "maintainer-out", LIBRARY, "accepted", maintainerAt),
    row("hackathon", "hackathon-sel", OPEN_POOL),
    row("hackathon", "hackathon-out", EMPTY_OUTPUT),
  ];
}

function cohort(maintainerAt = day(0)): RollupClaim[] {
  return [...background(), ...profiles(maintainerAt)];
}

describe("person roll-up", () => {
  test("worked examples: value, fitted alpha, and plain subtraction", () => {
    const rows = personRollups({ claims: cohort() });
    expect(rows.size).toBe(61);

    const matched = defined(rows.get("matched"));
    const thin = defined(rows.get("thin"));
    const intern = defined(rows.get("intern"));
    const maintainer = defined(rows.get("maintainer"));
    const hackathon = defined(rows.get("hackathon"));
    const obscure = defined(rows.get("b0-0"));

    expect(matched.consensus).toBeCloseTo(0.75, 12);
    expect(matched.substance).toBeCloseTo(0.5625, 12);
    expect(matched.value).toBeCloseTo(0.6 * 0.5625 + 0.4 * 0.75, 12);
    expect(matched.alpha.bucket).toBe(3);
    expect(matched.alpha.residual).toBeGreaterThan(0);
    expect(matched.alpha.residual).toBeLessThan(0.05);
    expect(matched.alpha.percentile).toBeGreaterThan(0.4);
    expect(matched.alpha.percentile).toBeLessThan(0.6);
    expect(matched.substance - matched.consensus).toBeLessThan(0);

    expect(intern.substance).toBeCloseTo(0.75, 12);
    expect(intern.alpha.residual).toBeGreaterThan(matched.alpha.residual);
    expect(intern.alpha.percentile).toBeGreaterThan(0.5);

    expect(thin.consensus).toBeCloseTo(0.75, 12);
    expect(thin.substance).toBeCloseTo(0.0625, 12);
    expect(thin.value).toBeGreaterThan(thin.substance);
    expect(thin.value).toBeLessThan(matched.value);
    expect(thin.alpha.residual).toBeLessThan(0);
    expect(thin.alpha.percentile).toBe(0);

    expect(maintainer.consensus).toBe(0);
    expect(maintainer.selectionAggregate).toBe(0);
    expect(maintainer.substance).toBeCloseTo(0.75 * 0.65, 12);
    expect(maintainer.alpha.bucket).toBe(0);
    expect(maintainer.alpha.percentile).toBe(1);
    expect(maintainer.alpha.residual).toBeGreaterThan(intern.alpha.residual);

    expect(hackathon.consensus).toBeCloseTo(0.5, 12);
    expect(hackathon.substance).toBe(0);
    expect(hackathon.alpha.bucket).toBe(2);
    expect(hackathon.alpha.residual).toBeLessThan(0);
    expect(hackathon.value).toBeLessThan(matched.value);
    expect(hackathon.value).toBeGreaterThan(0);

    const withSubstance = [...rows.values()].filter(
      (person): person is Extract<PersonRollup, { substance: number }> => person.substance !== null,
    );
    const plain = rankPercentiles(
      withSubstance.map((person) => ({
        id: person.personId,
        value: person.substance - person.consensus,
      })),
    );
    const fitted = rankPercentiles(
      withSubstance.map((person) => {
        const alpha = person.alpha;
        return {
          id: person.personId,
          value: alpha.state === "defined" ? alpha.residual : 0,
        };
      }),
    );
    expect((plain.get("matched") as number) / 100).toBeLessThan(0.5);
    expect((fitted.get("matched") as number) / 100).toBeGreaterThan(
      (plain.get("matched") as number) / 100,
    );
    expect(obscure.substance - obscure.consensus).toBeGreaterThan(
      matched.substance - matched.consensus,
    );
    expect(obscure.alpha.residual).toBeLessThan(matched.alpha.residual);

    for (const person of rows.values()) {
      expect(person.personRollupHash).toBe(PINNED_PERSON_ROLLUP_HASH);
    }
  });

  test("trend moves consensus by wTrend and leaves substance fixed", () => {
    const neutral = defined(personRollups({ claims: cohort() }).get("hackathon"));
    const nudged = defined(
      personRollups({ claims: cohort(), trend: new Map([["hackathon", 0.1]]) }).get("hackathon"),
    );
    const shifted = defined(
      personRollups({ claims: cohort(), trend: new Map([["hackathon", 1]]) }).get("hackathon"),
    );

    expect(nudged.consensus - neutral.consensus).toBeCloseTo(PERSON_ROLLUP.wTrend * 0.1, 12);
    expect(shifted.consensus - neutral.consensus).toBeCloseTo(PERSON_ROLLUP.wTrend, 12);
    expect(nudged.substance).toBe(neutral.substance);
    expect(shifted.substance).toBe(neutral.substance);
    expect(nudged.selectionAggregate).toBe(neutral.selectionAggregate);
    expect(nudged.value - neutral.value).toBeCloseTo(
      PERSON_ROLLUP.wConsensus * (nudged.consensus - neutral.consensus),
      12,
    );
    expect(nudged.alpha.bucket).toBe(neutral.alpha.bucket);
    expect(nudged.alpha.percentile).toBe(neutral.alpha.percentile);
    expect(shifted.alpha.bucket).toBeGreaterThan(neutral.alpha.bucket);
  });

  test("a cohort under minCohortSize reports not enough cohort, never 0", () => {
    const claims = cohort().filter(
      (claim) => claim.personId === "matched" || claim.personId === "thin",
    );
    claims.push(row("empty", "empty-review", BIG_OUTPUT, "review"));
    const rows = personRollups({ claims });
    const matched = rows.get("matched");
    const empty = rows.get("empty");
    if (matched?.alpha.state !== "not_enough_cohort") throw new Error("matched should be withheld");
    expect(matched.alpha.cohortSize).toBe(2);
    expect(matched.alpha.minCohortSize).toBe(30);
    expect(matched.substance).not.toBeNull();
    expect(empty?.substance).toBeNull();
    expect(empty?.value).toBeNull();
    expect(empty?.alpha).toEqual({ state: "no_output_evidence" });
  });

  test("top-N ignores review, no_work_described, and claims past the strongest N", () => {
    const strong = output(mass(4), mass(4));
    const weak = output(mass(1), mass(1));
    const claims: RollupClaim[] = [
      row("ada", "a1", strong),
      row("ada", "a2", strong),
      row("ada", "a3", strong),
      row("ada", "a4", weak),
      row("ada", "a5", weak),
      row("ada", "a6", weak),
      row("ada", "a7", weak),
      row("ada", "a8", weak),
      row("ada", "review", strong, "review"),
      row("ada", "nowork", strong, "no_work_described"),
      row("bea", "b1", LEVEL_OUTPUT),
      row("bea", "b2", THIN_OUTPUT),
      row("bea", "b-review", strong, "review"),
      row("bea", "b-nowork", strong, "no_work_described"),
      row("cy", "c-sel", HIRE),
    ];
    const rows = personRollups({ claims });
    expect(rows.get("ada")?.substance).toBe(1);
    expect(rows.get("ada")?.outputClaimIds).toEqual(["a1", "a2", "a3"]);
    expect(rows.get("bea")?.substance).toBe(0.15625);
    expect(rows.get("cy")?.selectionAggregate).toBeCloseTo(0.75, 12);
    expect(rows.get("cy")?.substance).toBeNull();
    expect(rows.get("cy")?.consensus).toBeCloseTo(0.75, 12);
    expect(rows.get("cy")?.alpha).toEqual({ state: "no_output_evidence" });
  });

  test("a thin consensus bucket falls back to the global mean", () => {
    const config = { ...PERSON_ROLLUP, minCohortSize: 4, minBucketSize: 2, topN: 1 };
    const claims = [
      row("p0", "p0", { claimClass: "output", claimValue: 0.5 }),
      row("p0", "p0s", HIRE),
      row("p1", "p1", { claimClass: "output", claimValue: 0.5 }),
      row("p1", "p1s", HIRE),
      row("p2", "p2", { claimClass: "output", claimValue: 0.5 }),
      row("p2", "p2s", HIRE),
      row("solo", "solo", { claimClass: "output", claimValue: 0.1 }),
    ];
    const rows = personRollups({ claims, config });
    const group = defined(rows.get("p0"));
    const solo = defined(rows.get("solo"));
    expect(group.alpha.expectedFrom).toBe("bucket");
    expect(group.alpha.expectedSubstance).toBeCloseTo(0.5, 12);
    expect(group.alpha.residual).toBeCloseTo(0, 12);
    expect(solo.alpha.expectedFrom).toBe("global");
    expect(solo.alpha.expectedSubstance).toBeCloseTo(0.4, 12);
    expect(solo.alpha.residual).toBeCloseTo(-0.3, 12);
    expect(solo.alpha.bucket).toBe(0);
  });

  test("alpha slope differences the reported percentile and keeps the slope states", () => {
    const claims = cohort(day(120));
    const slopes = alphaSlopes({
      claims,
      t0: day(0),
      t1: day(180),
      minGapDays: 90,
    });
    const early = slopes.get("maintainer");
    if (early?.state !== "insufficient_early")
      throw new Error("maintainer should be early-missing");
    expect(early.alphaT0).toBeNull();
    expect(early.alphaT1).not.toBeNull();
    expect(early.delta).toBeNull();

    const held = slopes.get("matched");
    if (held?.state !== "defined") throw new Error("matched should have both cutoffs");
    expect(held.delta).toBeCloseTo(held.alphaT1 - held.alphaT0, 12);
    const lateOnly = personRollups({ claims, asOf: day(180) });
    expect(held.alphaT1).toBe(defined(lateOnly.get("matched")).alpha.percentile);

    const closed = alphaSlopes({ claims, t0: day(0), t1: day(10), minGapDays: 90 });
    expect(closed.get("matched")?.state).toBe("undefined_window");
    expect(closed.get("matched")?.delta).toBeNull();
  });

  test("a changed weight stamps a different hash", () => {
    const claims = [row("ada", "ada-out", THIN_OUTPUT)];
    const pinned = personRollups({ claims });
    const shifted = personRollups({
      claims,
      config: { ...PERSON_ROLLUP, wTrend: 0.3, wSubstance: 0.7, wConsensus: 0.3 },
    });
    expect(personRollupHash()).toBe(PINNED_PERSON_ROLLUP_HASH);
    expect(pinned.get("ada")?.personRollupHash).toBe(PINNED_PERSON_ROLLUP_HASH);
    expect(shifted.get("ada")?.personRollupHash).not.toBe(PINNED_PERSON_ROLLUP_HASH);
  });

  test("consensus cuts follow the claim-value curve", () => {
    const { curvePower, maxLevel } = CLAIM_VALUE_V1_2_0;
    const curve: number[] = [];
    for (let level = 1; level < maxLevel; level++) curve.push((level / maxLevel) ** curvePower);
    expect(PERSON_ROLLUP.consensusCuts).toEqual(curve);
    expect(PERSON_ROLLUP.consensusCuts).toEqual([0.0625, 0.25, 0.5625]);
  });

  test("consensus cuts from config change the bucket and the stamp", () => {
    const claims = [
      row("hi", "hi-o", { claimClass: "output", claimValue: 0.5 }),
      row("hi", "hi-s", HIRE),
      row("lo", "lo-o", { claimClass: "output", claimValue: 0.5 }),
    ];
    const wide = personRollups({
      claims,
      config: { ...PERSON_ROLLUP, minCohortSize: 2, consensusCuts: [0.9] },
    });
    const split = personRollups({
      claims,
      config: { ...PERSON_ROLLUP, minCohortSize: 2 },
    });
    expect(defined(wide.get("hi")).alpha.bucket).toBe(0);
    expect(defined(split.get("hi")).alpha.bucket).toBe(3);
    expect(wide.get("hi")?.personRollupHash).not.toBe(split.get("hi")?.personRollupHash);
  });

  test("minBucketSize matches the V2 judge residual", () => {
    expect(PERSON_ROLLUP.minBucketSize).toBe(JUDGE_RELIABILITY_V2_0_0.minBucketSize);
  });
});
