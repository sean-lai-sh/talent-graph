import { expect, test } from "bun:test";
import { v12LiveQuestions } from "../scripts/jev-claim-smoke-v12.ts";
import {
  type ClaimRubricV12Request,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";
import type { CompanySeed } from "../src/longitudinal/companySeed.ts";
import {
  CAREER_EVIDENCE_V1_2_0,
  CAREER_EVIDENCE_V1_2_1,
  CAREER_EVIDENCE_V1_2_2,
  CAREER_EVIDENCE_V1_2_3,
  CAREER_EVIDENCE_V1_2_4,
  careerEvidenceV12RubricHash,
} from "../src/models/careerEvidenceV12.ts";
import { CURRENT_SPECS, getSpec } from "../src/models/registry.ts";
import type { CareerEvidenceV12Spec } from "../src/models/spec.ts";
import { SYNTHETIC_COMPANY_SEED } from "./fixtures/companySeed.synthetic.ts";

const RUBRIC_HASH_V120 = "cd500b05728594c6599e31e8aee5c6db81a2c7814aca61332dbd195b3fc662a6";
const RUBRIC_HASH_V121 = "8170c38a439ccca3130ae2e60979b5b0519a6ba3ef2500ffeaac75b199691e3c";
const RUBRIC_HASH_V122 = "b644c4c39148e937a8d7cd853a8c2d2232eec04bb1e42a48e9ced8eaeb9b727f";
const RUBRIC_HASH_V123 = "8119ac21ca629e156962472eb22e9104c0b47a0d0d508dae2d37df37441145bb";
const RUBRIC_HASH_V124 = "fafb7d39fbc2607f35371756884bb8cb6cf724df298fca67bad28b4b9a4084f6";

const COMPANY_CONTEXT_SENTENCE =
  "When `company_context` is present, treat its sourced facts about the employer at the hire date " +
  "(stage, top investor, published acceptance rate, hiring bar) as evidence for this answer, " +
  "and infer nothing from a fact it does not list.";

const SEED: CompanySeed = {
  investors: SYNTHETIC_COMPANY_SEED.investors,
  companies: [
    ...SYNTHETIC_COMPANY_SEED.companies,
    {
      name: "Quarry",
      aliases: ["Quarry Inc"],
      source: "https://example.invalid/quarry",
      currentStage: "public_large",
      rounds: [
        {
          date: "2012-05-01",
          stage: "public_large",
          investors: [],
          source: "https://example.invalid/quarry-ipo",
        },
      ],
      publishedRate: {
        rate: 0.02,
        upperBound: true,
        source: "https://example.invalid/quarry-rate",
      },
      hiringBar: {
        note: "Quarry runs a five-round loop with a hiring committee.",
        source: "https://example.invalid/quarry-bar",
      },
    },
  ],
};

function hireRequest(
  statement: string,
  spec: CareerEvidenceV12Spec = CAREER_EVIDENCE_V1_2_4,
): ClaimRubricV12Request {
  const seen: ClaimRubricV12Request[] = [];
  scoreClaimRubricV12(
    {
      lines: [{ id: "job", statement, publishedAt: null }],
      source: "resume",
      respond: (request) => {
        seen.push(request);
        return answer();
      },
      seed: SEED,
    },
    spec,
  );
  const request = seen.find((item) => "selectivity" in item.questions);
  if (!request) throw new Error("expected a hire request");
  return request;
}

function questionText(request: ClaimRubricV12Request): string {
  return JSON.stringify(request.questions);
}

test("career_evidence@1.2.0 through 1.2.3 keep their hashes and 1.2.4 is pinned", () => {
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_0)).toBe(RUBRIC_HASH_V120);
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_1)).toBe(RUBRIC_HASH_V121);
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_2)).toBe(RUBRIC_HASH_V122);
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_3)).toBe(RUBRIC_HASH_V123);
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_4)).toBe(RUBRIC_HASH_V124);
  expect(getSpec("career_evidence", "1.2.4")).toBe(CAREER_EVIDENCE_V1_2_4);
  expect(CURRENT_SPECS.career_evidence.version).toBe("1.0.0");
});

test("1.2.4 keeps every 1.2.3 question byte-identical", () => {
  const { version: _next, ...next } = CAREER_EVIDENCE_V1_2_4;
  const { version: _previous, ...previous } = CAREER_EVIDENCE_V1_2_3;
  expect(next).toEqual(previous);
});

