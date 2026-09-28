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
  CAREER_EVIDENCE_V1_2_0,
  CAREER_EVIDENCE_V1_2_1,
  CAREER_EVIDENCE_V1_2_2,
  careerEvidenceV12QuestionPlan,
  careerEvidenceV12RubricHash,
} from "../src/models/careerEvidenceV12.ts";
import { getSpec } from "../src/models/registry.ts";
import { fixtureV12Client } from "./fixtures/jev-claim-smoke-v12-client.ts";

const RUBRIC_HASH_V120 = "bcf23650aa94d7db63cd254cd04d31cfbd77201af887c7b3b4645238f5d9e376";
const RUBRIC_HASH_V121 = "8170c38a439ccca3130ae2e60979b5b0519a6ba3ef2500ffeaac75b199691e3c";
const RUBRIC_HASH_V122 = "b644c4c39148e937a8d7cd853a8c2d2232eec04bb1e42a48e9ced8eaeb9b727f";
const PREVIOUS_V123_HASH = "31027fcc7242682d2141b156bed07ad57e8a67af25572fe6a3e9c01fc1d6f7ca";
const RUBRIC_HASH_V123 = "8119ac21ca629e156962472eb22e9104c0b47a0d0d508dae2d37df37441145bb";
const ONE_LEVEL_WHEN_UNSTATED =
  "If the text states no quantity, pick the most likely level from who the audience is, and put the probability on that one level.";
const NOT_REACH =
  "An applicant or acceptance count, an absolute quality percentage, and a data or sample size are not reach. " +
  "Set the level from the stated or implied audience instead. " +
  "Convert a speedup to a percent improvement. " +
  "A before-and-after time, or a multiplier of 2x or more, counts as an improvement of at least 50%, and then use the percent ranges.";
const fixturePath = join(import.meta.dir, "fixtures/jev-claim-smoke-v12.items.json");

test("career_evidence@1.2.3 restores the 1.2.1 selection prompt and classifies the remaining scale numbers", () => {
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_0)).toBe(RUBRIC_HASH_V120);
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_1)).toBe(RUBRIC_HASH_V121);
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_2)).toBe(RUBRIC_HASH_V122);
  expect(CAREER_EVIDENCE_V1_2_2.selectivity.question).toContain("no company evidence");
  expect(CAREER_EVIDENCE_V1_2_2.scale.question).not.toContain("are not reach");
  expect(CAREER_EVIDENCE_V1_2_2.scale.question).toContain(ONE_LEVEL_WHEN_UNSTATED);

  const spec = getSpec("career_evidence", "1.2.3");
  if (!("pool_strength" in spec) || !("scale" in spec)) throw new Error("expected a 1.2 spec");

  expect(spec.selectivity).toEqual(CAREER_EVIDENCE_V1_2_1.selectivity);
  expect(spec.pool_strength).toEqual(CAREER_EVIDENCE_V1_2_1.pool_strength);
  expect(spec.selectivity.question).not.toContain("no company evidence");
  expect(spec.scale.question).toBe(
    `${CAREER_EVIDENCE_V1_2_2.scale.question.replace(`${ONE_LEVEL_WHEN_UNSTATED} `, "")} ${NOT_REACH}`,
  );
  expect(spec.scale.question).not.toContain(ONE_LEVEL_WHEN_UNSTATED);
  expect(spec.scale.question).not.toContain("put the probability on that one level");
  expect(spec.scale.question).toContain("still pick one level");
  expect(spec.scale.question).toContain("A stated number is mapped, not hedged.");
  expect(spec.scale.levels).toEqual(CAREER_EVIDENCE_V1_2_2.scale.levels);
  expect(spec.difficulty).toEqual(CAREER_EVIDENCE_V1_2_2.difficulty);
  expect(spec.role).toEqual(CAREER_EVIDENCE_V1_2_2.role);
  expect(spec.thresholds).toEqual({ classConfidence: 0.65, dimensionConfidence: 0.5 });
  expect(careerEvidenceV12QuestionPlan(spec)).toEqual(
    careerEvidenceV12QuestionPlan(CAREER_EVIDENCE_V1_2_2),
  );

  const hash = careerEvidenceV12RubricHash(spec);
  expect(hash).toBe(RUBRIC_HASH_V123);
  expect(hash).not.toBe(PREVIOUS_V123_HASH);
  expect(hash).not.toBe(RUBRIC_HASH_V120);
  expect(hash).not.toBe(RUBRIC_HASH_V121);
  expect(hash).not.toBe(RUBRIC_HASH_V122);
});

test("career_evidence@1.2.3 smoke still emits noCompanyEvidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-v123-"));
  const code = await main(
    ["--items", fixturePath, "--rubric", "career_evidence@1.2.3", "--out", dir],
    undefined,
    undefined,
    fixtureV12Client(),
  );
  expect(code).toBe(0);
  const summary = await readFile(join(dir, "summary.md"), "utf8");
  expect(summary).toContain("Rubric career_evidence@1.2.3.");
  expect(summary).toContain(`Rubric hash ${RUBRIC_HASH_V123}.`);
  expect(summary).not.toContain(`Rubric hash ${PREVIOUS_V123_HASH}.`);
  expect(summary).not.toContain(`Rubric hash ${RUBRIC_HASH_V122}.`);
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

test("noCompanyEvidence stays true only when stage, tier, and acceptance rate are all absent", () => {
  const spec = getSpec("career_evidence", "1.2.3");
  if (!("pool_strength" in spec)) throw new Error("expected a 1.2 spec");

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
    spec,
  );
  const hire = plain.find((claim) => claim.id === "lab#hire");
  const output = plain.find((claim) => claim.claimClass === "output");
  if (!hire || !output) throw new Error("expected a hire and an output");
  expect(hire.noCompanyEvidence).toBe(true);
  expect(output.noCompanyEvidence).toBe(false);

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
    spec,
  );
  const award = rated.find((claim) => claim.claimClass === "selection");
  if (!award) throw new Error("expected a selection");
  expect(award.noCompanyEvidence).toBe(false);
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
