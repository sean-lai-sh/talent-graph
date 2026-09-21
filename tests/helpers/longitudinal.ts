/**
 * The fixtures and fake judgment service the longitudinal suites share.
 *
 * #54 T8 split `tests/longitudinal.test.ts` into one suite per concern. These
 * helpers were its preamble; they live here once rather than in each suite, so
 * a change to the fake service cannot mean one thing in the fan-out tests and
 * another in the monitoring ones.
 *
 * The fake obeys the production invariants it would otherwise be able to break:
 * record ids come from `recordIdFor` over the fingerprint the service itself
 * advertises, so a record is filed where a later lookup asks for it, and a
 * dimension the service did not judge is absent from the record rather than
 * written down as a zero.
 */

import type {
  CanonicalIdentity,
  CareerEvent,
  ClaimAssessment,
  GrokEvidenceItem,
  IdentityAssessment,
  JevAnswer,
  JevJudgmentRecord,
  JevJudgmentService,
} from "../../src/index.ts";
import {
  CAREER_EVIDENCE_V1_0_0,
  careerEvidenceSpecId,
  contentFingerprint,
  evidenceKeyFor,
  freezeRecord,
  recordIdFor,
} from "../../src/index.ts";

export const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

/** Drain the microtask queue. Deterministic: nothing here waits on a clock. */
export const flushTurns = async (turns = 50) => {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
};

