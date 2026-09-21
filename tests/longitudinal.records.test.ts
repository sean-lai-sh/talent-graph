/**
 * Judgment records are the raw observation (#54 T6): what a repeated run and a
 * thresholds-only spec bump cost.
 *
 * The Jev adapter returns the `JevJudgmentRecord` it read off the wire together
 * with the assessment, which is a pure projection of that record. A populated
 * store therefore answers a repeated run with zero SDK calls, and a rubric
 * whose *thresholds* moved re-derives from the stored records with zero SDK
 * calls and a different `ModelRun` id.
 */

import { describe, expect, test } from "bun:test";
import type { JevClient } from "../apps/club/lib/longitudinal/jev.ts";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { processEvidence } from "../src/longitudinal/pipeline.ts";
import { runCareerEvidence } from "../src/longitudinal/run.ts";
import { InMemoryJevJudgmentStore } from "../src/longitudinal/store.ts";
import type { CanonicalIdentity } from "../src/longitudinal/types.ts";
import { careerEvidenceSpecId } from "../src/models/careerEvidence.ts";
import {
  day,
  fakeClient,
  identity,
  isoDates,
  items,
  run,
  STRICTER,
  spec,
} from "./helpers/records.ts";

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

describe("judgment records: a derivation finds its own person's records", () => {
  /** The same person, name and evidence bytes — only the person id differs. */
  const other: CanonicalIdentity = { ...identity, personId: "p-2" };

  const runFor = (who: CanonicalIdentity, store: InMemoryJevJudgmentStore, client: JevClient) =>
    processEvidence({
      identity: who,
      evidence: items,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: createJevJudgmentService(client, spec),
      spec,
      runtime: { store },
    });

  test("two people's records derive separately, each reproducing its own claims", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    // The request is byte-identical for the second person — the person id is
    // never sent — so only the record's evidence key keeps the two apart. A
    // record addressed only by request fingerprint would have handed the
    // second person the first person's observation, and this derivation would
    // not find its own.
    const first = await runFor(identity, store, client.client);
    const second = await runFor(other, store, client.client);
    for (const [who, result] of [
      [identity, first],
      [other, second],
    ] as const) {
      const derived = runCareerEvidence(
        {
          identity: who,
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
});
