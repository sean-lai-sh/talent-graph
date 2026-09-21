/**
 * The rubric, the evidence and the honest fake service the longitudinal golden
 * runs under.
 *
 * Deliberately NOT `./longitudinal.ts`. This fake pins its own spec — every
 * number that decides an outcome stated here rather than read from a default —
 * because the fixture it feeds is byte-compared. Sharing the other suites'
 * fixtures would make a golden that moves when an unrelated default moves,
 * which is the one thing a golden must not do.
 */

import type {
  CanonicalIdentity,
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
import type { CareerEvidenceSpec } from "../../src/models/spec.ts";

export const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

/**
 * The rubric this golden runs under, with every number that decides an outcome
 * stated here rather than read from a default: the pipeline takes its gate
 * thresholds from the spec it is given (#54 T7 removed the separate `policy`
 * override), so pinning the spec is pinning the policy. If a shipped default
 * moves, this fixture does not.
 */
export const spec: CareerEvidenceSpec = {
  ...CAREER_EVIDENCE_V1_0_0,
  version: "1.0.0",
  model: "jev",
  thresholds: {
    identityConfidence: 0.75,
    identityContradiction: 0.25,
    eventConfidence: 0.65,
    dimensionConfidence: 0.5,
  },
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

export const acceptedAssessment: ClaimAssessment = {
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

/**
 * The judgment service the pipeline now expects: an assessment *and* the
 * record it was projected from. The assessments are still the ones the cases
 * below state — the golden pins those numbers — and the record is the
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
 * The pipeline files a record at `recordIdFor(<the fingerprint the service
 * computes for this request>, evidenceKey)` and refuses one that arrives at
 * any other address, so the fake has to address its records the same way it
 * answers `identityFingerprint`/`claimFingerprint`. The claim fingerprint
 * carries no person, exactly as the adapter's does.
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
    async assessIdentity(identity, evidence) {
      const assessment = await fake.assessIdentity(identity, evidence);
      return {
        assessment,
        record: fakeRecord("identity", identity.personId, evidence, identityAnswers(assessment)),
      };
    },
    async assessClaim(evidence, personId) {
      const assessment = await fake.assessClaim(evidence);
      return {
        assessment,
        record: fakeRecord("claim", personId, evidence, claimAnswers(assessment)),
      };
    },
  };
}

export function service(
  overrides: Partial<FakeJudgments> = {},
  assessment: ClaimAssessment = acceptedAssessment,
): JevJudgmentService {
  return serviceOf({
    async assessIdentity() {
      return sameIdentity;
    },
    async assessClaim() {
      return structuredClone(assessment);
    },
    ...overrides,
  });
}
