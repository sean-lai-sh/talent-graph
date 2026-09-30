import { describe, expect, test } from "bun:test";
import { claimQuestionsV12 } from "../apps/club/lib/longitudinal/jevClient.ts";
import { extractFacts } from "../src/longitudinal/claimPreprocess.ts";
import {
  type ClaimRubricV12Request,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";
import type { CompanySeed } from "../src/longitudinal/companySeed.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import { CAREER_EVIDENCE_V1_1_0 } from "../src/models/careerEvidenceV11.ts";
import {
  CAREER_EVIDENCE_V1_2_0,
  careerEvidenceV12RubricHash,
  careerEvidenceV12SpecId,
  selectivityLevelForRate,
} from "../src/models/careerEvidenceV12.ts";
import { CURRENT_SPECS, getSpec, isRegisteredSpec, specVersions } from "../src/models/registry.ts";
import { type CareerEvidenceV12Spec, validateSpec } from "../src/models/spec.ts";
import { SYNTHETIC_COMPANY_SEED } from "./fixtures/companySeed.synthetic.ts";

const PINNED_RUBRIC_HASH = "bcf23650aa94d7db63cd254cd04d31cfbd77201af887c7b3b4645238f5d9e376";

const spec = CAREER_EVIDENCE_V1_2_0;

const TITLE_SENTENCE = "Titles are not scored. Verbs and scope count more.";
const REGION_BAN = "Never rate a country, city, or region as a stronger or weaker pool.";

function level(score: number, confidence = 0.9) {
  return {
    score,
    confidence,
    probabilities: {
      0: score === 0 ? 1 : 0,
      1: score === 1 ? 1 : 0,
      2: score === 2 ? 1 : 0,
      3: score === 3 ? 1 : 0,
      4: score === 4 ? 1 : 0,
    },
  };
}

function classBlock(choice: "selection" | "output" | "both", confidence = 0.92) {
  return {
    choice,
    confidence,
    probabilities: {
      selection: choice === "selection" ? 1 : 0,
      output: choice === "output" ? 1 : 0,
      both: choice === "both" ? 1 : 0,
    },
  };
}

function bothEverywhere() {
  return {
    claim_class: classBlock("both"),
    selectivity: level(4),
    pool_strength: level(3),
    difficulty: level(2),
    scale: level(1),
    role: {
      choice: "major_contributor" as const,
      confidence: 0.9,
      probabilities: {
        original_author: 0,
        major_contributor: 1,
        maintainer: 0,
        minor_part: 0,
      },
    },
  };
}

function answer(
  request: ClaimRubricV12Request,
  options: { poolScore?: number; poolConfidence?: number; scaleConfidence?: number } = {},
) {
  if (!("selectivity" in request.questions) && !("difficulty" in request.questions)) {
    return { claim_class: classBlock("selection") };
  }
  if ("selectivity" in request.questions) {
    return {
      claim_class: classBlock("selection"),
      selectivity: level(4),
      pool_strength: level(options.poolScore ?? 3, options.poolConfidence ?? 0.9),
    };
  }
  return {
    claim_class: classBlock("output"),
    difficulty: level(2),
    scale: level(1, options.scaleConfidence ?? 0.9),
    role: {
      choice: "major_contributor" as const,
      confidence: 0.1,
      probabilities: {
        original_author: 0,
        major_contributor: 1,
        maintainer: 0,
        minor_part: 0,
      },
    },
  };
}

function scoreLines(
  lines: { id: string; statement: string; publishedAt?: string | null }[],
  options: { poolScore?: number; poolConfidence?: number; scaleConfidence?: number } = {},
  seed?: CompanySeed,
) {
  const seen: ClaimRubricV12Request[] = [];
  const claims = scoreClaimRubricV12({
    lines,
    source: "resume",
    ...(seed ? { seed } : {}),
    respond: (request) => {
      seen.push(request);
      return answer(request, options);
    },
  });
  return { seen, claims };
}

describe("career_evidence@1.2.0 registration", () => {
  test("1.2.0 validates and 1.0.0 stays current", () => {
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(isRegisteredSpec(spec)).toBe(true);
    expect(specVersions("career_evidence")).toEqual([
      "1.0.0",
      "1.1.0",
      "1.2.0",
      "1.2.1",
      "1.2.2",
      "1.2.3",
    ]);
    expect(getSpec("career_evidence", "1.2.0").version).toBe("1.2.0");
    expect(CURRENT_SPECS.career_evidence.version).toBe("1.0.0");
    expect(careerEvidenceV12RubricHash(spec)).toBe(PINNED_RUBRIC_HASH);
    expect(careerEvidenceV12SpecId(spec)).toBe(
      `career_evidence@1.2.0:${PINNED_RUBRIC_HASH.slice(0, 8)}`,
    );
  });

  test("a level edit changes the rubric hash, and a thresholds edit does not", () => {
    const edited = structuredClone(spec) as CareerEvidenceV12Spec;
    const levels = edited.pool_strength.levels as unknown as string[];
    levels[0] = `${levels[0]} extra`;
    expect(careerEvidenceV12RubricHash(edited)).not.toBe(PINNED_RUBRIC_HASH);
    expect(edited.version).toBe("1.2.0");

    const thresholdsOnly = structuredClone(spec) as CareerEvidenceV12Spec;
    thresholdsOnly.thresholds = { classConfidence: 0.9, dimensionConfidence: 0.8 };
    expect(careerEvidenceV12RubricHash(thresholdsOnly)).toBe(PINNED_RUBRIC_HASH);
  });

  test("validateSpec rejects a missing ladder and the 1.1.0 keys this version replaced", () => {
    const missing = structuredClone(spec) as CareerEvidenceV12Spec;
    delete (missing as { pool_strength?: unknown }).pool_strength;
    const missingResult = validateSpec(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.errors.join("\n")).toContain("pool_strength");

    const owned = { ...spec, ownership: { question: "no" } };
    const ownedResult = validateSpec(owned);
    expect(ownedResult.ok).toBe(false);
    if (!ownedResult.ok) expect(ownedResult.errors.join("\n")).toContain("ownership");

    const impact = { ...spec, generalized_impact: { question: "no", levels: ["a"] } };
    const impactResult = validateSpec(impact);
    expect(impactResult.ok).toBe(false);
    if (!impactResult.ok) expect(impactResult.errors.join("\n")).toContain("generalized_impact");

    const role = structuredClone(spec) as CareerEvidenceV12Spec;
    delete (role.role as { maintainer?: string }).maintainer;
    const roleResult = validateSpec(role);
    expect(roleResult.ok).toBe(false);
    if (!roleResult.ok) expect(roleResult.errors.join("\n")).toContain("role.maintainer");
  });
});

describe("selectivity anchors stay the 1.1.0 cuts", () => {
  test("the same inclusive bounds map a rate to a level", () => {
    expect(spec.selectivity).toEqual(CAREER_EVIDENCE_V1_1_0.selectivity);
    expect(spec.selectivityCuts).toEqual(CAREER_EVIDENCE_V1_1_0.selectivityCuts);
    expect(selectivityLevelForRate(0.01)).toBe(4);
    expect(selectivityLevelForRate(0.05)).toBe(3);
    expect(selectivityLevelForRate(0.2)).toBe(2);
    expect(selectivityLevelForRate(0.5)).toBe(1);
    expect(selectivityLevelForRate(0.51)).toBe(0);
  });
});

describe("prompt anchors", () => {
  test("pool, difficulty, scale, and role use the checkable 1.2.0 anchors", () => {
    expect(spec.pool_strength.levels[0]).toContain("open-enrollment course certificate");
    expect(spec.pool_strength.levels[1]).toContain("1 in 400 from one school");
    expect(spec.pool_strength.levels[2]).toContain("at or below about 20%");
    expect(spec.pool_strength.levels[3]).toContain(
      "national fellowship with a published applicant count",
    );
    expect(spec.pool_strength.levels[4]).toContain("IMO team");
    expect(spec.pool_strength.question).toContain(REGION_BAN);
    expect(spec.pool_strength.question).toContain(
      "answer the most likely level with low confidence",
    );

    expect(spec.difficulty).not.toEqual(CAREER_EVIDENCE_V1_1_0.difficulty);
    expect(spec.difficulty.levels[0]).toContain("to-do app from a tutorial");
    expect(spec.difficulty.levels[1]).toContain("off-the-shelf components");
    expect(spec.difficulty.levels[2]).toContain("p95 latency from 800 ms to 120 ms");
    expect(spec.difficulty.levels[3]).toContain("GPU kernel");
    expect(spec.difficulty.levels[4]).toContain("known open problem");

    expect(spec.scale.levels[0]).toContain("personal demo");
    expect(spec.scale.levels[1]).toContain("40 members");
    expect(spec.scale.levels[2]).toContain("5k weekly downloads");
    expect(spec.scale.levels[3]).toContain("10k or more stars");
    expect(spec.scale.levels[4]).toContain("Linux kernel subsystem");
    expect(spec.scale.question).toContain("answer the most likely level with low confidence");

    expect(spec.role.original_author).toContain("created, founded, or wrote the core");
    expect(spec.role.major_contributor).toContain("substantial part");
    expect(spec.role.maintainer).toContain("without authoring the core");
    expect(spec.role.minor_part).toContain("under someone else's direction");
    expect("generalized_impact" in spec).toBe(false);
    expect("ownership" in spec).toBe(false);
  });
});

describe("request and parse", () => {
  test("one person call scores a hire without role and an output with scale and role", () => {
    const { seen, claims } = scoreLines([
      {
        id: "job",
        publishedAt: "2024-06-01",
        statement: [
          "Engineer at Harborline (Jan 2020 - Mar 2021)",
          "- Built the kiosk for 40 club members",
        ].join("\n"),
      },
      {
        id: "free",
        statement: "Selected as 1 of 400 applicants to the Northwind program.",
        publishedAt: null,
      },
    ]);

    const hire = seen.find((request) => request.state.text.startsWith("Engineer at Harborline"));
    const built = seen.find(
      (request) => request.state.text === "Built the kiosk for 40 club members",
    );
    const freeProbe = seen.find(
      (request) =>
        request.state.text.startsWith("Selected as 1 of 400") &&
        !("selectivity" in request.questions),
    );
    const freeScore = seen.find(
      (request) =>
        request.state.text.startsWith("Selected as 1 of 400") && "selectivity" in request.questions,
    );
    if (!hire || !built || !freeProbe || !freeScore) {
      throw new Error("expected a hire request, an output request, and a free-line pair");
    }

    expect(Object.keys(hire.questions)).toEqual(["claim_class", "selectivity", "pool_strength"]);
    expect("role_seed" in hire.state).toBe(false);
    expect(hire.state.title_hint).toBe("Engineer");
    expect(JSON.stringify(hire.questions)).toContain(REGION_BAN);
    expect(JSON.stringify(hire.questions)).toContain(TITLE_SENTENCE);
    expect(JSON.stringify(hire.questions)).not.toMatch(
      /stronger country|weaker country|stronger city|weaker city|stronger region|weaker region/i,
    );

    expect(Object.keys(built.questions)).toEqual(["claim_class", "difficulty", "scale", "role"]);
    expect("role_seed" in built.state && built.state.role_seed).toBe("major_contributor");
    expect(built.state.title_hint).toBe("Engineer");
    expect(JSON.stringify(built.questions)).toContain(TITLE_SENTENCE);
    expect(JSON.stringify(built.questions)).not.toContain("country");
    expect(JSON.stringify(built.questions)).not.toContain("generalized_impact");
    expect(JSON.stringify(built.questions)).not.toContain("ownership");

    expect(freeScore.state.selection_rate).toBeCloseTo(1 / 400);
    expect(freeScore.state.title_hint).toBeNull();
    expect(Object.keys(freeProbe.questions)).toEqual(["claim_class"]);

    expect(claims.map((claim) => claim.claimClass)).toEqual(["selection", "output", "selection"]);
    const scoredHire = claims[0];
    const scoredBuilt = claims[1];
    if (!scoredHire || !scoredBuilt) throw new Error("expected scored claims");
    if (scoredHire.claimClass !== "selection" || scoredBuilt.claimClass !== "output") {
      throw new Error("expected a selection hire and an output bullet");
    }
    expect(scoredHire.pool_strength).toEqual({
      score: 3,
      confidence: 0.9,
      probabilities: [0, 0, 0, 1, 0],
    });
    expect(scoredHire.jobDates).toEqual({
      startedAt: "2020-01-01",
      endedAt: "2021-03-01",
      publishedAt: "2024-06-01",
    });
    expect("role" in scoredHire).toBe(false);
    expect(scoredBuilt.scale.score).toBe(1);
    expect(scoredBuilt.role.choice).toBe("major_contributor");
    expect(scoredBuilt.roleSeed).toBe("major_contributor");
    expect(scoredBuilt.jobDates).toEqual({
      startedAt: "2020-01-01",
      endedAt: "2021-03-01",
      publishedAt: "2024-06-01",
    });
    expect(scoredBuilt.rubricId).toBe("career_evidence@1.2.0");
    expect(scoredBuilt.rubricHash).toBe(PINNED_RUBRIC_HASH);
    expect(scoredBuilt.status).toBe("accepted");
    expect(claims.every((claim) => claim.rubricId === "career_evidence@1.2.0")).toBe(true);
  });

  test("an unstated pool can stay off zero, and low confidence goes to review", () => {
    const { claims } = scoreLines(
      [
        {
          id: "job",
          statement: "Engineer at Harborline (Jan 2020 - Mar 2021)\n- Built the kiosk",
          publishedAt: null,
        },
      ],
      { poolScore: 3, poolConfidence: 0.2, scaleConfidence: 0.2 },
    );
    const hire = claims[0];
    const built = claims[1];
    if (hire?.claimClass !== "selection") throw new Error("expected the hire");
    if (built?.claimClass !== "output") throw new Error("expected the bullet");
    expect(hire.pool_strength.score).toBe(3);
    expect(hire.status).toBe("review");
    expect(hire.reviewReasons).toEqual(["dimension_low_confidence"]);
    expect(built.scale.score).toBe(1);
    expect(built.status).toBe("review");
    expect(built.role.confidence).toBe(0.1);
  });

  test("role confidence alone does not send an output to review", () => {
    const { claims } = scoreLines([
      {
        id: "job",
        statement: "Engineer at Harborline (Jan 2020 - Mar 2021)\n- Built the kiosk",
        publishedAt: null,
      },
    ]);
    const built = claims[1];
    if (built?.claimClass !== "output") throw new Error("expected the bullet");
    expect(built.role.confidence).toBe(0.1);
    expect(built.status).toBe("accepted");
  });

  test("a response with no pool strength is refused, rather than stored as zero", () => {
    expect(() =>
      scoreClaimRubricV12({
        lines: [
          {
            id: "job",
            statement: "Engineer at Harborline (Jan 2020 - Mar 2021)",
            publishedAt: null,
          },
        ],
        source: "resume",
        respond: () => ({
          claim_class: classBlock("selection"),
          selectivity: level(4),
        }),
      }),
    ).toThrow(JudgmentInvariantError);
  });

  test("a both answer on an already-split free line scores each fragment once", () => {
    const statement = "Built a router; selected as 1 of 400 applicants.";
    const claims = scoreClaimRubricV12({
      lines: [{ id: "router", statement, publishedAt: null }],
      source: "resume",
      respond: () => bothEverywhere(),
    });
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.text)).toEqual([
      "Built a router",
      "selected as 1 of 400 applicants.",
    ]);
    expect(claims.map((claim) => claim.claimClass)).toEqual(["output", "selection"]);
  });

  test("an unsplit both line still yields a selection and an output", () => {
    const statement = "Won 1 of 400 for building the Northwind routing service.";
    const claims = scoreClaimRubricV12({
      lines: [{ id: "win", statement, publishedAt: null }],
      source: "resume",
      respond: () => bothEverywhere(),
    });
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.claimClass)).toEqual(["selection", "output"]);
    expect(claims.every((claim) => claim.text === statement)).toBe(true);
  });

  test("a known company rate becomes selection_rate and the evidence stays on the claim", () => {
    const { seen, claims } = scoreLines(
      [
        {
          id: "job",
          statement: "Engineer at Harborline (Jan 2020 - Mar 2021)",
          publishedAt: null,
        },
      ],
      {},
      SYNTHETIC_COMPANY_SEED,
    );
    const request = seen[0];
    const claim = claims[0];
    if (!request || claim?.claimClass !== "selection") throw new Error("expected the hire");
    expect(request.state.selection_rate).toBe(0.04);
    expect(request.state.selection_rate_upper_bound).toBe(false);
    expect(request.state.selection_rate_source).toBe("https://example.invalid/harborline-intern");
    expect(claim.companyEvidence?.knownRate?.rate).toBe(0.04);
    expect(claim.companyEvidence?.investorTier).toBe(3);
    expect(claim.companyEvidence?.proxyLift).toBe(0);
    expect(selectivityLevelForRate(0.04)).toBe(3);

    const plain = scoreLines([
      {
        id: "job",
        statement: "Engineer at Harborline (Jan 2020 - Mar 2021)",
        publishedAt: null,
      },
    ]);
    expect(plain.seen[0]?.state.selection_rate).toBeNull();
    expect(plain.seen[0]?.state.selection_rate_source).toBeNull();
    if (plain.claims[0]?.claimClass !== "selection") throw new Error("expected the plain hire");
    expect(plain.claims[0].companyEvidence?.knownRate).toBeNull();
    expect(plain.claims[0].companyEvidence?.proxyLift).toBe(0);
  });

  test("YC W24 copies the published ceiling, and another batch does not invent a rate", () => {
    const w24 = scoreLines([
      {
        id: "yc",
        statement:
          "Founder at Pine Widget (Jan 2024 - Present)\n- Accepted into YC W24\n- Shipped the editor",
        publishedAt: null,
      },
    ]);
    const request = w24.seen.find((item) => "selectivity" in item.questions);
    const claim = w24.claims[0];
    if (!request || claim?.claimClass !== "selection") throw new Error("expected the W24 claim");
    expect(request.state.selection_rate).toBe(0.01);
    expect(request.state.selection_rate_upper_bound).toBe(true);
    expect(request.state.selection_rate_source).toBe(
      "https://www.ycombinator.com/blog/meet-the-yc-winter-2024-batch/",
    );
    expect(claim.companyEvidence?.knownRate).toEqual({
      rate: 0.01,
      upperBound: true,
      source: "https://www.ycombinator.com/blog/meet-the-yc-winter-2024-batch/",
    });
    expect(claim.companyEvidence?.proxyLift).toBe(0);
    expect("companyEvidence" in (w24.claims[1] ?? {})).toBe(false);

    const w23 = scoreLines([
      {
        id: "yc23",
        statement: "Founder at Pine Widget (Jan 2023 - Present)\n- Accepted into YC W23",
        publishedAt: null,
      },
    ]);
    const older = w23.seen.find((item) => "selectivity" in item.questions);
    if (!older || w23.claims[0]?.claimClass !== "selection")
      throw new Error("expected the W23 claim");
    expect(older.state.selection_rate).toBeNull();
    expect(older.state.selection_rate_source).toBeNull();
    expect(w23.claims[0].companyEvidence?.knownRate).toBeNull();
  });

  test("a header with no bullets scores the hire and skips the empty output", () => {
    const { seen, claims } = scoreLines([
      {
        id: "solo",
        statement: "Engineer at Harborline (Jan 2020 - Mar 2021)",
        publishedAt: null,
      },
    ]);
    expect(seen).toHaveLength(1);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.claimClass).toBe("selection");
    expect(claims[0]?.text).toBe("Engineer at Harborline (Jan 2020 - Mar 2021)");
  });

  test("the 1.2.0 verb seed maps created and maintained, and the 1.1.0 tier does not", () => {
    const bullets: readonly (readonly [
      string,
      "original_author" | "major_contributor" | "maintainer" | "minor_part" | null,
    ])[] = [
      ["Founded the Lumen press.", "original_author"],
      ["Created the Northwind catalog.", "original_author"],
      ["Owned the Ferry ledger.", "original_author"],
      ["Led the night desk.", "original_author"],
      ["Built the Harborline router.", "major_contributor"],
      ["Developed the Pylon parser.", "major_contributor"],
      ["Designed the exhibit lights.", "major_contributor"],
      ["Maintained the Northwind kiosk.", "maintainer"],
      ["Contributed a chapter to the Lumen notes.", "minor_part"],
      ["Assisted the night editor.", "minor_part"],
      ["Helped the editor at Ferry.", "minor_part"],
      ["Helped lead the migration at Pylon.", "minor_part"],
      ["Worked under Nia on the catalog.", null],
    ];
    const { seen } = scoreLines([
      {
        id: "job",
        statement: [
          "Engineer at Harborline (Jan 2020 - Mar 2021)",
          ...bullets.map(([text]) => `- ${text}`),
        ].join("\n"),
        publishedAt: null,
      },
    ]);
    for (const [text, seed] of bullets) {
      const request = seen.find((item) => item.state.text === text);
      if (!request || !("role_seed" in request.state)) {
        throw new Error(`missing output request for ${text}`);
      }
      expect(request.state.role_seed, text).toBe(seed);
    }
    expect(extractFacts("Created the Northwind catalog.").ownership).toBeNull();
    expect(extractFacts("Maintained the Northwind kiosk.").ownership).toBeNull();
    expect(extractFacts("Worked under Nia on the catalog.").ownership).toBe("contributed");
  });
});

describe("claimQuestionsV12", () => {
  test("the question bank names the 1.2.0 dimensions", () => {
    expect(Object.keys(claimQuestionsV12(spec))).toEqual([
      "claim_class",
      "selectivity",
      "pool_strength",
      "difficulty",
      "scale",
      "role",
    ]);
  });
});
