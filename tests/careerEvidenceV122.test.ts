import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/jev-claim-smoke.ts";
import {
  type ClaimRubricV12Request,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";
import {
  CAREER_EVIDENCE_V1_2_1,
  CAREER_EVIDENCE_V1_2_2,
  careerEvidenceV12QuestionPlan,
  careerEvidenceV12RubricHash,
} from "../src/models/careerEvidenceV12.ts";
import { getSpec, specVersions } from "../src/models/registry.ts";
import { fixtureV12Client } from "./fixtures/jev-claim-smoke-v12-client.ts";

const RUBRIC_HASH_V121 = "8170c38a439ccca3130ae2e60979b5b0519a6ba3ef2500ffeaac75b199691e3c";
const PREVIOUS_V122_HASH = "842d40ab0e280f7270450fd03ac5fb3fe020e00a5ce8229b5a916a3110ede6cc";
const NO_COMPANY_EVIDENCE = "When `selection_rate` is absent, no company evidence is available.";
const fixturePath = join(import.meta.dir, "fixtures/jev-claim-smoke-v12.items.json");

function readTag(claim: object): unknown {
  return (claim as { noCompanyEvidence?: unknown }).noCompanyEvidence;
}

test("career_evidence@1.2.2 keeps scale ranges and only states that company evidence is missing", () => {
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_1)).toBe(RUBRIC_HASH_V121);
  expect(CAREER_EVIDENCE_V1_2_1.selectivity.question).not.toContain("no company evidence");
  expect(CAREER_EVIDENCE_V1_2_1.pool_strength.question).toContain(
    "answer the most likely level with low confidence",
  );
  expect(CAREER_EVIDENCE_V1_2_1.scale.question).not.toContain("mapped, not hedged");
  expect(CAREER_EVIDENCE_V1_2_1.thresholds).toEqual({
    classConfidence: 0.65,
    dimensionConfidence: 0.5,
  });

  expect(specVersions("career_evidence")).toContain("1.2.2");
  const spec = getSpec("career_evidence", "1.2.2");
  if (!("pool_strength" in spec) || !("scale" in spec)) throw new Error("expected a 1.2 spec");

  const selection = [
    spec.selectivity.question,
    ...spec.selectivity.levels,
    spec.pool_strength.question,
    ...spec.pool_strength.levels,
  ].join("\n");
  const scale = [spec.scale.question, ...spec.scale.levels].join("\n");

  expect(spec.selectivity.question).toBe(
    `${CAREER_EVIDENCE_V1_2_1.selectivity.question} ${NO_COMPANY_EVIDENCE}`,
  );
  expect(spec.pool_strength.question).toBe(
    `${CAREER_EVIDENCE_V1_2_1.pool_strength.question} ${NO_COMPANY_EVIDENCE}`,
  );
  expect(spec.selectivity.levels).toEqual(CAREER_EVIDENCE_V1_2_1.selectivity.levels);
  expect(spec.pool_strength.levels).toEqual(CAREER_EVIDENCE_V1_2_1.pool_strength.levels);
  expect(selection).not.toContain("well-known large employer");
  expect(selection).not.toContain("unknown startup");
  expect(selection).not.toContain("university lab");
  expect(selection).not.toContain("student club");
  expect(selection).not.toContain("Do not spread probability");
  expect(scale).toContain("A stated number is mapped, not hedged.");
  expect(scale).toContain("Users 1 to 99");
  expect(scale).toContain("under 1,000");
  expect(scale).toContain("percent improvement under 20%");
  expect(scale).toContain("at most 15");
  expect(scale).toContain("under $10,000");

  expect(careerEvidenceV12RubricHash(spec)).not.toBe(RUBRIC_HASH_V121);
  expect(careerEvidenceV12RubricHash(spec)).not.toBe(PREVIOUS_V122_HASH);
  expect(careerEvidenceV12QuestionPlan(spec)).toEqual(
    careerEvidenceV12QuestionPlan(CAREER_EVIDENCE_V1_2_1),
  );
  expect(spec.thresholds).toEqual({ classConfidence: 0.65, dimensionConfidence: 0.5 });
  expect(spec.difficulty).toEqual(CAREER_EVIDENCE_V1_2_1.difficulty);
  expect(spec.role).toEqual(CAREER_EVIDENCE_V1_2_1.role);
});

