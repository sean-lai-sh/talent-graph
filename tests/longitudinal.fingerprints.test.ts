/**
 * Digest lock for `contentFingerprint`.
 *
 * #54 T4 replaces the private serializer inside `src/longitudinal/provenance.ts`
 * with the shared `stableStringify` from `src/provenance/hash.ts`, so that the
 * repository has one serializer rather than two that disagree about `Date`,
 * `Map` and `Set`. The digest itself must not move: claim ids, career-event ids
 * and snapshot `contentHash`es are derived from it, and the Club adapter uses it
 * for the Grok/GitHub/ORCID dedupe key.
 *
 * The fixture values are the pre-#54-T4 digests (recorded with the private
 * serializer, before the swap); this test asserts they are unchanged under
 * `stableStringify`, and after merge it is the ongoing lock on those ids.
 * Every input below is one the pipeline actually hashes today:
 *   - claim-id inputs      `src/longitudinal/stages.ts` (`materialize`)
 *   - event-id inputs      `src/longitudinal/stages.ts` (`materialize`)
 *   - snapshot-hash inputs `src/longitudinal/pipeline.ts` (`processEvidence`)
 *   - adapter `raw` values `apps/club/lib/longitudinal/sources.ts` (`item`)
 * The first three are read back out of the T3 golden fixture, so the recorded
 * digests are cross-checked against the ids the pipeline really emitted.
 *
 * The SHA-256 side of the shared module is pinned separately and independently
 * by `tests/provenance.test.ts` against `tests/fixtures/run-ids-golden.json`
 * ("hashInputs output unchanged for every existing fixture"); this file is the
 * longitudinal half of that guarantee.
 *
 * Nothing here reads `process.env`: the expected values live in the fixture.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentFingerprint } from "../src/longitudinal/provenance.ts";

const GOLDEN = join(import.meta.dir, "fixtures", "longitudinal-golden.json");
const FIXTURE = join(import.meta.dir, "fixtures", "longitudinal-fingerprints.json");

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

interface GoldenClaim {
  id: string;
  personId: string;
  status: string;
  provenance: { sourceId: string; publishedAt: string; contentHash: string };
}
interface GoldenEvent {
  id: string;
  kind: string;
  evidenceClaimIds: string[];
}
interface GoldenCase {
  claims: GoldenClaim[];
  events: GoldenEvent[];
  snapshot: { personId: string; cutoffAt: string; contentHash: string; pipelineVersion: string };
}

const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, GoldenCase>;

/** One value the pipeline hands to `contentFingerprint`, with where it comes from. */
interface HashedInput {
  label: string;
  value: unknown;
  /** The id the pipeline built from this digest, when there is one to check. */
  expectedId?: { prefix: string; id: string };
}

function pipelineInputs(): HashedInput[] {
  const inputs: HashedInput[] = [];
  for (const [name, result] of Object.entries(golden)) {
    for (const claim of result.claims) {
      // The evidence contentHash in the golden is itself contentFingerprint(sourceId):
      // the plain-string call, recorded here as its own input.
      inputs.push({
        label: `${name}/evidence-content-hash/${claim.provenance.sourceId}`,
        value: claim.provenance.sourceId,
        expectedId: { prefix: "", id: claim.provenance.contentHash },
      });
      inputs.push({
        label: `${name}/claim-id/${claim.provenance.sourceId}`,
        value: {
          personId: claim.personId,
          sourceId: claim.provenance.sourceId,
          publishedAt: claim.provenance.publishedAt,
          contentHash: claim.provenance.contentHash,
        },
        expectedId: { prefix: "claim-", id: claim.id },
      });
    }
    for (const event of result.events) {
      inputs.push({
        label: `${name}/event-id/${event.id}`,
        value: { claimId: event.evidenceClaimIds[0], kind: event.kind },
        expectedId: { prefix: "event-", id: event.id },
      });
    }
    inputs.push({
      label: `${name}/snapshot-hash`,
      value: {
        personId: result.snapshot.personId,
        cutoffAt: result.snapshot.cutoffAt,
        claims: result.claims.map((claim) => [claim.id, claim.status]),
        pipelineVersion: result.snapshot.pipelineVersion,
      },
      expectedId: { prefix: "", id: result.snapshot.contentHash },
    });
  }
  return inputs;
}