test("a hire at a seeded private company sends the stage and top investor, and nothing unsourced", () => {
  const request = hireRequest("Engineer at Northwind (Jul 2021 - Mar 2022)");
  expect(request.state.company_context).toEqual({
    stage_at_hire: "Series A or B",
    top_investor: "tier 3 investor: Ferry Capital",
  });
  expect(request.state.selection_rate).toBeNull();
  if (!("selectivity" in request.questions)) throw new Error("expected selection questions");
  expect(request.questions.selectivity.instructions).toBe(
    `${CAREER_EVIDENCE_V1_2_3.selectivity.question} ${COMPANY_CONTEXT_SENTENCE}`,
  );
  expect(request.questions.pool_strength.instructions).toBe(
    `${CAREER_EVIDENCE_V1_2_3.pool_strength.question} ${COMPANY_CONTEXT_SENTENCE}`,
  );
});

test("a hire at a public company with no funding rounds sends stage, rate, and hiring bar with sources", () => {
  const request = hireRequest("Engineer at Quarry Inc (Jan 2022 - Present)");
  expect(request.state.company_context).toEqual({
    stage_at_hire: "public or large company",
    acceptance_rate: {
      rate: 0.02,
      upper_bound: true,
      source: "https://example.invalid/quarry-rate",
    },
    hiring_bar: {
      note: "Quarry runs a five-round loop with a hiring committee.",
      source: "https://example.invalid/quarry-bar",
    },
  });
});

test("an unseeded org sends no company_context key and its questions never mention it", () => {
  const request = hireRequest("Engineer at Example Lab (Jan 2020 - Mar 2021)");
  expect("company_context" in request.state).toBe(false);
  expect(questionText(request)).not.toContain("company_context");
  if (!("selectivity" in request.questions)) throw new Error("expected selection questions");
  expect(request.questions.selectivity.instructions).toBe(
    CAREER_EVIDENCE_V1_2_3.selectivity.question,
  );
  expect(request.questions.pool_strength.instructions).toBe(
    CAREER_EVIDENCE_V1_2_3.pool_strength.question,
  );
  expect(JSON.stringify(v12LiveQuestions(CAREER_EVIDENCE_V1_2_4, request))).not.toContain(
    "company_context",
  );
});

test("a seeded hire before the company's first round sends no company_context", () => {
  const request = hireRequest("Engineer at Northwind (Jan 2019 - Feb 2019)");
  expect("company_context" in request.state).toBe(false);
  expect(questionText(request)).not.toContain("company_context");
});

test("1.2.3 never sends company_context, even for a seeded org", () => {
  const request = hireRequest(
    "Engineer at Quarry Inc (Jan 2022 - Present)",
    CAREER_EVIDENCE_V1_2_3,
  );
  expect("company_context" in request.state).toBe(false);
  expect(questionText(request)).not.toContain("company_context");
});

test("the live 1.2.4 question sent to the model carries the company_context sentence only when the state does", () => {
  const seeded = hireRequest("Engineer at Northwind (Jul 2021 - Mar 2022)");
  const live = JSON.stringify(v12LiveQuestions(CAREER_EVIDENCE_V1_2_4, seeded));
  expect(live).toContain("company_context");
});

function answer(): unknown {
  const level = {
    score: 2,
    confidence: 0.9,
    probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
  };
  return {
    selectivity: level,
    pool_strength: level,
    difficulty: level,
    scale: level,
    role: {
      choice: "major_contributor",
      confidence: 0.9,
      probabilities: { original_author: 0, major_contributor: 1, maintainer: 0, minor_part: 0 },
    },
  };
}

test("a hire before a seeded company's first round sends no context and is tagged as lacking evidence", () => {
  const seed: CompanySeed = {
    investors: SEED.investors,
    companies: [
      ...SEED.companies,
      {
        name: "Shoal",
        aliases: [],
        source: "https://example.invalid/shoal",
        currentStage: "series_a_b",
        rounds: [
          {
            date: "2021-06-01",
            stage: "series_a_b",
            investors: [],
            source: "https://example.invalid/shoal-a",
          },
        ],
        publishedRate: null,
        hiringBar: null,
      },
    ],
  };
  const seen: ClaimRubricV12Request[] = [];
  const claims = scoreClaimRubricV12(
    {
      lines: [
        {
          id: "job",
          statement: "Engineer at Shoal (Jan 2020 - Mar 2021)\n- Built the kiosk",
          publishedAt: null,
        },
      ],
      source: "resume",
      respond: (request) => {
        seen.push(request);
        return answer();
      },
      seed,
    },
    CAREER_EVIDENCE_V1_2_4,
  );
  const request = seen.find((item) => "selectivity" in item.questions);
  if (!request) throw new Error("expected a hire request");
  expect("company_context" in request.state).toBe(false);
  const hire = claims.find((claim) => claim.id === "job#hire");
  expect((hire as { noCompanyEvidence?: unknown } | undefined)?.noCompanyEvidence).toBe(true);
});
