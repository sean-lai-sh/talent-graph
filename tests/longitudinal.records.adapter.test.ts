/**
 * What the adapter keeps, and what the projections refuse.
 *
 * The responded model is kept verbatim and never normalised to the requested
 * one; usage and the request id are recorded, with `null` for an absent id;
 * probability vectors are indexed off `spec.levels` rather than key order; and
 * the score is recorded un-rounded. A record that does not answer this spec's
 * questions is not a partial observation to be projected with the rest
 * missing — it is rejected.
 */

import { describe, expect, test } from "bun:test";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { projectClaim, projectIdentity } from "../src/longitudinal/projections.ts";
import type { JevAnswer, JevJudgmentRecord } from "../src/longitudinal/records.ts";
import type { GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { careerEvidenceSpecId } from "../src/models/careerEvidence.ts";
import { fakeClient, identity, items, spec } from "./helpers/records.ts";

describe("judgment records: what the adapter keeps", () => {
  test("respondedModel is preserved verbatim, never normalised to the requested model", async () => {
    const client = fakeClient({ model: "jev-2026-09-preview" });
    const service = createJevJudgmentService(client.client, spec);
    const { record } = await service.assessIdentity(identity, items[0] as GrokEvidenceItem);
    expect(record.requestedModel).toBe("jev");
    expect(record.respondedModel).toBe("jev-2026-09-preview");
    expect(record.specId).toBe(careerEvidenceSpecId(spec));
  });

  test("usage and the request id are recorded, with null for an absent id", async () => {
    const withId = createJevJudgmentService(fakeClient({ requestId: "req-42" }).client, spec);
    const identified = await withId.assessClaim(items[0] as GrokEvidenceItem, identity.personId);
    expect(identified.record.requestId).toBe("req-42");
    expect(identified.record.usage).toEqual({ inputTokens: 120, outputTokens: 34 });

    const anonymous = createJevJudgmentService(fakeClient().client, spec);
    const { record } = await anonymous.assessClaim(items[0] as GrokEvidenceItem, identity.personId);
    expect(record.requestId).toBe(null);
    expect("requestId" in record).toBe(true);
  });

  test("probabilities are indexed off spec.levels, whatever order the keys arrive in", async () => {
    const scrambled = createJevJudgmentService(
      fakeClient({ scrambleProbabilityKeys: true }).client,
      spec,
    );
    const { assessment, record } = await scrambled.assessClaim(
      items[0] as GrokEvidenceItem,
      identity.personId,
    );
    const difficulty = record.answers.difficulty as { probabilities: number[]; legend: string[] };
    expect(difficulty.probabilities).toEqual([0, 0, 0.2, 0.8, 0]);
    expect(difficulty.legend).toEqual([...spec.levels.difficulty]);
    expect(assessment.dimensions[0]?.probabilities).toEqual([0, 0, 0.2, 0.8, 0]);
  });

  test("the score is recorded un-rounded and the assessment carries it unchanged", async () => {
    const service = createJevJudgmentService(fakeClient({ score: 3.4 }).client, spec);
    const { assessment, record } = await service.assessClaim(
      items[0] as GrokEvidenceItem,
      identity.personId,
    );
    expect((record.answers.ownership as { score: number }).score).toBe(3.4);
    expect(assessment.dimensions.map((judgment) => judgment.score)).toEqual([
      3.4, 3.4, 3.4, 3.4, 3.4,
    ]);
  });

  test("the assessment the adapter returns is exactly the projection of its record", async () => {
    const service = createJevJudgmentService(fakeClient().client, spec);
    const identityJudgment = await service.assessIdentity(identity, items[0] as GrokEvidenceItem);
    expect(identityJudgment.assessment).toEqual(projectIdentity(identityJudgment.record, spec));
    const claimJudgment = await service.assessClaim(
      items[0] as GrokEvidenceItem,
      identity.personId,
    );
    expect(claimJudgment.assessment).toEqual(projectClaim(claimJudgment.record, spec));
  });
});

describe("judgment records: projections reject what they cannot represent", () => {
  async function aRecord(kind: "identity" | "claim"): Promise<JevJudgmentRecord> {
    const service = createJevJudgmentService(fakeClient().client, spec);
    return kind === "identity"
      ? (await service.assessIdentity(identity, items[0] as GrokEvidenceItem)).record
      : (await service.assessClaim(items[0] as GrokEvidenceItem, identity.personId)).record;
  }

  test("a claim record missing a dimension answer is rejected", async () => {
    const record = await aRecord("claim");
    const { originality, ...rest } = record.answers as Record<string, unknown>;
    expect(originality).toBeDefined();
    expect(() => projectClaim({ ...record, answers: rest } as JevJudgmentRecord, spec)).toThrow(
      /originality/,
    );
  });

  test("an identity record with an unknown answer key is rejected", async () => {
    const record = await aRecord("identity");
    const answers = { ...record.answers, same_hairstyle: { noul: 1 } };
    expect(() => projectIdentity({ ...record, answers } as JevJudgmentRecord, spec)).toThrow(
      /same_hairstyle/,
    );
  });

  test("a record of the wrong kind is rejected by either projection", async () => {
    const claim = await aRecord("claim");
    const identityRecord = await aRecord("identity");
    expect(() => projectIdentity(claim, spec)).toThrow(/identity/);
    expect(() => projectClaim(identityRecord, spec)).toThrow(/claim/);
  });

  test("a probability vector that is not the rubric's length is rejected", async () => {
    const record = await aRecord("claim");
    const difficulty = record.answers.difficulty as unknown as Record<string, unknown>;
    const answers = {
      ...record.answers,
      difficulty: { ...difficulty, probabilities: [1, 0] } as unknown as JevAnswer,
    };
    expect(() => projectClaim({ ...record, answers }, spec)).toThrow(/probabilities/);
  });
});
