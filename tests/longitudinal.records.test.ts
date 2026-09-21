/**
 * Judgment records are the raw observation (#54 T6).
 *
 * The Jev adapter no longer returns a bare assessment: it returns the
 * `JevJudgmentRecord` it read off the wire (responded model, usage, request
 * id, un-rounded scores, full probability vectors) together with the
 * assessment, which is a pure projection of that record. Everything below is
 * a consequence of that one move:
 *
 *   - a populated store answers a repeated run with zero SDK calls;
 *   - a thresholds-only spec change re-derives from the stored records with
 *     zero SDK calls and a different `ModelRun` id;
 *   - a record is frozen and append-only;
 *   - `respondedModel` is kept verbatim, never normalised to the requested one;
 *   - probability vectors are indexed off `spec.levels`, not key order;
 *   - a record whose answers do not match the spec's questions is rejected.
 *
 * Every spec here is explicit: the registered constant, or a spread of it with
 * one field changed. Nothing reads `process.env`.
 */

import { describe, expect, test } from "bun:test";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { CAREER_EVIDENCE_DIMENSIONS } from "../src/longitudinal/dimensions.ts";
import type { DeriveEvidenceInput } from "../src/longitudinal/pipeline.ts";
import { processEvidence } from "../src/longitudinal/pipeline.ts";
import { contentFingerprint } from "../src/longitudinal/provenance.ts";
import {
  InMemoryJevJudgmentStore,
  type JevAnswer,
  type JevJudgmentRecord,
  type JevJudgmentStore,
  type JevRawScoreAnswer,
  projectClaim,
  projectIdentity,
} from "../src/longitudinal/records.ts";
import { runCareerEvidence } from "../src/longitudinal/run.ts";
import type { CanonicalIdentity, GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0, careerEvidenceSpecId } from "../src/models/careerEvidence.ts";
import type { CareerEvidenceSpec } from "../src/models/spec.ts";

const spec = CAREER_EVIDENCE_V1_0_0;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

/**
 * The same rubric with different gate thresholds, as a *test* fixture: a spec
 * version that is not registered and never ships, so the re-derivation below
 * cannot be confused with a released rubric change.
 */
const STRICTER: CareerEvidenceSpec = {
  ...spec,
  version: "1.0.1+test",
  thresholds: { ...spec.thresholds, dimensionConfidence: 0.9 },
};

const identity: CanonicalIdentity = {
  personId: "p-1",
  name: "Avery Chen",
  aliases: [],
  externalIdentities: [
    { source: "github", externalId: "avery", url: "https://github.com/avery", verifiedAt: day(0) },
  ],
  createdAt: day(0),
  updatedAt: day(0),
};

function evidence(id: string, observedDay: number): GrokEvidenceItem {
  return {
    source: "github",
    sourceId: id,
    url: `https://github.com/avery/${id}`,
    publisher: "avery",
    publishedAt: day(observedDay).toISOString(),
    quotedText: `Released ${id} with implementation details.`,
    contentHash: contentFingerprint(id),
    statement: `Avery released ${id}.`,
    proposedEventKind: "open_source_contribution",
  };
}

const items = [evidence("work", 40), evidence("more", 50)];

/** A score answer as the SDK sends one: keyed by level, plus the legend. */
function scoreAnswer(
  score: number,
  confidence: number,
  probabilities: Record<string, number>,
  dimension: (typeof CAREER_EVIDENCE_DIMENSIONS)[number],
): Record<string, unknown> {
  return {
    type: "score",
    score,
    confidence,
    probabilities,
    legend: Object.fromEntries(spec.levels[dimension].map((text, index) => [index, text])),
  };
}

interface FakeClientOptions {
  /** What the API reports having answered with; the adapter must keep it. */
  model?: string;
  requestId?: string | undefined;
  /** Per-dimension score, so a fractional score can be asserted un-rounded. */
  score?: number;
  /** Probability keys in a deliberately scrambled order. */
  scrambleProbabilityKeys?: boolean;
}

