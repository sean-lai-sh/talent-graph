import { describe, expect, test } from "bun:test";
import {
  CLAIM_VALUE_V1_1_0,
  CLAIM_VALUE_V1_2_0,
  type ClaimValueV12Config,
  type ClaimValueV12Input,
  claimValueConfigHash,
  claimValueV12ConfigHash,
  claimValueV12ConfigId,
  displayClaimValue,
  displayLevel,
  type EvidenceTier,
  type ReferrerNote,
  scoreClaimValue,
  scoreClaimValueV12,
} from "../src/index.ts";
import type {
  LevelDistribution,
  RoleChoice,
  RoleDistribution,
} from "../src/longitudinal/claimRubricV12.ts";
import {
  COMPANY_EVIDENCE_CONFIG,
  type CompanySelectionEvidence,
  companyEvidenceConfigHash,
} from "../src/longitudinal/companyEvidence.ts";
import { companySeedHash } from "../src/longitudinal/companySeed.ts";
import { SYNTHETIC_COMPANY_SEED } from "./fixtures/companySeed.synthetic.ts";

// The pin changes when the company_seed section of config.yml changes.
// companySeedHash() fingerprints that section, so a fund-tier edit moves this
// stamp and scores from two lists are not compared.
const PINNED_V12_CONFIG_HASH = "6aaa508fff88d6f3dedabf803f3b21ea9b20b6a1dec25911fff495ffe6e697f8";
const PINNED_V11_CONFIG_HASH = "8f66391ae3488a303bc8135936840cd739d0b808642b27293a1a906e1ae76adf";

type SignalKey = "referralSignal" | "signal" | "score";
type NoteHasNoSignal = Extract<keyof ReferrerNote, SignalKey> extends never ? true : never;

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

function company(partial: Partial<CompanySelectionEvidence> = {}): CompanySelectionEvidence {
  return {
    knownRate: null,
    investorTier: null,
    stageAtHire: null,
    proxyLift: 0,
    joinedEarly: false,
    earlyJoinerBonus: 0,
    ...partial,
  };
}

function selection(
  selectivity: LevelDistribution,
  pool: LevelDistribution,
  evidenceTier: EvidenceTier = "externally_verified",
  companyEvidence: CompanySelectionEvidence | null = null,
  input: ClaimValueV12Input = {},
) {
  return scoreClaimValueV12(
    { claimClass: "selection", selectivity, pool_strength: pool, companyEvidence },
    evidenceTier,
    input,
  );
}

function output(
  difficulty: LevelDistribution,
  scale: LevelDistribution,
  evidenceTier: EvidenceTier = "externally_verified",
  roleDistribution: RoleDistribution | null = role("original_author"),
  input: ClaimValueV12Input = {},
) {
  return scoreClaimValueV12(
    { claimClass: "output", difficulty, scale, role: roleDistribution },
    evidenceTier,
    input,
  );
}

describe("pool strength table", () => {
  test("1 in 400 at three pools, self-reported, on the 0–10 display", () => {
    const school = selection(mass(4), mass(1), "self_reported");
    const national = selection(mass(4), mass(3), "self_reported");
    const international = selection(mass(4), mass(4), "self_reported");

    expect(school.curved.selectivity).toBe(1);
    expect(school.curved.poolStrength).toBe(0.0625);
    expect(school.classValue).toBe(0.25);
    expect(school.backingMultiplier).toBe(0.6);
    expect(school.roleMultiplier).toBe(1);
    expect(school.claimValue).toBe(0.15);
    expect(displayClaimValue(school.claimValue)).toBe(1.5);

    expect(national.classValue).toBe(0.75);
    expect(national.claimValue).toBeCloseTo(0.45, 10);
    expect(displayClaimValue(national.claimValue)).toBeCloseTo(4.5, 10);

    expect(international.classValue).toBe(1);
    expect(international.claimValue).toBeCloseTo(0.6, 10);
    expect(displayClaimValue(international.claimValue)).toBeCloseTo(6, 10);

    expect(displayLevel(4)).toBe(10);
    expect(displayLevel(3)).toBe(7.5);
    expect(displayLevel(1)).toBe(2.5);
  });
});

describe("geometric mean", () => {
  test("the class value is 0 when either curved input is 0", () => {
    const selectivityZero = selection(mass(0), mass(4));
    expect(selectivityZero.curved.selectivity).toBe(0);
    expect(selectivityZero.curved.poolStrength).toBe(1);
    expect(selectivityZero.classValue).toBe(0);
    expect(selectivityZero.claimValue).toBe(0);

    const poolZero = selection(mass(4), mass(0), "externally_verified", company({ proxyLift: 1 }));
    expect(poolZero.curved.selectivity).toBe(1);
    expect(poolZero.curved.poolStrength).toBe(0);
    expect(poolZero.classValue).toBe(0);

    const difficultyZero = output(mass(0), mass(4));
    expect(difficultyZero.curved.difficulty).toBe(0);
    expect(difficultyZero.curved.scale).toBe(1);
    expect(difficultyZero.classValue).toBe(0);
    expect(difficultyZero.claimValue).toBe(0);

    const scaleZero = output(mass(4), mass(0));
    expect(scaleZero.curved.difficulty).toBe(1);
    expect(scaleZero.curved.scale).toBe(0);
    expect(scaleZero.classValue).toBe(0);
  });
});

