/**
 * `claim_value` for a career_evidence@1.1.0 claim.
 *
 * The claims are synthetic. No sentence here is resume text.
 */

import { describe, expect, test } from "bun:test";
import type { Outcome } from "../src/domain/types.ts";
import {
  CLAIM_VALUE_V1_1_0,
  type ClaimValueConfig,
  careerEventsToLongitudinalRecords,
  claimValueConfigHash,
  claimValueConfigId,
  claimValueSlope,
  claimValuesToLongitudinalRecords,
  type EvidenceTier,
  residualSlope,
  scoreClaimValue,
  type ValuedClaim,
} from "../src/index.ts";
import type {
  LevelDistribution,
  OwnershipDistribution,
} from "../src/longitudinal/claimRubricV11.ts";
import { JUDGE_RELIABILITY_V2_0_0 } from "../src/models/registry.ts";
import { day, event } from "./helpers/longitudinal.ts";

const PINNED_CONFIG_HASH = "8f66391ae3488a303bc8135936840cd739d0b808642b27293a1a906e1ae76adf";

function mass(level: 0 | 1 | 2 | 3 | 4): LevelDistribution {
  const probabilities = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  probabilities[level] = 1;
  return { score: 0, confidence: 1, probabilities };
}

function tier(choice: "led" | "core_contributor" | "supporting"): OwnershipDistribution {
  return {
    choice,
    confidence: 1,
    probabilities: {
      led: choice === "led" ? 1 : 0,
      core_contributor: choice === "core_contributor" ? 1 : 0,
      supporting: choice === "supporting" ? 1 : 0,
    },
  };
}

/** P(level 4) = 0.5 and P(level 2) = 0.5. `score` is 0 on purpose. */
function halfHalf(): LevelDistribution {
  return { score: 0, confidence: 1, probabilities: [0, 0, 0.5, 0, 0.5] };
}

function selection(
  distribution: LevelDistribution,
  evidenceTier: EvidenceTier = "externally_verified",
  ownership: OwnershipDistribution | null = tier("led"),
  config: ClaimValueConfig = CLAIM_VALUE_V1_1_0,
) {
  return scoreClaimValue(
    { claimClass: "selection", selectivity: distribution, ownership },
    evidenceTier,
    config,
  );
}

function output(
  difficulty: LevelDistribution,
  impact: LevelDistribution,
  evidenceTier: EvidenceTier = "externally_verified",
  ownership: OwnershipDistribution | null = tier("led"),
  config: ClaimValueConfig = CLAIM_VALUE_V1_1_0,
) {
  return scoreClaimValue(
    {
      claimClass: "output",
      difficulty,
      generalized_impact: impact,
      ownership,
    },
    evidenceTier,
    config,
  );
}

describe("square-law curve", () => {
  test("point masses are monotonic and convex at p=2", () => {
    const values = [0, 1, 2, 3, 4].map(
      (level) => selection(mass(level as 0 | 1 | 2 | 3 | 4)).classValue,
    );
    expect(values).toEqual([0, 0.0625, 0.25, 0.5625, 1]);
    const slopes = values.slice(1).map((value, index) => value - values[index]!);
    expect(slopes).toEqual([0.0625, 0.1875, 0.3125, 0.4375]);
    const bends = slopes.slice(1).map((slope, index) => slope - slopes[index]!);
    expect(bends.every((bend) => bend > 0)).toBe(true);
  });

  test("point masses stay convex at p=3", () => {
    const config = { ...CLAIM_VALUE_V1_1_0, curvePower: 3 };
    const values = [0, 1, 2, 3, 4].map(
      (level) =>
        selection(mass(level as 0 | 1 | 2 | 3 | 4), "externally_verified", tier("led"), config)
          .classValue,
    );
    expect(values).toEqual([0, 0.015625, 0.125, 0.421875, 1]);
    const slopes = values.slice(1).map((value, index) => value - values[index]!);
    const bends = slopes.slice(1).map((slope, index) => slope - slopes[index]!);
    expect(bends.every((bend) => bend > 0)).toBe(true);
  });

  test("p=1 reproduces the linear expectation over 4", () => {
    const config = { ...CLAIM_VALUE_V1_1_0, curvePower: 1 };
    const values = [0, 1, 2, 3, 4].map(
      (level) =>
        selection(mass(level as 0 | 1 | 2 | 3 | 4), "externally_verified", tier("led"), config)
          .classValue,
    );
    expect(values).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(selection(halfHalf(), "externally_verified", tier("led"), config).classValue).toBe(0.75);
  });

  test("P(level 4)=0.5 and P(level 2)=0.5 curves to 0.625 at p=2", () => {
    const scored = selection(halfHalf());
    expect(scored.curved.selectivity).toBe(0.625);
    expect(scored.classValue).toBe(0.625);
    expect(scored.claimValue).toBe(0.625);
  });
});