/** A TypeSafe client whose `systemOne(...).withResponse()` counts its calls. */
function fakeClient(options: FakeClientOptions = {}): {
  client: Parameters<typeof createJevJudgmentService>[0];
  calls: () => number;
} {
  let calls = 0;
  const score = options.score ?? 3;
  const straight = { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 } as Record<string, number>;
  const scrambled = { 3: 0.8, 0: 0, 4: 0, 2: 0.2, 1: 0 } as Record<string, number>;
  const probabilities = options.scrambleProbabilityKeys ? scrambled : straight;
  const client = {
    systemOne(request: { questions: Record<string, unknown> }) {
      const data = {
        model: options.model ?? "jev-2026-01",
        usage: { input_tokens: 120, output_tokens: 34 },
        answers:
          "decision" in request.questions
            ? {
                decision: {
                  type: "choice",
                  choice: "same",
                  confidence: 0.98,
                  probabilities: { same: 0.98, review: 0.015, different: 0.005 },
                },
                same_name: { type: "noul", noul: 0.99 },
                same_affiliation: { type: "noul", noul: 0.8 },
                same_handle: { type: "noul", noul: 1 },
              }
            : {
                event_kind: {
                  type: "choice",
                  choice: "open_source_contribution",
                  confidence: 0.92,
                  probabilities: { open_source_contribution: 0.92, no_supported_event: 0.08 },
                },
                ...Object.fromEntries(
                  CAREER_EVIDENCE_DIMENSIONS.map((dimension) => [
                    dimension,
                    scoreAnswer(score, 0.8, probabilities, dimension),
                  ]),
                ),
              },
      };
      return {
        async withResponse() {
          calls += 1;
          return { data, response: new Response(null), requestId: options.requestId };
        },
      };
    },
  };
  return {
    client: client as unknown as Parameters<typeof createJevJudgmentService>[0],
    calls: () => calls,
  };
}

const run = (
  judgments: ReturnType<typeof createJevJudgmentService>,
  store?: InMemoryJevJudgmentStore,
  used: CareerEvidenceSpec = spec,
) =>
  processEvidence({
    identity,
    evidence: items,
    cutoffAt: day(90),
    retrievedAt: day(100),
    pipelineVersion: "1",
    judgments,
    spec: used,
    ...(store === undefined ? {} : { runtime: { store } }),
  });

/** Dates are the only non-JSON value; ISO keeps the comparison textual. */
const isoDates = (_key: string, value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : value;

describe("judgment records: the store answers a repeated run", () => {
  test("a second run over identical evidence issues zero SDK calls", async () => {
    const store = new InMemoryJevJudgmentStore();
    const first = fakeClient();
    const firstResult = await run(createJevJudgmentService(first.client, spec), store);
    expect(first.calls()).toBe(4); // two items, identity + claim each
    expect(firstResult.records).toHaveLength(4);

    const second = fakeClient();
    const secondResult = await run(createJevJudgmentService(second.client, spec), store);
    expect(second.calls()).toBe(0);
    expect(JSON.stringify(secondResult.claims, isoDates)).toBe(
      JSON.stringify(firstResult.claims, isoDates),
    );
    expect(JSON.stringify(secondResult.events, isoDates)).toBe(
      JSON.stringify(firstResult.events, isoDates),
    );
    expect(secondResult.records).toEqual(firstResult.records);
  });

  test("the records are the ones stored, in evaluation order", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec), store);
    expect(result.records.map((record) => record.kind)).toEqual([
      "identity",
      "claim",
      "identity",
      "claim",
    ]);
    // Evaluation order is the eligible order: oldest first.
    expect(result.records.map((record) => record.evidenceKey.split("|")[1])).toEqual([
      "work",
      "work",
      "more",
      "more",
    ]);
    for (const record of result.records) {
      expect(await store.get(record.id)).toEqual(record);
    }
  });
});

describe("judgment records: a spec bump re-derives without re-billing", () => {
  test("changing only thresholds re-derives from the records with zero SDK calls", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec), store);
    const callsAfterJudging = client.calls();

    const derivation = {
      identity,
      evidence: items,
      records: result.records,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
    };
    const asShipped = runCareerEvidence(derivation, { spec, now: day(100) });
    const stricter = runCareerEvidence(derivation, { spec: STRICTER, now: day(100) });

    expect(client.calls()).toBe(callsAfterJudging);
    expect(stricter.id).not.toBe(asShipped.id);
    // Only the parameters moved: the observations are the same records.
    expect(stricter.inputHash).toBe(asShipped.inputHash);
    expect(stricter.parameters.spec).toEqual(STRICTER);
    expect(asShipped.parameters.spec).toEqual(spec);
    // The stricter gate is what the re-derivation is for: 0.8 < 0.9.
    expect(asShipped.outputs.claims.every((claim) => claim.status === "accepted")).toBe(true);
    expect(stricter.outputs.claims.every((claim) => claim.status === "review")).toBe(true);
    expect(result.records).toEqual(derivation.records);
  });

  test("the derivation reproduces the pipeline's own claims and events byte-for-byte", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const derived = runCareerEvidence(
      {
        identity,
        evidence: items,
        records: result.records,
        cutoffAt: day(90),
        retrievedAt: day(100),
        pipelineVersion: "1",
      },
      { spec, now: day(100) },
    );
    expect(JSON.stringify(derived.outputs.claims, isoDates)).toBe(
      JSON.stringify(result.claims, isoDates),
    );
    expect(JSON.stringify(derived.outputs.events, isoDates)).toBe(
      JSON.stringify(result.events, isoDates),
    );
    expect(JSON.stringify(derived.outputs.snapshot, isoDates)).toBe(
      JSON.stringify(result.snapshot, isoDates),
    );
  });

  test("the run id is over the sorted record ids and carries the full spec", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const input = {
      identity,
      evidence: items,
      records: result.records,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
    };
    const straight = runCareerEvidence(input, { spec, now: day(100) });
    const shuffled = runCareerEvidence(
      { ...input, records: [...result.records].reverse() },
      { spec, now: day(100) },
    );
    expect(shuffled.inputHash).toBe(straight.inputHash);
    expect(straight.kind).toBe("career_evidence");
    expect(straight.specVersion).toBe("1.0.0");
    expect(straight.upstreamRuns).toEqual([]);
    expect(straight.id).toMatch(
      /^career_evidence\/career_evidence_v1@1\.0\.0:[0-9a-f]{12}:[0-9a-f]{8}$/,
    );
  });
});