export const identity: CanonicalIdentity = {
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

export function evidence(id: string, observedDay: number): GrokEvidenceItem {
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

/**
 * The judgment service the pipeline now expects: an assessment *and* the
 * record it was projected from. The assessments are still the ones the cases
 * below state — the assertions pin those numbers — and the record is the
 * observation they would have come from, so nothing here is a second source
 * of truth for a number.
 */
export interface FakeJudgments {
  assessIdentity(
    identity: CanonicalIdentity,
    evidence: GrokEvidenceItem,
  ): Promise<IdentityAssessment>;
  assessClaim(evidence: GrokEvidenceItem): Promise<ClaimAssessment>;
}

export function identityAnswers(assessment: IdentityAssessment): Record<string, JevAnswer> {
  return {
    decision: {
      choice: assessment.decision,
      confidence: assessment.confidence,
      probabilities: { [assessment.decision]: assessment.confidence },
    },
    same_name: { noul: assessment.fieldMatches.name },
    same_affiliation: { noul: assessment.fieldMatches.affiliation },
    same_handle: { noul: assessment.fieldMatches.handle },
  };
}

export function claimAnswers(assessment: ClaimAssessment): Record<string, JevAnswer> {
  const kind = assessment.eventKind ?? "no_supported_event";
  const answers: Record<string, JevAnswer> = {
    event_kind: {
      choice: kind,
      confidence: assessment.eventConfidence,
      probabilities: { [kind]: assessment.eventConfidence },
    },
  };
  // A dimension the service did not judge is *absent* from the record. It is
  // never written down as a zero: a fabricated score here would turn "nothing
  // was judged" into "judged as the lowest level", which is the missing≠low
  // failure the pipeline exists to prevent — and the record would no longer
  // project to the assessment it was built from.
  for (const judgment of assessment.dimensions) {
    answers[judgment.dimension] = {
      score: judgment.score,
      confidence: judgment.confidence,
      probabilities: [...judgment.probabilities],
      legend: [...CAREER_EVIDENCE_V1_0_0.levels[judgment.dimension]],
    };
  }
  return answers;
}

/**
 * The fingerprints this fake service advertises.
 *
 * A production invariant the fake has to obey: a record is filed at
 * `recordIdFor(<the fingerprint the service computes for this request>,
 * evidenceKey)`, so the id written is the id a later lookup asks for. The
 * claim fingerprint carries no person — the claim request is the evidence
 * alone, as in the adapter — and the person enters through the evidence key.
 */
export const fakeFingerprints = {
  identity: (personId: string, evidence: GrokEvidenceItem) =>
    contentFingerprint({ kind: "identity", personId, sourceId: evidence.sourceId }),
  claim: (evidence: GrokEvidenceItem) =>
    contentFingerprint({ kind: "claim", sourceId: evidence.sourceId }),
};

export function fakeRecord(
  kind: JevJudgmentRecord["kind"],
  personId: string,
  evidence: GrokEvidenceItem,
  answers: Record<string, JevAnswer>,
): JevJudgmentRecord {
  const fingerprint =
    kind === "identity"
      ? fakeFingerprints.identity(personId, evidence)
      : fakeFingerprints.claim(evidence);
  const evidenceKey = evidenceKeyFor(personId, evidence);
  return freezeRecord({
    id: recordIdFor(fingerprint, evidenceKey),
    kind,
    personId,
    evidenceKey,
    requestFingerprint: fingerprint,
    specId: careerEvidenceSpecId(CAREER_EVIDENCE_V1_0_0),
    requestedModel: CAREER_EVIDENCE_V1_0_0.model,
    respondedModel: `${CAREER_EVIDENCE_V1_0_0.model}-test`,
    requestId: null,
    answers,
    usage: { inputTokens: 100, outputTokens: 20 },
    observedAt: new Date(0).toISOString(),
  });
}

/** Wrap assessment-only fakes in the record-returning service interface. */
export function serviceOf(fake: FakeJudgments): JevJudgmentService {
  return {
    identityFingerprint: (identity, evidence) =>
      fakeFingerprints.identity(identity.personId, evidence),
    claimFingerprint: (evidence) => fakeFingerprints.claim(evidence),
    async assessIdentity(identity, evidence, options) {
      options?.signal?.throwIfAborted();
      const assessment = await fake.assessIdentity(identity, evidence);
      return {
        assessment,
        record: fakeRecord("identity", identity.personId, evidence, identityAnswers(assessment)),
      };
    },
    async assessClaim(evidence, personId, options) {
      options?.signal?.throwIfAborted();
      const assessment = await fake.assessClaim(evidence);
      return {
        assessment,
        record: fakeRecord("claim", personId, evidence, claimAnswers(assessment)),
      };
    },
  };
}

export const acceptingJudgments: FakeJudgments = {
  async assessIdentity() {
    return {
      decision: "same",
      confidence: 0.98,
      fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
    };
  },
  async assessClaim() {
    return {
      eventKind: "open_source_contribution",
      eventConfidence: 0.92,
      dimensions: [
        { dimension: "difficulty", score: 3, probabilities: [0, 0, 0.2, 0.8, 0], confidence: 0.8 },
        { dimension: "ownership", score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 1 },
        {
          dimension: "external_impact",
          score: 2,
          probabilities: [0, 0, 1, 0, 0],
          confidence: 1,
        },
        { dimension: "originality", score: 3, probabilities: [0, 0, 0, 1, 0], confidence: 1 },
        {
          dimension: "peer_validation",
          score: 2,
          probabilities: [0, 0, 1, 0, 0],
          confidence: 1,
        },
      ],
    };
  },
};

/** One accepted career event, with the same score on every dimension. */
export function event(
  id: string,
  personId: string,
  observedDay: number,
  score: number,
): CareerEvent {
  return {
    id,
    personId,
    kind: "shipped_product",
    title: id,
    description: id,
    observedAt: day(observedDay),
    evidenceClaimIds: [`claim-${id}`],
    judgments: [
      { dimension: "difficulty", score, probabilities: [], confidence: 1 },
      { dimension: "ownership", score, probabilities: [], confidence: 1 },
      { dimension: "external_impact", score, probabilities: [], confidence: 1 },
      { dimension: "originality", score, probabilities: [], confidence: 1 },
      { dimension: "peer_validation", score, probabilities: [], confidence: 1 },
    ],
    status: "accepted",
    model: "test",
    questionVersion: "test",
    createdAt: day(observedDay),
  };
}