/**
 * The `raw` payloads the Club adapter fingerprints into `contentHash`, which is
 * then part of the durable Grok dedupe key (`sources.ts`). Copied from the
 * adapter's own tests in `tests/longitudinal.test.ts` so the shapes are the ones
 * GitHub and ORCID really return: parsed JSON, so no `Date`, `Map` or `undefined`.
 */
function adapterInputs(): HashedInput[] {
  return [
    {
      label: "club/github-repo",
      value: {
        full_name: "avery/new-work",
        html_url: "https://github.com/avery/new-work",
        created_at: day(50).toISOString(),
        description: "A difficult compiler.",
        fork: false,
      },
    },
    {
      label: "club/github-repo-nested-null",
      value: {
        full_name: "avery/old-fork",
        html_url: "https://github.com/avery/old-fork",
        created_at: day(50).toISOString(),
        updated_at: day(60).toISOString(),
        description: null,
        fork: true,
        topics: ["compilers", "rust"],
        owner: { login: "avery", id: 7 },
      },
    },
    {
      label: "club/github-event",
      value: {
        id: "event-1",
        type: "ReleaseEvent",
        created_at: day(60).toISOString(),
        repo: { name: "avery/new-work" },
      },
    },
    {
      label: "club/orcid-work-summary",
      value: {
        "put-code": 2,
        title: { title: { value: "Fully dated work" } },
        "publication-date": {
          year: { value: "2026" },
          month: { value: "03" },
          day: { value: "01" },
        },
        url: { value: "https://example.com/work" },
      },
    },
  ];
}

/** Shapes the acceptance criteria name explicitly, pinned at their pre-change digest. */
function acceptanceInputs(): HashedInput[] {
  return [
    { label: "plain/string", value: "work" },
    { label: "plain/empty-string", value: "" },
    { label: "plain/object", value: { a: 1, b: 2 } },
    { label: "plain/nested", value: { b: [1, "two", null, false], a: { z: 0, y: [] } } },
    { label: "plain/array", value: ["a", "b"] },
    { label: "plain/null", value: null },
    { label: "plain/number", value: 1 },
  ];
}

const inputs: HashedInput[] = [...pipelineInputs(), ...adapterInputs(), ...acceptanceInputs()];

const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;

describe("longitudinal fingerprints: contentFingerprint digests are frozen", () => {
  test("every recorded digest still matches, and the fixture covers every input", () => {
    const actual: Record<string, string> = {};
    for (const input of inputs) actual[input.label] = contentFingerprint(input.value);
    expect(actual).toEqual(recorded);
  });

  test("the pipeline ids in the T3 golden are reproduced from the recorded digests", () => {
    for (const input of inputs) {
      if (input.expectedId === undefined) continue;
      expect(`${input.expectedId.prefix}${contentFingerprint(input.value)}`, input.label).toBe(
        input.expectedId.id,
      );
    }
  });

  test("key order does not change the digest", () => {
    expect(contentFingerprint({ a: 1, b: 2 })).toBe(contentFingerprint({ b: 2, a: 1 }));
  });

  test("distinct Dates no longer collide", () => {
    expect(contentFingerprint(new Date(0))).not.toBe(contentFingerprint(new Date(1)));
  });

  test("distinct Maps no longer collide", () => {
    expect(contentFingerprint(new Map([["a", 1]]))).not.toBe(
      contentFingerprint(new Map([["a", 2]])),
    );
  });

  test("distinct Sets no longer collide", () => {
    expect(contentFingerprint(new Set(["a"]))).not.toBe(contentFingerprint(new Set(["b"])));
  });

  test("input with no JSON representation is rejected, not silently fingerprinted", () => {
    expect(() => contentFingerprint(undefined)).toThrow(TypeError);
    expect(() => contentFingerprint(() => 1)).toThrow(TypeError);
    expect(() => contentFingerprint(Symbol("s"))).toThrow(TypeError);
  });
});