describe("judgment records: a cache hit belongs to the evidence it was asked about", () => {
  /** The same person, name and evidence bytes — only the person id differs. */
  const other: CanonicalIdentity = { ...identity, personId: "p-2" };

  const runFor = (
    who: CanonicalIdentity,
    judgments: ReturnType<typeof createJevJudgmentService>,
    store: InMemoryJevJudgmentStore,
  ) =>
    processEvidence({
      identity: who,
      evidence: items,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      spec,
      runtime: { store },
    });

  test("two people with identical evidence never share a judgment record", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);

    const first = await runFor(identity, service, store);
    expect(client.calls()).toBe(4);
    // The request is byte-identical for the second person — the person id is
    // never sent — so only the record's evidence key keeps the two apart.
    const second = await runFor(other, service, store);
    expect(client.calls()).toBe(8);
    const again = await runFor(identity, service, store);
    expect(client.calls()).toBe(8);

    for (const record of first.records) {
      expect(record.personId).toBe("p-1");
      expect(record.evidenceKey.startsWith("p-1|")).toBe(true);
    }
    for (const record of second.records) {
      expect(record.personId).toBe("p-2");
      expect(record.evidenceKey.startsWith("p-2|")).toBe(true);
    }
    expect(new Set(second.records.map((record) => record.id)).size).toBe(4);
    expect(
      first.records.some((record) => second.records.some((other) => other.id === record.id)),
    ).toBe(false);
    expect(again.records).toEqual(first.records);

    // Each person's records derive on their own: a record addressed only by
    // request fingerprint would have handed the second person the first
    // person's observation, and this derivation would not find its own.
    for (const result of [first, second]) {
      const derived = runCareerEvidence(
        {
          identity: result === first ? identity : other,
          evidence: items,
          records: result.records,
          cutoffAt: day(90),
          retrievedAt: day(100),
          pipelineVersion: "1",
        },
        { spec, now: day(100) },
      );
      expect(JSON.stringify(derived.outputs.claims, isoDates)).toBe(
        JSON.stringify(result.claims, isoDates),
      );
    }
  });

  test("a stored record for other evidence is never served for this request", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    const result = await runFor(identity, service, store);
    const record = result.records[0] as JevJudgmentRecord;
    // The address is the record's id, which carries both the request
    // fingerprint and the evidence key; the fingerprint alone addresses
    // nothing.
    expect(await store.get(record.id)).toEqual(record);
    expect(await store.get(record.requestFingerprint)).toBe(null);
  });
});

