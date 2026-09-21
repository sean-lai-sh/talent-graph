/**
 * Byte-level golden for `processEvidence`.
 *
 * The evidence pipeline is being split into pure stages (#54 T3). This test
 * freezes the pipeline's claim/event output as a committed fixture and
 * byte-compares `JSON.stringify` against it, so a later edit cannot move a
 * status, an event, an id or a fingerprint unnoticed. The fixture pins the
 * post-split output: statuses, events, ids and fingerprints match the pre-split
 * pipeline on these inputs, and the one deliberate difference is that review
 * claims now carry the named `reviewReasons` the split made explicit
 * (`event_low_confidence`, `dimension_low_confidence`) where the old pipeline
 * left the field absent. Dates are serialised as ISO strings so the comparison
 * is textual.
 * The fixture on disk is re-indented by the repository formatter, so it is
 * re-serialised canonically before the comparison: whitespace is the formatter's,
 * every key, value and position in the text is the pipeline's.
 *
 * Regenerate deliberately, never to make a red test green:
 *   LONGITUDINAL_GOLDEN=regenerate bun test tests/longitudinal.golden.test.ts
 * The environment variable only chooses write-vs-assert; the expected values
 * themselves live in the fixture, not in the environment.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GrokEvidenceItem, JevJudgmentService } from "../src/index.ts";
import {
  CAREER_EVIDENCE_V1_0_0,
  processEvidence,
  projectClaim,
  projectIdentity,
} from "../src/index.ts";
import { acceptedAssessment, day, evidence, identity, service, spec } from "./helpers/golden.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "longitudinal-golden.json");

interface GoldenCase {
  name: string;
  judgments: JevJudgmentService;
  evidence: GrokEvidenceItem[];
  baselineAt?: Date;
}

const cases: GoldenCase[] = [
  {
    name: "accepted",
    judgments: service(),
    evidence: [evidence("work", 40)],
  },
  {
    name: "identity-rejected",
    judgments: service({
      async assessIdentity() {
        return {
          decision: "different",
          confidence: 0.97,
          fieldMatches: { name: 0.1, affiliation: 0.1, handle: 0.05 },
        };
      },
    }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "identity-review",
    judgments: service({
      async assessIdentity() {
        return {
          decision: "review",
          confidence: 0.55,
          fieldMatches: { name: 0.6, affiliation: 0.5, handle: 0.4 },
        };
      },
    }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "identity-low-confidence-same",
    judgments: service({
      async assessIdentity() {
        return {
          decision: "same",
          confidence: 0.6,
          fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
        };
      },
    }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "identity-contradictory-fields",
    judgments: service({
      async assessIdentity() {
        return {
          decision: "same",
          confidence: 0.98,
          fieldMatches: { name: 0.92, affiliation: 0.04, handle: 0.02 },
        };
      },
    }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "event-low-confidence",
    judgments: service({}, { ...acceptedAssessment, eventConfidence: 0.4 }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "dimension-low-confidence",
    judgments: service(
      {},
      {
        ...acceptedAssessment,
        dimensions: acceptedAssessment.dimensions.map((judgment, index) =>
          index === 0 ? { ...judgment, confidence: 0.2 } : judgment,
        ),
      },
    ),
    evidence: [evidence("work", 40)],
  },
  {
    name: "empty-dimensions",
    judgments: service({}, { ...acceptedAssessment, dimensions: [] }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "no-assessed-event-kind",
    judgments: service({}, { ...acceptedAssessment, eventKind: null }),
    evidence: [evidence("work", 40)],
  },
  {
    name: "cutoff-and-baseline-filtering",
    judgments: service(),
    baselineAt: day(20),
    evidence: [
      evidence("after-cutoff", 91),
      evidence("second", 60),
      evidence("before-baseline", 10),
      evidence("first", 40),
      evidence("at-cutoff", 90),
    ],
  },
];

/** Dates are the only non-JSON value in the result; ISO keeps it textual. */
function isoDates(_key: string, value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

async function runAll(): Promise<string> {
  const output: Record<string, unknown> = {};
  for (const item of cases) {
    // The judgment records the run collected are deliberately not pinned here:
    // they carry an observation time and a fake responded model, and what this
    // golden locks is the *derivation* — the claims, events, snapshot and
    // review flag. `tests/longitudinal.records.test.ts` pins the records.
    const { records: _records, ...derived } = await processEvidence({
      identity,
      evidence: item.evidence,
      ...(item.baselineAt === undefined ? {} : { baselineAt: item.baselineAt }),
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: item.judgments,
      spec,
    });
    output[item.name] = derived;
  }
  return `${JSON.stringify(output, isoDates, 2)}\n`;
}

/**
 * The harness must not invent a number either.
 *
 * The adapter's assessments are projections of its records (#54 T6); the fake
 * above has to hold to the same invariant, or a case could pass here while the
 * record behind it says something else — an absent dimension quietly becoming
 * a zero-score one, for instance, which is exactly the missing≠low failure the
 * pipeline is built to avoid.
 */
describe("longitudinal golden: the fake service is honest about its records", () => {
  test("every record the fake returns projects to the assessment it returned", async () => {
    for (const item of cases) {
      const evidenceItem = item.evidence[0] as GrokEvidenceItem;
      const judged = await item.judgments.assessIdentity(identity, evidenceItem);
      expect(projectIdentity(judged.record, CAREER_EVIDENCE_V1_0_0), item.name).toEqual(
        judged.assessment,
      );
      const claimed = await item.judgments.assessClaim(evidenceItem, identity.personId);
      expect(projectClaim(claimed.record, CAREER_EVIDENCE_V1_0_0), item.name).toEqual(
        claimed.assessment,
      );
    }
  });
});

describe("longitudinal golden: processEvidence output", () => {
  test("claims, events, snapshot and needsReview are byte-identical to the fixture", async () => {
    const actual = await runAll();
    if (process.env.LONGITUDINAL_GOLDEN === "regenerate") {
      writeFileSync(FIXTURE, actual);
    }
    const stored: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(actual).toBe(`${JSON.stringify(stored, null, 2)}\n`);
  });
});
