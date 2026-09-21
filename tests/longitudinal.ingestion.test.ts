/**
 * The ingestion boundary: what an external packet is allowed to say.
 *
 * Everything here is about values that arrive from outside — a Grok callback
 * can hand us any string — and about refusing the ones this pipeline cannot
 * represent at the point they arrive, with the offending field named, rather
 * than admitting them and failing several stages later.
 */

import { describe, expect, test } from "bun:test";
import type { GrokEvidenceItem, GrokEvidencePacket } from "../src/index.ts";
import {
  EVIDENCE_KEY_SEPARATOR,
  evidenceKeyFor,
  JudgmentInvariantError,
  processEvidence,
  validateGrokEvidencePacket,
} from "../src/index.ts";
import { acceptingJudgments, day, identity, serviceOf } from "./helpers/longitudinal.ts";

/**
 * A delimiter-bearing id is refused where the packet arrives, not where the
 * key is built.
 *
 * `evidenceKeyFor` joins `personId | sourceId | publishedAt | contentHash` on
 * `EVIDENCE_KEY_SEPARATOR` and refuses a component that carries one. That
 * refusal is a `JudgmentInvariantError`, which is deliberately fatal to a
 * whole batch — it means a bug in this code or in a store. But a `sourceId`
 * comes from a Grok callback, which can say anything, and an external value we
 * cannot represent is not a bug in this code: admitting it and detonating the
 * run nine stages later turns one bad item into a lost batch. So the packet
 * validator rejects the item on its own, naming the field, and the check in
 * `evidenceKeyFor` stays as the last line of defence for anything that reaches
 * it by another road.
 */
describe("longitudinal ingestion: an id that cannot be part of an evidence key", () => {
  const item = (over: Partial<GrokEvidencePacket["items"][number]> = {}) => ({
    source: "github" as const,
    sourceId: "work",
    url: "https://github.com/avery/work",
    publisher: "avery",
    publishedAt: day(40).toISOString(),
    quotedText: "Released work with implementation details.",
    contentHash: "acdee04657db4e17",
    statement: "Avery released work.",
    proposedEventKind: "open_source_contribution" as const,
    ...over,
  });

  const packetOf = (
    over: Partial<GrokEvidencePacket["items"][number]> = {},
    personId = "p-1",
  ): GrokEvidencePacket => ({
    schemaVersion: "1",
    personId,
    runId: "run-1",
    retrievedAt: day(100).toISOString(),
    cutoffAt: day(90).toISOString(),
    items: [item(over)],
  });

  const errorsOf = (packet: GrokEvidencePacket): string[] => {
    const result = validateGrokEvidencePacket(packet);
    return result.ok ? [] : result.errors;
  };

  test("the same packet without a separator anywhere is valid", () => {
    expect(validateGrokEvidencePacket(packetOf())).toEqual({ ok: true });
  });

  test("a sourceId carrying the separator is refused, by field name", () => {
    expect(errorsOf(packetOf({ sourceId: "a|b" }))).toEqual([
      `items[0].sourceId must not contain "${EVIDENCE_KEY_SEPARATOR}"`,
    ]);
  });

  test("a contentHash carrying the separator is refused, by field name", () => {
    expect(errorsOf(packetOf({ contentHash: "de|ad" }))).toEqual([
      `items[0].contentHash must not contain "${EVIDENCE_KEY_SEPARATOR}"`,
    ]);
  });

  test("a personId carrying the separator is refused, by field name", () => {
    expect(errorsOf(packetOf({}, "p|1"))).toEqual([
      `personId must not contain "${EVIDENCE_KEY_SEPARATOR}"`,
    ]);
  });

  test("a claimed item never reaches evidenceKeyFor carrying a separator", async () => {
    // What the boundary buys: every item the validator admits builds a key
    // without throwing, so the batch-fatal refusal downstream is unreachable
    // from this road. The item below is the one the validator rejected.
    const admitted = packetOf();
    expect(validateGrokEvidencePacket(admitted)).toEqual({ ok: true });
    for (const candidate of admitted.items) {
      expect(() => evidenceKeyFor(admitted.personId, candidate)).not.toThrow();
    }
    const refused = packetOf({ sourceId: "a|b" });
    expect(validateGrokEvidencePacket(refused).ok).toBe(false);
    // And it would indeed have detonated: the last line of defence is still there.
    expect(() => evidenceKeyFor(refused.personId, refused.items[0] as GrokEvidenceItem)).toThrow(
      JudgmentInvariantError,
    );

    // End to end: the admitted item runs, the refused one never gets to.
    const result = await processEvidence({
      identity,
      evidence: [...admitted.items],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(acceptingJudgments),
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.status).toBe("accepted");
  });
});