describe("role", () => {
  test("the four role weights apply, null is 0.8, and selection has no role multiplier", () => {
    expect(
      output(mass(4), mass(4), "externally_verified", role("original_author")).claimValue,
    ).toBe(1);
    expect(
      output(mass(4), mass(4), "externally_verified", role("major_contributor")).claimValue,
    ).toBe(0.8);
    expect(
      output(mass(4), mass(4), "externally_verified", role("maintainer")).claimValue,
    ).toBeCloseTo(0.65, 10);
    expect(output(mass(4), mass(4), "externally_verified", role("minor_part")).claimValue).toBe(
      0.5,
    );

    const missing = output(mass(4), mass(4), "externally_verified", null);
    expect(missing.roleMultiplier).toBe(0.8);
    expect(missing.claimValue).toBe(0.8);

    const lowered: ClaimValueV12Config = {
      ...CLAIM_VALUE_V1_2_0,
      role: { ...CLAIM_VALUE_V1_2_0.role, major_contributor: 0.7 },
    };
    const moved = output(mass(4), mass(4), "externally_verified", null, { config: lowered });
    expect(moved.roleMultiplier).toBe(0.7);
    expect(moved.claimValue).toBe(0.7);

    const mixed: RoleDistribution = {
      choice: "original_author",
      confidence: 0.5,
      probabilities: {
        original_author: 0.5,
        major_contributor: 0,
        maintainer: 0,
        minor_part: 0.5,
      },
    };
    const blended = output(mass(4), mass(4), "externally_verified", mixed);
    expect(blended.roleMultiplier).toBe(0.75);
    expect(blended.claimValue).toBe(0.75);

    const chosen = selection(mass(4), mass(4));
    expect(chosen.roleMultiplier).toBe(1);
    expect(chosen.classValue).toBe(1);
    expect(chosen.claimValue).toBe(1);
    const reported = selection(mass(4), mass(4), "self_reported");
    expect(reported.roleMultiplier).toBe(1);
    expect(reported.claimValue).toBeCloseTo(0.6, 10);
  });
});

describe("referrer notes", () => {
  test("a named note lifts self_reported to 0.85 and leaves externally_verified at 1", () => {
    const guard: NoteHasNoSignal = true;
    expect(guard).toBe(true);

    const note: ReferrerNote = { claimId: "claim-1", referrerName: "Ada North" };
    const withSignal: ReferrerNote = { claimId: "claim-1", referrerName: "Ada North" };
    Object.assign(withSignal, { referralSignal: 99 });
    const blank: ReferrerNote = { claimId: "claim-1", referrerName: " " };
    Object.assign(blank, { referralSignal: 99 });

    const reported = selection(mass(4), mass(4), "self_reported", null, { claimId: "claim-1" });
    const lifted = selection(mass(4), mass(4), "self_reported", null, {
      claimId: "claim-1",
      notes: [note],
    });
    const smuggled = selection(mass(4), mass(4), "self_reported", null, {
      claimId: "claim-1",
      notes: [withSignal],
    });
    const unnamed = selection(mass(4), mass(4), "self_reported", null, {
      claimId: "claim-1",
      notes: [blank],
    });
    const otherClaim = selection(mass(4), mass(4), "self_reported", null, {
      claimId: "claim-1",
      notes: [{ claimId: "claim-2", referrerName: "Ada North" }],
    });
    const verified = selection(mass(4), mass(4), "externally_verified", null, {
      claimId: "claim-1",
      notes: [withSignal],
    });

    expect(reported.backingMultiplier).toBe(0.6);
    expect(reported.claimValue).toBeCloseTo(0.6, 10);
    expect(lifted.backingMultiplier).toBe(0.85);
    expect(lifted.claimValue).toBe(0.85);
    expect(lifted.classValue).toBe(reported.classValue);
    expect(smuggled.backingMultiplier).toBe(0.85);
    expect(smuggled.claimValue).toBe(lifted.claimValue);
    expect(unnamed.backingMultiplier).toBe(0.6);
    expect(otherClaim.backingMultiplier).toBe(0.6);
    expect(verified.backingMultiplier).toBe(1);
    expect(verified.claimValue).toBe(1);

    const authored = output(mass(4), mass(4), "self_reported", role("major_contributor"), {
      claimId: "claim-1",
      notes: [note],
    });
    expect(authored.roleMultiplier).toBe(0.8);
    expect(authored.backingMultiplier).toBe(0.85);
    expect(authored.claimValue).toBeCloseTo(0.68, 10);
  });
});

