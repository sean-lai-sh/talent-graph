/**
 * The run id is over every input the derivation reads, and over nothing else.
 *
 * `runCareerEvidence` wraps the *derivation*, not the HTTP call: its input hash
 * is over the full content of the judgment records, sorted by id, plus the
 * window, the person, the evidence and the pipeline version. Perturbing any one
 * of them has to move the id, and reordering the same observations must not —
 * or two runs over different evidence could report under one id, and a repeat
 * of the same run would look like a new one.
 */

import { describe, expect, test } from "bun:test";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import type { DeriveEvidenceInput } from "../src/longitudinal/derive.ts";
import type { JevJudgmentRecord, JevRawScoreAnswer } from "../src/longitudinal/records.ts";
import { runCareerEvidence } from "../src/longitudinal/run.ts";
import type { GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { day, fakeClient, identity, items, run, spec } from "./helpers/records.ts";

describe("judgment records: the run hashes every input the derivation reads", () => {
  const base = async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    return {
      identity,
      evidence: items,
      records: result.records,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
    };
  };

  test("perturbing any derivation input moves the run id", async () => {
    const input = await base();
    const baseline = runCareerEvidence(input, { spec, now: day(100) });
    const records = input.records as JevJudgmentRecord[];
    const claimRecord = records[1] as JevJudgmentRecord;
    const answeredDifferently = {
      ...claimRecord,
      answers: {
        ...claimRecord.answers,
        difficulty: { ...(claimRecord.answers.difficulty as JevRawScoreAnswer), score: 1 },
      },
    };
    const perturbations: Record<string, DeriveEvidenceInput> = {
      "a record's answers": {
        ...input,
        records: [records[0] as JevJudgmentRecord, answeredDifferently, ...records.slice(2)],
      },
      identity: { ...input, identity: { ...identity, name: "Avery C." } },
      evidence: {
        ...input,
        evidence: [
          { ...(items[0] as GrokEvidenceItem), statement: "Avery shipped it." },
          items[1] as GrokEvidenceItem,
        ],
      },
      baselineAt: { ...input, baselineAt: day(10) },
      cutoffAt: { ...input, cutoffAt: day(91) },
      retrievedAt: { ...input, retrievedAt: day(101) },
      pipelineVersion: { ...input, pipelineVersion: "2" },
    };
    for (const [what, perturbed] of Object.entries(perturbations)) {
      const moved = runCareerEvidence(perturbed, { spec, now: day(100) });
      expect(moved.inputHash, `${what} must move the input hash`).not.toBe(baseline.inputHash);
      expect(moved.id, `${what} must move the run id`).not.toBe(baseline.id);
    }
  });

  test("reordering the records does not move the run id", async () => {
    const input = await base();
    const baseline = runCareerEvidence(input, { spec, now: day(100) });
    const reversed = runCareerEvidence(
      { ...input, records: [...input.records].reverse() },
      { spec, now: day(100) },
    );
    expect(reversed.inputHash).toBe(baseline.inputHash);
    expect(reversed.id).toBe(baseline.id);
  });
});