describe("class value", () => {
  test("the geometric mean is 0 when either curved input is 0", () => {
    const difficultyZero = output(mass(0), mass(4));
    expect(difficultyZero.curved.difficulty).toBe(0);
    expect(difficultyZero.curved.generalizedImpact).toBe(1);
    expect(difficultyZero.classValue).toBe(0);
    expect(difficultyZero.claimValue).toBe(0);

    const impactZero = output(mass(4), mass(0));
    expect(impactZero.curved.difficulty).toBe(1);
    expect(impactZero.curved.generalizedImpact).toBe(0);
    expect(impactZero.classValue).toBe(0);
  });

  test("the geometric mean of curved difficulty and curved impact", () => {
    const scored = output(mass(2), mass(4));
    expect(scored.curved.difficulty).toBe(0.25);
    expect(scored.curved.generalizedImpact).toBe(1);
    expect(scored.classValue).toBe(0.5);
    expect(scored.curved.selectivity).toBeNull();
  });
});

describe("ownership and backing", () => {
  test("multipliers apply to the class value, which stays the curved number", () => {
    const reported = selection(mass(2), "self_reported", tier("core_contributor"));
    const verified = selection(mass(2), "externally_verified", tier("led"));
    expect(reported.classValue).toBe(0.25);
    expect(verified.classValue).toBe(0.25);
    expect(reported.ownershipMultiplier).toBe(0.8);
    expect(reported.backingMultiplier).toBe(0.6);
    expect(reported.claimValue).toBe(0.12);
    expect(verified.ownershipMultiplier).toBe(1);
    expect(verified.backingMultiplier).toBe(1);
    expect(verified.claimValue).toBe(0.25);
    expect(selection(mass(4), "corroborated", tier("led")).claimValue).toBe(0.85);
    expect(selection(mass(4), "externally_verified", tier("supporting")).claimValue).toBe(0.5);
  });

  test("null ownership uses the configured core_contributor weight", () => {
    const scored = selection(mass(4), "externally_verified", null);
    expect(scored.ownershipMultiplier).toBe(0.8);
    expect(scored.claimValue).toBe(0.8);

    const lowered: ClaimValueConfig = {
      ...CLAIM_VALUE_V1_1_0,
      ownership: { ...CLAIM_VALUE_V1_1_0.ownership, core_contributor: 0.7 },
    };
    const moved = selection(mass(4), "externally_verified", null, lowered);
    expect(moved.ownershipMultiplier).toBe(0.7);
    expect(moved.claimValue).toBe(0.7);
  });

  test("a changed curve power and backing weight change the claim value", () => {
    const linear: ClaimValueConfig = { ...CLAIM_VALUE_V1_1_0, curvePower: 1 };
    const scored = selection(halfHalf(), "self_reported", tier("led"), linear);
    expect(scored.classValue).toBe(0.75);
    expect(scored.backingMultiplier).toBe(0.6);
    expect(scored.claimValue).toBeCloseTo(0.45, 10);
    expect(scored.configHash).not.toBe(PINNED_CONFIG_HASH);
  });

  test("the product is clamped to [0, 1] and the factors are left as computed", () => {
    const heavy: ClaimValueConfig = {
      ...CLAIM_VALUE_V1_1_0,
      backing: { ...CLAIM_VALUE_V1_1_0.backing, externally_verified: 2 },
    };
    const high = selection(mass(4), "externally_verified", tier("led"), heavy);
    expect(high.backingMultiplier).toBe(2);
    expect(high.classValue).toBe(1);
    expect(high.claimValue).toBe(1);

    const negative: ClaimValueConfig = {
      ...CLAIM_VALUE_V1_1_0,
      backing: { ...CLAIM_VALUE_V1_1_0.backing, externally_verified: -1 },
    };
    const low = selection(mass(4), "externally_verified", tier("led"), negative);
    expect(low.backingMultiplier).toBe(-1);
    expect(low.claimValue).toBe(0);
  });
});

describe("config stamp", () => {
  test("the default config id, version, and hash are stamped on the score", () => {
    const scored = selection(halfHalf());
    expect(claimValueConfigHash(CLAIM_VALUE_V1_1_0)).toBe(PINNED_CONFIG_HASH);
    expect(claimValueConfigId(CLAIM_VALUE_V1_1_0)).toBe("claim_value@1.1.0:8f66391a");
    expect(scored.configHash).toBe(PINNED_CONFIG_HASH);
    expect(scored.configId).toBe("claim_value@1.1.0:8f66391a");
    expect(scored.configVersion).toBe("1.1.0");
    expect(Object.isFrozen(CLAIM_VALUE_V1_1_0)).toBe(true);
    expect(Object.isFrozen(CLAIM_VALUE_V1_1_0.ownership)).toBe(true);
    expect(Object.isFrozen(CLAIM_VALUE_V1_1_0.backing)).toBe(true);
  });
});