describe("company proxy lift", () => {
  test("a +1 lift moves a level-2 atom to level 3 and changes the selection value", () => {
    const plain = selection(mass(2), mass(4));
    const lifted = selection(mass(2), mass(4), "externally_verified", company({ proxyLift: 1 }));
    expect(plain.curved.selectivity).toBe(0.25);
    expect(plain.classValue).toBe(0.5);
    expect(plain.claimValue).toBe(0.5);
    expect(lifted.curved.selectivity).toBe(0.5625);
    expect(lifted.classValue).toBe(0.75);
    expect(lifted.claimValue).toBe(0.75);
  });

  test("a text-only level 4 is unchanged, and a proxy does not create level 4", () => {
    const top = selection(
      mass(4),
      mass(4),
      "externally_verified",
      company({ proxyLift: 1, earlyJoinerBonus: 0.25 }),
    );
    expect(top.curved.selectivity).toBe(1);
    expect(top.claimValue).toBe(1);

    const capped = selection(mass(3), mass(4), "externally_verified", company({ proxyLift: 1 }));
    const uncapped = selection(mass(3), mass(4));
    expect(capped.curved.selectivity).toBe(0.5625);
    expect(capped.curved.selectivity).toBe(uncapped.curved.selectivity);
    expect(capped.classValue).toBe(0.75);
  });

  test("a known rate ignores a proxy lift", () => {
    const known = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({
        proxyLift: 1,
        knownRate: { rate: 0.01, source: "https://example.invalid/rate", upperBound: false },
      }),
    );
    expect(known.curved.selectivity).toBe(0.25);
    expect(known.claimValue).toBe(0.5);
  });

  test("joined_early at bonus 0 leaves the value unchanged, and the bonus clamps at 0.25", () => {
    const plain = selection(mass(2), mass(4));
    const flagged = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({ joinedEarly: true, earlyJoinerBonus: 0, proxyLift: 1 }),
    );
    const idle = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({ joinedEarly: false, proxyLift: 1 }),
    );
    expect(flagged.claimValue).toBe(idle.claimValue);
    expect(flagged.curved.selectivity).toBe(0.5625);

    const untouched = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({ joinedEarly: true, earlyJoinerBonus: 0 }),
    );
    expect(untouched.claimValue).toBe(plain.claimValue);

    const quarter = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({ earlyJoinerBonus: 0.25 }),
    );
    const over = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({ earlyJoinerBonus: 0.5 }),
    );
    const tenth = selection(
      mass(2),
      mass(4),
      "externally_verified",
      company({ earlyJoinerBonus: 0.1 }),
    );
    expect(quarter.curved.selectivity).toBe(0.328125);
    expect(quarter.classValue).toBeCloseTo(0.57282196186948, 10);
    expect(over.curved.selectivity).toBe(quarter.curved.selectivity);
    expect(over.claimValue).toBe(quarter.claimValue);
    expect(tenth.curved.selectivity).toBe(0.28125);
    expect(tenth.claimValue).not.toBe(quarter.claimValue);
  });
});

describe("config stamp", () => {
  test("the 1.2.0 hash includes the imported seed and company-evidence hashes", () => {
    expect(CLAIM_VALUE_V1_2_0.companySeedHash).toBe(companySeedHash());
    expect(CLAIM_VALUE_V1_2_0.companyEvidenceConfigHash).toBe(companyEvidenceConfigHash());
    expect(claimValueV12ConfigHash(CLAIM_VALUE_V1_2_0)).toBe(PINNED_V12_CONFIG_HASH);
    expect(claimValueV12ConfigId(CLAIM_VALUE_V1_2_0)).toBe("claim_value@1.2.0:6aaa508f");
    expect(Object.isFrozen(CLAIM_VALUE_V1_2_0)).toBe(true);

    const scored = selection(mass(4), mass(1), "self_reported");
    expect(scored.configHash).toBe(PINNED_V12_CONFIG_HASH);
    expect(scored.configId).toBe("claim_value@1.2.0:6aaa508f");
    expect(scored.configVersion).toBe("1.2.0");

    const editedSeed: ClaimValueV12Config = {
      ...CLAIM_VALUE_V1_2_0,
      companySeedHash: companySeedHash(SYNTHETIC_COMPANY_SEED),
    };
    expect(editedSeed.companySeedHash).not.toBe(companySeedHash());
    expect(claimValueV12ConfigHash(editedSeed)).not.toBe(PINNED_V12_CONFIG_HASH);

    const editedCompany: ClaimValueV12Config = {
      ...CLAIM_VALUE_V1_2_0,
      companyEvidenceConfigHash: companyEvidenceConfigHash({
        ...COMPANY_EVIDENCE_CONFIG,
        earlyJoinerBonus: 0.1,
      }),
    };
    expect(claimValueV12ConfigHash(editedCompany)).not.toBe(PINNED_V12_CONFIG_HASH);
  });

  test("1.1.0 hash and a known output stay put", () => {
    expect(claimValueConfigHash(CLAIM_VALUE_V1_1_0)).toBe(PINNED_V11_CONFIG_HASH);
    const scored = scoreClaimValue(
      { claimClass: "selection", selectivity: mass(2), ownership: null },
      "self_reported",
    );
    expect(scored.ownershipMultiplier).toBe(0.8);
    expect(scored.classValue).toBe(0.25);
    expect(scored.claimValue).toBe(0.12);
    expect(scored.configHash).toBe(PINNED_V11_CONFIG_HASH);
  });
});