describe("judgment records: a cache hit must carry the rubric it is read under", () => {
  /** A store that answers with a record stamped under someone else's rubric. */
  function restampingStore(honest: InMemoryJevJudgmentStore, specId: string): JevJudgmentStore {
    return {
      async get(recordId) {
        const record = await honest.get(recordId);
        return record === null ? null : { ...record, specId };
      },
      async put(record) {
        await honest.put(record);
      },
    };
  }

  const runWith = (
    store: JevJudgmentStore,
    judgments: ReturnType<typeof createJevJudgmentService>,
  ) =>
    processEvidence({
      identity,
      evidence: items,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      spec,
      runtime: { store },
    });

  test("a record at the right address but under a foreign rubric is rejected by name", async () => {
    const honest = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    await runWith(honest, service);
    expect(client.calls()).toBe(4);

    // Everything the address check looks at is right; only the rubric the
    // record answers is another one. Reading it under this spec would be
    // reading an answer to a different question.
    const foreign = restampingStore(honest, "career_evidence@1.0.0:deadbeef");
    await expect(runWith(foreign, service)).rejects.toThrow(/deadbeef/);
  });

  test("the honest record is still served, and a thresholds-only rubric match stays a hit", async () => {
    const honest = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    const first = await runWith(honest, service);
    expect(client.calls()).toBe(4);
    // Same rubric hash, restamped with the version a thresholds-only bump
    // carries: still the same questions, so still a hit and no new call.
    const bumped = restampingStore(honest, careerEvidenceSpecId(STRICTER));
    const second = await runWith(bumped, service);
    expect(client.calls()).toBe(4);
    expect(JSON.stringify(second.claims, isoDates)).toBe(JSON.stringify(first.claims, isoDates));
  });
});

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

describe("judgment records: a derivation checks the rubric it is reading", () => {
  test("a record stamped with a different rubric hash is rejected by name", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const restamped = result.records.map((record) => ({
      ...record,
      specId: "career_evidence@1.0.0:deadbeef",
    }));
    expect(() =>
      runCareerEvidence(
        {
          identity,
          evidence: items,
          records: restamped,
          cutoffAt: day(90),
          retrievedAt: day(100),
          pipelineVersion: "1",
        },
        { spec, now: day(100) },
      ),
    ).toThrow(/deadbeef/);
  });

  test("the same rubric under a new version still derives, so a bump stays free", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const derived = runCareerEvidence(
      {
        identity,
        evidence: items,
        records: result.records,
        cutoffAt: day(90),
        retrievedAt: day(100),
        pipelineVersion: "1",
      },
      { spec: STRICTER, now: day(100) },
    );
    // Only the thresholds moved: the rubric hash is the one the records carry.
    expect(careerEvidenceSpecId(STRICTER).split(":")[1]).toBe(
      careerEvidenceSpecId(spec).split(":")[1],
    );
    expect(derived.outputs.claims).toHaveLength(2);
  });
});

describe("judgment records: append-only and frozen", () => {
  test("a record is deeply frozen", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const record = result.records[0] as JevJudgmentRecord;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.answers)).toBe(true);
    expect(Object.isFrozen(record.usage)).toBe(true);
    expect(Object.isFrozen(record.answers.decision)).toBe(true);
    expect(() => {
      (record as { personId: string }).personId = "p-2";
    }).toThrow(TypeError);
    const claim = result.records[1] as JevJudgmentRecord;
    const difficulty = claim.answers.difficulty as { probabilities: number[]; legend: string[] };
    expect(Object.isFrozen(difficulty.probabilities)).toBe(true);
    expect(Object.isFrozen(difficulty.legend)).toBe(true);
    expect(() => {
      (difficulty.probabilities as number[])[0] = 1;
    }).toThrow(TypeError);
  });

  test("the observation time cannot be moved after the record is written", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const record = result.records[0] as JevJudgmentRecord;
    const before = JSON.stringify(record);
    // A Date is mutable even inside a frozen object — `Object.isFrozen` is
    // true of it while `setTime` still moves the value — so the record keeps
    // the observation time as the ISO string a store would persist. There is
    // nothing left to mutate, and the assignment a holder could try throws.
    expect(typeof record.observedAt).toBe("string");
    expect(record.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    (record.observedAt as unknown as { setTime?: (value: number) => void }).setTime?.(0);
    expect(() => {
      (record as { observedAt: string }).observedAt = "1970-01-01T00:00:00.000Z";
    }).toThrow(TypeError);
    expect(JSON.stringify(record)).toBe(before);
  });

  test("a record whose id is not its own address is rejected on put", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const record = result.records[0] as JevJudgmentRecord;
    // The honest record writes and reads back.
    await store.put(record);
    expect(await store.get(record.id)).toEqual(record);
    // A record whose id does not derive from its own fingerprint and evidence
    // key would be written where nothing looks for it — a silent miss for
    // every later run. It is refused at the write, by name.
    const misfiled = { ...record, id: `jev-${record.requestFingerprint}` };
    await expect(store.put(misfiled)).rejects.toThrow(/misfiled/);
    await expect(store.put({ ...record, evidenceKey: "p-9|work|x|y" })).rejects.toThrow(/misfiled/);
    expect(await store.get(misfiled.id)).toBe(null);
  });

  test("a second put of the same fingerprint throws unless the content is identical", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec), store);
    const record = result.records[0] as JevJudgmentRecord;
    // Identical content is a no-op, not an error: a retried write is not a rewrite.
    await store.put(record);
    expect(await store.get(record.id)).toEqual(record);
    const rewritten = { ...record, respondedModel: "jev-2026-02" };
    await expect(store.put(rewritten)).rejects.toThrow(/already recorded/);
    expect((await store.get(record.id))?.respondedModel).toBe(record.respondedModel);
  });
});

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