describe("1.1.0 slope", () => {
  test("a selection's curved claim value enters the slope, and rank-normalization does not", () => {
    const early = output(mass(2), mass(2));
    const late = selection(halfHalf());
    expect(early.claimValue).toBe(0.25);
    expect(late.claimValue).toBe(0.625);

    const claims: ValuedClaim[] = [
      {
        id: "northwind-output",
        personId: "p",
        claimClass: "output",
        claimValue: early.claimValue,
        status: "accepted",
        observedAt: day(20),
        createdAt: day(20),
      },
      {
        id: "northwind-fellowship",
        personId: "p",
        claimClass: "selection",
        claimValue: late.claimValue,
        status: "accepted",
        observedAt: day(150),
        createdAt: day(150),
      },
    ];
    const records = claimValuesToLongitudinalRecords(claims);
    expect(records.opportunities).toEqual([]);
    expect(records.outcomes.map((outcome) => [outcome.kind, outcome.value])).toEqual([
      ["career_claim:output", 0.25],
      ["career_claim:selection", 0.625],
    ]);

    const slope = claimValueSlope("p", day(90), day(180), records.outcomes, 90);
    expect(slope.state).toBe("defined");
    expect(slope.residualT0).toBe(0.25);
    expect(slope.residualT1).toBe(0.4375);
    expect(slope.delta).toBe(0.1875);

    const ranked = residualSlope(
      "p",
      day(90),
      day(180),
      records.outcomes,
      [],
      JUDGE_RELIABILITY_V2_0_0,
      90,
    );
    expect(ranked.state).toBe("insufficient_early");
  });

  test("1.0.0 still turns a selective role into an opportunity and drops it from outcomes", () => {
    const role = {
      ...event("role", "p-1", 70, 4),
      kind: "selective_role_transition" as const,
    };
    const records = careerEventsToLongitudinalRecords([role, event("shipped", "p-1", 50, 4)]);
    expect(records.outcomes).toHaveLength(1);
    expect(records.outcomes[0]?.kind).toBe("career_event:shipped_product");
    expect(records.outcomes[0]?.value).toBe(1);
    expect(records.opportunities).toHaveLength(1);
    expect(records.opportunities[0]?.kind).toBe("selective_role");
  });

  test("a review selection is not an outcome", () => {
    const records = claimValuesToLongitudinalRecords([
      {
        id: "held",
        personId: "p",
        claimClass: "selection",
        claimValue: 0.625,
        status: "review",
        observedAt: day(20),
        createdAt: day(20),
      },
    ]);
    expect(records.outcomes).toEqual([]);
  });

  test("1.2.0 job dates replace observedAt and a missing date is dropped", () => {
    const records = claimValuesToLongitudinalRecords([
      {
        id: "hire",
        personId: "p",
        claimClass: "selection",
        claimValue: 0.5,
        status: "accepted",
        observedAt: day(1),
        createdAt: day(1),
        jobDates: {
          startedAt: "2020-01-01",
          endedAt: "2021-03-01",
          publishedAt: "2024-05-31T00:00:00.000Z",
        },
      },
      {
        id: "work",
        personId: "p",
        claimClass: "output",
        claimValue: 0.25,
        status: "accepted",
        observedAt: day(1),
        createdAt: day(1),
        jobDates: { startedAt: "2020-01-01", endedAt: "2021-03-01", publishedAt: null },
      },
      {
        id: "open",
        personId: "p",
        claimClass: "output",
        claimValue: 0.25,
        status: "accepted",
        observedAt: day(1),
        createdAt: day(1),
        jobDates: {
          startedAt: "2020-01-01",
          endedAt: null,
          publishedAt: "2024-05-31T00:00:00.000Z",
        },
      },
      {
        id: "undated",
        personId: "p",
        claimClass: "selection",
        claimValue: 0.5,
        status: "accepted",
        observedAt: day(9),
        createdAt: day(9),
        jobDates: { startedAt: null, endedAt: null, publishedAt: "2024-05-31T00:00:00.000Z" },
      },
    ]);
    expect(
      records.outcomes.map((outcome) => [outcome.id, outcome.observedAt.toISOString()]),
    ).toEqual([
      ["outcome-hire", "2020-01-01T00:00:00.000Z"],
      ["outcome-work", "2021-03-01T00:00:00.000Z"],
      ["outcome-open", "2024-05-31T00:00:00.000Z"],
    ]);
  });

  test("a window shorter than the minimum gap has no slope", () => {
    const outcomes: Outcome[] = [
      {
        id: "outcome-early",
        personId: "p",
        opportunityId: null,
        kind: "career_claim:selection",
        value: 0.25,
        observedAt: day(1),
        createdAt: day(1),
      },
    ];
    const slope = claimValueSlope("p", day(0), day(10), outcomes, 90);
    expect(slope.state).toBe("undefined_window");
    expect(slope.delta).toBeNull();
  });
});
