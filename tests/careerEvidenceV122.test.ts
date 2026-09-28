import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/jev-claim-smoke.ts";
import {
  CAREER_EVIDENCE_V1_2_1,
  careerEvidenceV12QuestionPlan,
  careerEvidenceV12RubricHash,
} from "../src/models/careerEvidenceV12.ts";
import { getSpec, specVersions } from "../src/models/registry.ts";
import { fixtureV12Client } from "./fixtures/jev-claim-smoke-v12-client.ts";

const RUBRIC_HASH_V121 = "8170c38a439ccca3130ae2e60979b5b0519a6ba3ef2500ffeaac75b199691e3c";
const fixturePath = join(import.meta.dir, "fixtures/jev-claim-smoke-v12.items.json");

test("career_evidence@1.2.1 prompt and hash stay, and 1.2.2 states the thin-evidence rule", () => {
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

  expect(selection).toContain("no company evidence");
  expect(selection).toContain(
    "Do not spread probability across adjacent levels because the evidence is thin.",
  );
  expect(selection).toContain("well-known large employer");
  expect(selection).toContain("unknown startup");
  expect(selection).toContain("university lab");
  expect(selection).toContain("student club");
  expect(scale).toContain("A stated number is mapped, not hedged.");
  expect(scale).toContain("Users 1 to 99");
  expect(scale).toContain("under 1,000");
  expect(scale).toContain("percent improvement under 20%");
  expect(scale).toContain("at most 15");
  expect(scale).toContain("under $10,000");

  expect(careerEvidenceV12RubricHash(spec)).toBe(
    "842d40ab0e280f7270450fd03ac5fb3fe020e00a5ce8229b5a916a3110ede6cc",
  );
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
});