describe("judgment records: a concurrent miss is paid for once (#54 T7)", () => {
  const duplicated = (id: string) => [evidence(id, 40), { ...evidence(id, 40) }];

  const runOver = (
    judgments: ReturnType<typeof createJevJudgmentService>,
    over: GrokEvidenceItem[],
    store: JevJudgmentStore,
  ) =>
    processEvidence({
      identity,
      evidence: over,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      spec,
      runtime: { store, concurrency: 4 },
    });

  test("two identical items in one batch issue one identity and one claim call", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await runOver(
      createJevJudgmentService(client.client, spec),
      duplicated("work"),
      store,
    );
    // One question asked once, not twice — and the append-only store is never
    // handed a second write of the same observation.
    expect(client.calls()).toBe(2);
    expect(store.size).toBe(2);
    expect(result.claims).toHaveLength(2);
    expect(JSON.stringify(result.claims[0], isoDates)).toBe(
      JSON.stringify(result.claims[1], isoDates),
    );
    expect(new Set(result.records.map((record) => record.id)).size).toBe(2);
  });

  test("two concurrent runs over one store pay for one judgment each", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    const [left, right] = await Promise.all([
      runOver(service, [evidence("work", 40)], store),
      runOver(service, [evidence("work", 40)], store),
    ]);
    expect(client.calls()).toBe(2);
    expect(store.size).toBe(2);
    expect(JSON.stringify(left?.claims, isoDates)).toBe(JSON.stringify(right?.claims, isoDates));
  });

  test("a put that loses a race reads the recorded judgment back instead of failing", async () => {
    const honest = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    // Pre-load the store with the records another worker already wrote, then
    // hide them from the first `get` of this run: the run misses, judges, and
    // its `put` collides with the record that was there all along.
    const seeded = await runOver(service, [evidence("work", 40)], honest);
    const recorded = new Map(seeded.records.map((record) => [record.id, record]));
    const hidden = new Set(recorded.keys());
    const racing: JevJudgmentStore = {
      async get(recordId) {
        if (hidden.delete(recordId)) return null;
        return honest.get(recordId);
      },
      async put(record) {
        // The append-only store refuses the second, different answer.
        await honest.put({ ...record, respondedModel: `${record.respondedModel}-other` });
      },
    };
    const raced = await runOver(service, [evidence("work", 40)], racing);
    // The recorded observation wins, and the batch does not fail.
    expect(raced.records.map((record) => record.id)).toEqual([...recorded.keys()]);
    expect(raced.records).toEqual(seeded.records);
    expect(JSON.stringify(raced.claims, isoDates)).toBe(JSON.stringify(seeded.claims, isoDates));
  });
});

/** The fake client above, wrapped so the per-call options are observable. */
function capturingClient(): {
  client: Parameters<typeof createJevJudgmentService>[0];
  signals: () => (AbortSignal | undefined)[];
} {
  const inner = fakeClient();
  const seen: (AbortSignal | undefined)[] = [];
  const delegate = inner.client as unknown as {
    systemOne(request: { questions: Record<string, unknown> }): {
      withResponse(): Promise<unknown>;
    };
  };
  const client = {
    systemOne(request: { questions: Record<string, unknown> }, options?: { signal?: AbortSignal }) {
      seen.push(options?.signal);
      return delegate.systemOne(request);
    },
  };
  return {
    client: client as unknown as Parameters<typeof createJevJudgmentService>[0],
    signals: () => [...seen],
  };
}

describe("judgment records: the caller's signal reaches the transport (#54 T7)", () => {
  const runWithRuntime = (
    client: Parameters<typeof createJevJudgmentService>[0],
    signal?: AbortSignal,
  ) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: createJevJudgmentService(client, spec),
      spec,
      ...(signal === undefined ? {} : { runtime: { signal } }),
    });

  test("the adapter forwards the pipeline's signal to every request it makes", async () => {
    const capturing = capturingClient();
    const controller = new AbortController();
    await runWithRuntime(capturing.client, controller.signal);
    expect(capturing.signals()).toEqual([controller.signal, controller.signal]);
  });

  test("no signal means no signal: the adapter sends none of its own", async () => {
    const capturing = capturingClient();
    await runWithRuntime(capturing.client);
    expect(capturing.signals()).toEqual([undefined, undefined]);
  });
});
