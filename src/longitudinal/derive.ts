/**
 * The evidence pipeline with the judgments already made: pure, no service, no
 * store, no network — and the career-evidence vector over what it accepted.
 *
 * `processEvidence` (./pipeline.ts) is `deriveEvidence` plus the two impure
 * stages that fetch the records. Re-running a rubric whose thresholds moved is
 * therefore a derivation over observations already paid for, which is what
 * `runCareerEvidence` (./run.ts) wraps in a `ModelRun`.
 */

import { careerEvidenceSpecId } from "../models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "./dimensions.ts";
import type { ProcessEvidenceResult } from "./policy.ts";
import { evidencePolicyFor } from "./policy.ts";
import { projectClaim, projectIdentity } from "./projections.ts";
import { contentFingerprint } from "./provenance.ts";
import type { JevJudgmentRecord } from "./records.ts";
import { evidenceKeyFor, JudgmentInvariantError, rubricHashOf } from "./records.ts";
import { decideStatus, gateIdentity, materialize, selectEligible } from "./stages.ts";
import type {
  CanonicalIdentity,
  CareerEvent,
  CareerEvidenceDimension,
  CareerEvidenceVector,
  GrokEvidenceItem,
} from "./types.ts";

/** What a derivation reads: the same inputs, with records instead of a service. */
export interface DeriveEvidenceInput {
  identity: CanonicalIdentity;
  evidence: readonly GrokEvidenceItem[];
  /** The raw observations. One identity record per eligible item, at least. */
  records: readonly JevJudgmentRecord[];
  baselineAt?: Date;
  cutoffAt: Date;
  retrievedAt: Date;
  pipelineVersion: string;
}

/**
 * The same pipeline, with the judgments already made: pure, no service, no
 * store, no network.
 *
 * `processEvidence` is this function plus the two impure stages that fetch the
 * records. Re-running a rubric whose thresholds moved is therefore a
 * derivation over observations already paid for, which is what
 * `runCareerEvidence` (see `./run.ts`) wraps in a `ModelRun`.
 */
export function deriveEvidence(
  input: DeriveEvidenceInput,
  spec: CareerEvidenceSpec,
): Omit<ProcessEvidenceResult, "records"> {
  const used = assertSpec(spec);
  const policy = evidencePolicyFor(used);
  const stamp = { model: policy.model, questionVersion: policy.questionVersion };
  const rubricHash = rubricHashOf(careerEvidenceSpecId(used));
  const byKey = indexRecords(input.records, rubricHash);
  const eligible = selectEligible(input.evidence, input.baselineAt, input.cutoffAt);
  const processed = eligible.map((evidence) => {
    const key = evidenceKeyFor(input.identity.personId, evidence);
    const identity = projectIdentity(requireRecord(byKey, key, "identity"), used);
    // The same order the pipeline judged in: a claim record only exists for an
    // item whose identity passed, so the gate is what decides to read one.
    const gate = gateIdentity(identity, policy);
    const claimRecord = gate.kind === "stop" ? undefined : requireRecord(byKey, key, "claim");
    const assessment = claimRecord === undefined ? null : projectClaim(claimRecord, used);
    return materialize({
      personId: input.identity.personId,
      evidence,
      retrievedAt: input.retrievedAt,
      identity,
      assessment,
      decision: decideStatus(identity, assessment, policy),
      stamp,
    });
  });
  const claims = processed.map(({ claim }) => claim);
  const events = processed.flatMap(({ event }) => (event === null ? [] : [event]));
  const snapshotHash = contentFingerprint({
    personId: input.identity.personId,
    cutoffAt: input.cutoffAt.toISOString(),
    claims: claims.map((claim) => [claim.id, claim.status]),
    pipelineVersion: input.pipelineVersion,
  });
  return {
    claims,
    events,
    snapshot: {
      id: `profile-${snapshotHash}`,
      personId: input.identity.personId,
      capturedAt: new Date(input.retrievedAt.getTime()),
      cutoffAt: new Date(input.cutoffAt.getTime()),
      claimIds: claims.map((claim) => claim.id),
      contentHash: snapshotHash,
      pipelineVersion: input.pipelineVersion,
    },
    needsReview: claims.some((claim) => claim.status === "review"),
  };
}

/**
 * Records by `${kind}\u0000${evidenceKey}`; a duplicate is ambiguous, so it
 * throws — and so does a record answering a *different* rubric.
 *
 * The spec id is `career_evidence@<version>:<rubricHash>`. The version may
 * move without changing a question (a thresholds-only bump, which is exactly
 * the free re-derivation this function serves), but a different rubric hash
 * means the model was asked something else, and an answer to another question
 * is not a judgment under this spec however well its shape fits.
 */
function indexRecords(
  records: readonly JevJudgmentRecord[],
  rubricHash: string,
): Map<string, JevJudgmentRecord> {
  const byKey = new Map<string, JevJudgmentRecord>();
  for (const record of records) {
    const recorded = rubricHashOf(record.specId);
    if (recorded !== rubricHash) {
      throw new JudgmentInvariantError(
        `deriveEvidence: record ${record.id} was judged under rubric ${recorded} ` +
          `(${record.specId}), not ${rubricHash}; a derivation cannot read an answer to a ` +
          "different question",
      );
    }
    const key = `${record.kind}\u0000${record.evidenceKey}`;
    const existing = byKey.get(key);
    if (existing !== undefined && existing.id !== record.id) {
      throw new JudgmentInvariantError(
        `deriveEvidence: two different ${record.kind} records for ${record.evidenceKey} ` +
          `(${existing.id}, ${record.id}); a derivation cannot choose between them`,
      );
    }
    byKey.set(key, record);
  }
  return byKey;
}

function requireRecord(
  byKey: Map<string, JevJudgmentRecord>,
  evidenceKey: string,
  kind: JevJudgmentRecord["kind"],
): JevJudgmentRecord {
  const record = byKey.get(`${kind}\u0000${evidenceKey}`);
  if (record === undefined) {
    throw new JudgmentInvariantError(
      `deriveEvidence: no ${kind} judgment record for ${evidenceKey}; a derivation is over ` +
        "the records it was given, and a missing judgment is not a low one",
    );
  }
  return record;
}

export function careerEvidenceVector(
  personId: string,
  from: Date,
  to: Date,
  events: readonly CareerEvent[],
): CareerEvidenceVector {
  const accepted = events.filter(
    (event) =>
      event.personId === personId &&
      event.status === "accepted" &&
      event.observedAt.getTime() > from.getTime() &&
      event.observedAt.getTime() <= to.getTime(),
  );
  const dimensions = Object.fromEntries(
    CAREER_EVIDENCE_DIMENSIONS.map((dimension) => {
      const values = accepted.flatMap((event) =>
        event.judgments
          .filter((judgment) => judgment.dimension === dimension)
          .map((judgment) => judgment.score / MAX_LEVEL),
      );
      return [
        dimension,
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
      ];
    }),
  ) as Record<CareerEvidenceDimension, number | null>;
  return {
    personId,
    from: new Date(from.getTime()),
    to: new Date(to.getTime()),
    dimensions,
    acceptedEventIds: accepted.map((event) => event.id).sort(),
  };
}