test("career_evidence@1.2.2 smoke runs on the synthetic fixture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-v122-"));
  const code = await main(
    ["--items", fixturePath, "--rubric", "career_evidence@1.2.2", "--out", dir],
    undefined,
    undefined,
    fixtureV12Client(),
  );
  expect(code).toBe(0);
  const summary = await readFile(join(dir, "summary.md"), "utf8");
  expect(summary).toContain("Rubric career_evidence@1.2.2.");
  expect(summary).not.toContain(`Rubric hash ${RUBRIC_HASH_V121}.`);
  expect(summary).toContain("Claims accepted 13. Review 1. Rejected 0.");
  expect(summary).toContain("Calls 16. Answered 16. judgment_unavailable 0. Invariant failures 0.");

  const rows = (await readFile(join(dir, "claims.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { claimId: string; noCompanyEvidence?: boolean });
  expect(rows.find((row) => row.claimId === "a-harbor#hire")?.noCompanyEvidence).toBe(true);
  expect(rows.find((row) => row.claimId === "a-north")?.noCompanyEvidence).toBe(false);
  expect(rows.find((row) => row.claimId === "a-pine#funding")?.noCompanyEvidence).toBe(false);
  expect(rows.find((row) => row.claimId === "a-harbor#2")?.noCompanyEvidence).toBe(false);
});

test("noCompanyEvidence is true only when stage, tier, and acceptance rate are all absent", () => {
  const plain = scoreClaimRubricV12(
    {
      lines: [
        {
          id: "lab",
          statement: "Engineer at Example Lab (Jan 2020 - Mar 2021)\n- Built the example kiosk",
          publishedAt: null,
        },
      ],
      source: "resume",
      respond: answer,
    },
    CAREER_EVIDENCE_V1_2_2,
  );
  const hire = plain.find((claim) => claim.id === "lab#hire");
  const output = plain.find((claim) => claim.claimClass === "output");
  if (!hire || !output) throw new Error("expected a hire and an output");
  expect(readTag(hire)).toBe(true);
  expect(readTag(output)).toBe(false);

  const rated = scoreClaimRubricV12(
    {
      lines: [
        {
          id: "pool",
          statement: "Selected as 1 of 400 applicants from one school for the Northwind program.",
          publishedAt: "2022-05-01T00:00:00.000Z",
        },
      ],
      source: "resume",
      respond: answer,
    },
    CAREER_EVIDENCE_V1_2_2,
  );
  const award = rated.find((claim) => claim.claimClass === "selection");
  if (!award) throw new Error("expected a selection");
  expect(readTag(award)).toBe(false);

  const funded = scoreClaimRubricV12(
    {
      lines: [
        {
          id: "yc",
          statement:
            "Founder at Pine Widget (Jan 2024 - Present)\n- Accepted into YC W24\n- Shipped the editor",
          publishedAt: null,
        },
      ],
      source: "resume",
      respond: answer,
    },
    CAREER_EVIDENCE_V1_2_2,
  );
  const funding = funded.find((claim) => claim.id === "yc#funding");
  if (!funding) throw new Error("expected a funding claim");
  expect(readTag(funding)).toBe(false);
});

function answer(request: ClaimRubricV12Request): unknown {
  const level = {
    score: 2,
    confidence: 0.9,
    probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
  };
  const chosen = /selected|1 of \d+/i.test(request.state.text) ? "selection" : "output";
  if (!("selectivity" in request.questions) && !("difficulty" in request.questions)) {
    return {
      claim_class: {
        choice: chosen,
        confidence: 0.9,
        probabilities: {
          selection: chosen === "selection" ? 1 : 0,
          output: chosen === "output" ? 1 : 0,
          both: 0,
        },
      },
    };
  }
  if ("selectivity" in request.questions) {
    return {
      claim_class: {
        choice: "selection",
        confidence: 1,
        probabilities: { selection: 1, output: 0, both: 0 },
      },
      selectivity: level,
      pool_strength: level,
    };
  }
  return {
    claim_class: {
      choice: "output",
      confidence: 1,
      probabilities: { selection: 0, output: 1, both: 0 },
    },
    difficulty: level,
    scale: level,
    role: {
      choice: "major_contributor",
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
