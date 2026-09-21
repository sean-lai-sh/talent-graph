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
import type {
  CanonicalIdentity,
  ClaimAssessment,
  GrokEvidenceItem,
  JevJudgmentService,
} from "../src/index.ts";
import { contentFingerprint, processEvidence } from "../src/index.ts";
import type { EvidencePipelinePolicy } from "../src/longitudinal/pipeline.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "longitudinal-golden.json");

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

/**
 * Stated in full rather than read from `DEFAULT_EVIDENCE_POLICY` or any spec
 * loader: the numbers this golden pins must not move when a default does.
 */
const policy: EvidencePipelinePolicy = {
  identityConfidence: 0.75,
  identityContradiction: 0.25,
  eventConfidence: 0.65,
  dimensionConfidence: 0.5,
  questionVersion: "career-evidence@1.0.0",
  model: "jev",
};

const identity: CanonicalIdentity = {
  personId: "p-1",
  name: "Avery Chen",
  aliases: [],
  externalIdentities: [
    {
      source: "github",
      externalId: "avery",
      url: "https://github.com/avery",
      verifiedAt: day(0),
    },
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

const acceptedAssessment: ClaimAssessment = {
  eventKind: "open_source_contribution",
  eventConfidence: 0.92,
  dimensions: [
    { dimension: "difficulty", score: 3, probabilities: [0, 0, 0.2, 0.8, 0], confidence: 0.8 },
    { dimension: "ownership", score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 1 },
    { dimension: "external_impact", score: 2, probabilities: [0, 0, 1, 0, 0], confidence: 1 },
    { dimension: "originality", score: 3, probabilities: [0, 0, 0, 1, 0], confidence: 1 },
    { dimension: "peer_validation", score: 2, probabilities: [0, 0, 1, 0, 0], confidence: 1 },
  ],
};

const sameIdentity = {
  decision: "same" as const,
  confidence: 0.98,
  fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
};

function service(
  overrides: Partial<JevJudgmentService> = {},
  assessment: ClaimAssessment = acceptedAssessment,
): JevJudgmentService {
  return {
    async assessIdentity() {
      return sameIdentity;
    },
    async assessClaim() {
      return structuredClone(assessment);
    },
    ...overrides,
  };
}

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
    output[item.name] = await processEvidence({
      identity,
      evidence: item.evidence,
      ...(item.baselineAt === undefined ? {} : { baselineAt: item.baselineAt }),
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: item.judgments,
      policy,
    });
  }
  return `${JSON.stringify(output, isoDates, 2)}\n`;
}

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
