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
import { MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import { projectClaim, projectIdentity } from "../src/longitudinal/projections.ts";
import type { JevAnswer, JevJudgmentRecord } from "../src/longitudinal/records.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
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

/**
 * A number outside the range its field is defined on is unrepresentable.
 *
 * Every case below is raised as a `JudgmentInvariantError` and named, never
 * clamped to the edge of the range and never coerced: a confidence of 1.4 read
 * as 1 would put a number nothing produced into a claim, and a score of 4.5
 * read as 4 would hide a rubric mismatch behind a plausible level. Both ends
 * of every range are inclusive, which the last case pins so the check cannot
 * drift into rejecting a perfectly ordinary 0 or 1.
 */
describe("judgment records: projections reject a value outside its range", () => {
  async function claimRecord(): Promise<JevJudgmentRecord> {
    const service = createJevJudgmentService(fakeClient().client, spec);
    return (await service.assessClaim(items[0] as GrokEvidenceItem, identity.personId)).record;
  }

  async function identityRecord(): Promise<JevJudgmentRecord> {
    const service = createJevJudgmentService(fakeClient().client, spec);
    return (await service.assessIdentity(identity, items[0] as GrokEvidenceItem)).record;
  }

  /** The same record with one answer field replaced. */
  const withAnswer = (
    record: JevJudgmentRecord,
    key: string,
    patch: Record<string, unknown>,
  ): JevJudgmentRecord =>
    ({
      ...record,
      answers: {
        ...record.answers,
        [key]: { ...(record.answers[key] as object), ...patch },
      },
    }) as JevJudgmentRecord;

  test("an identity decision confidence above one is rejected, not clamped", async () => {
    const record = await identityRecord();
    expect(() =>
      projectIdentity(withAnswer(record, "decision", { confidence: 1.4 }), spec),
    ).toThrow(JudgmentInvariantError);
    expect(() =>
      projectIdentity(withAnswer(record, "decision", { confidence: 1.4 }), spec),
    ).toThrow(/decision\.confidence must be in \[0, 1\]/);
  });

  test("an identity field match below zero is rejected", async () => {
    const record = await identityRecord();
    expect(() => projectIdentity(withAnswer(record, "same_name", { noul: -0.1 }), spec)).toThrow(
      /name\.noul must be in \[0, 1\]/,
    );
  });

  test("an event confidence above one is rejected", async () => {
    const record = await claimRecord();
    expect(() => projectClaim(withAnswer(record, "event_kind", { confidence: 1.4 }), spec)).toThrow(
      /event_kind\.confidence must be in \[0, 1\]/,
    );
  });

  test("a dimension confidence above one is rejected", async () => {
    const record = await claimRecord();
    expect(() => projectClaim(withAnswer(record, "difficulty", { confidence: 2 }), spec)).toThrow(
      /difficulty\.confidence must be in \[0, 1\]/,
    );
  });

  test("a probability outside the unit interval is rejected", async () => {
    const record = await claimRecord();
    const broken = withAnswer(record, "ownership", { probabilities: [0, 0, 0, 1.2, 0] });
    expect(() => projectClaim(broken, spec)).toThrow(
      /ownership\.probabilities\[3\] must be in \[0, 1\]/,
    );
  });

  test("a score past the rubric's top level is rejected, not capped", async () => {
    const record = await claimRecord();
    // The rubric is 0..MAX_LEVEL, so 4.5 is not a very high level: it is a
    // level this rubric does not have, and `careerEvidenceVector` would
    // normalise it past 1.
    expect(() => projectClaim(withAnswer(record, "originality", { score: 4.5 }), spec)).toThrow(
      /originality\.score must be in \[0, 4\]/,
    );
    expect(() => projectClaim(withAnswer(record, "originality", { score: -0.5 }), spec)).toThrow(
      /originality\.score must be in \[0, 4\]/,
    );
  });

  test("the ends of every range are still accepted", async () => {
    const record = await claimRecord();
    const edged = withAnswer(
      withAnswer(record, "peer_validation", {
        score: MAX_LEVEL,
        confidence: 1,
        probabilities: [0, 0, 0, 0, 1],
      }),
      "external_impact",
      { score: 0, confidence: 0, probabilities: [1, 0, 0, 0, 0] },
    );
    const assessment = projectClaim(edged, spec);
    expect(assessment.dimensions.find((d) => d.dimension === "peer_validation")?.score).toBe(
      MAX_LEVEL,
    );
    expect(assessment.dimensions.find((d) => d.dimension === "external_impact")?.score).toBe(0);
  });
});
