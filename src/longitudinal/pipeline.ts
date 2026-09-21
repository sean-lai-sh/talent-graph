import { CAREER_EVIDENCE_V1_0_0, careerEvidenceSpecId } from "../models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "./dimensions.ts";
import type {
  ClaimAssessment,
  IdentityAssessment,
  JevJudgment,
  JevJudgmentService,
} from "./judgments.ts";
import { contentFingerprint } from "./provenance.ts";
import type { JevJudgmentRecord, JevJudgmentStore } from "./records.ts";
import {
  evidenceKeyFor,
  projectClaim,
  projectIdentity,
  recordIdFor,
  rubricHashOf,
} from "./records.ts";
import type { EvidenceThresholds } from "./stages.ts";
import { decideStatus, gateIdentity, materialize, selectEligible } from "./stages.ts";
import type {
  CanonicalIdentity,
  CareerEvent,
  EvidenceClaim,
  GrokEvidenceItem,
  ProfileSnapshot,
  ProgressDimension,
  ProgressVector,
} from "./types.ts";

export interface EvidencePipelinePolicy extends EvidenceThresholds {
  questionVersion: string;
  model: string;
}

/**
 * Tag stamped on every event a career-evidence spec produced. It names the
 * question set, not the spec object: events already carry
 * `career-evidence@1.0.0`, so the tag is deliberately *not* the spec id — the
 * id (with its rubric hash) is how a silent edit is caught, not how a shipped
 * event is labelled.
 */
const QUESTION_VERSION_PREFIX = "career-evidence@";

/**
 * The policy a career-evidence spec implies: its gate thresholds, plus the
 * stamp events made under it carry. The spec is validated here, so a corrupt
 * rubric cannot reach a claim.
 */
export function evidencePolicyFor(spec: CareerEvidenceSpec): EvidencePipelinePolicy {
  assertSpec(spec);
  return Object.freeze({
    ...spec.thresholds,
    questionVersion: `${QUESTION_VERSION_PREFIX}${spec.version}`,
    model: spec.model,
  });
}

export const DEFAULT_EVIDENCE_POLICY: EvidencePipelinePolicy =
  evidencePolicyFor(CAREER_EVIDENCE_V1_0_0);

/** Default number of evidence items assessed concurrently. */
export const DEFAULT_EVIDENCE_CONCURRENCY = 4;

/**
 * Fan-out shape for one `processEvidence` call. Grouped like `policy` so the
 * remaining runtime knobs (per-item isolation, cancellation, caching) have a
 * home without widening the flat input again.
 */
export interface EvidenceRuntime {
  /** Maximum evidence items assessed at once. Integer >= 1. */
  concurrency?: number;
  /**
   * Where judgment records are read and written. Consulted before the
   * network: a judgment already recorded for this request *about this
   * person's evidence* — the record id addresses both — is answered from the
   * record, so a repeated run over identical evidence is free.
   *
   * Free only for the *same* rubric. The fingerprint is over the request and
   * the spec id, and the spec id carries the version, so a spec bump misses
   * here even when only the gate thresholds moved and the questions sent are
   * identical. Re-deriving under new thresholds without re-billing is
   * `runCareerEvidence` (`./run.ts`), which reads the records this run
   * returned rather than asking again.
   */
  store?: JevJudgmentStore;
}

export interface ProcessEvidenceInput {
  identity: CanonicalIdentity;
  evidence: readonly GrokEvidenceItem[];
  baselineAt?: Date;
  cutoffAt: Date;
  retrievedAt: Date;
  pipelineVersion: string;
  judgments: JevJudgmentService;
  /** Rubric the judgments were made against. Defaults to the registered version. */
  spec?: CareerEvidenceSpec;
  /** Explicit override; otherwise the policy `spec` implies. */
  policy?: EvidencePipelinePolicy;
  runtime?: EvidenceRuntime;
}

export interface ProcessEvidenceResult {
  claims: EvidenceClaim[];
  events: CareerEvent[];
  snapshot: ProfileSnapshot;
  needsReview: boolean;
  /**
   * Every judgment record the run read or wrote, in evaluation order
   * (identity before claim, item by item). These are the raw observations
   * `runCareerEvidence` derives from; the claims and events above are one
   * derivation of them.
   */
  records: JevJudgmentRecord[];
}

/** What a judgment stage needs: the service, and where records are kept. */
export interface JudgmentDeps {
  service: JevJudgmentService;
  store?: JevJudgmentStore;
}

/**
 * The identity judgment for one evidence item, from the store when it is
 * already recorded and from the network otherwise.
 *
 * With `deps.store` populated this issues no request at all: the record is the
 * observation, and the assessment is a projection of it. The fingerprint is
 * the service's, because only the service knows what it would send.
 */
export async function judgeIdentity(
  evidence: GrokEvidenceItem,
  identity: CanonicalIdentity,
  spec: CareerEvidenceSpec,
  deps: JudgmentDeps,
): Promise<JevJudgment<IdentityAssessment>> {
  const fingerprint = deps.service.identityFingerprint(identity, evidence);
  const recorded = await recordedJudgment({
    fingerprint,
    kind: "identity",
    personId: identity.personId,
    evidence,
    store: deps.store,
  });
  if (recorded !== null) return { assessment: projectIdentity(recorded, spec), record: recorded };
  const judged = await deps.service.assessIdentity(identity, evidence);
  await deps.store?.put(judged.record);
  return judged;
}

/** The claim judgment for one evidence item; store first, network second. */
export async function judgeClaim(
  evidence: GrokEvidenceItem,
  personId: string,
  spec: CareerEvidenceSpec,
  deps: JudgmentDeps,
): Promise<JevJudgment<ClaimAssessment>> {
  const fingerprint = deps.service.claimFingerprint(evidence);
  const recorded = await recordedJudgment({
    fingerprint,
    kind: "claim",
    personId,
    evidence,
    store: deps.store,
  });
  if (recorded !== null) return { assessment: projectClaim(recorded, spec), record: recorded };
  const judged = await deps.service.assessClaim(evidence, personId);
  await deps.store?.put(judged.record);
  return judged;
}

/**
 * A stored record for this exact request *about this exact evidence*, or
 * `null`. Never a near miss.
 *
 * The person is never part of a request — the claim state is the evidence
 * alone, and the identity state is a name and its identities — so the
 * fingerprint alone does not name an observation. The address is the record
 * id, which carries the evidence key as well, and what comes back is checked
 * against both: a store that answers with another person's record is a bug
 * here, not a cheap judgment.
 */
async function recordedJudgment(input: {
  fingerprint: string;
  kind: JevJudgmentRecord["kind"];
  personId: string;
  evidence: GrokEvidenceItem;
  store: JevJudgmentStore | undefined;
}): Promise<JevJudgmentRecord | null> {
  const evidenceKey = evidenceKeyFor(input.personId, input.evidence);
  const id = recordIdFor(input.fingerprint, evidenceKey);
  const record = (await input.store?.get(id)) ?? null;
  if (record === null) return null;
  if (
    record.id !== id ||
    record.kind !== input.kind ||
    record.requestFingerprint !== input.fingerprint ||
    record.personId !== input.personId ||
    record.evidenceKey !== evidenceKey
  ) {
    throw new TypeError(
      `judgment store: ${id} holds ${record.id}, a ${record.kind} record for ` +
        `${record.evidenceKey}; a store must return the record it was asked for`,
    );
  }
  return record;
}

/**
 * Orchestration only: select, judge, gate, judge, decide, materialize.
 *
 * Every decision this makes lives in `stages.ts` as a pure function; what is
 * left here is the fan-out over evidence, the two service calls, and assembling
 * the snapshot over the results.
 */
export async function processEvidence(input: ProcessEvidenceInput): Promise<ProcessEvidenceResult> {
  const spec = assertSpec(input.spec ?? CAREER_EVIDENCE_V1_0_0);
  const policy = input.policy ?? evidencePolicyFor(spec);
  const stamp = { model: policy.model, questionVersion: policy.questionVersion };
  const concurrency = resolveConcurrency(input.runtime?.concurrency);
  const deps: JudgmentDeps = {
    service: input.judgments,
    ...(input.runtime?.store === undefined ? {} : { store: input.runtime.store }),
  };
  const eligible = selectEligible(input.evidence, input.baselineAt, input.cutoffAt);

  // A bounded worker pool, not `Promise.all` over every item: the judgment
  // service is a paid, rate-limited API. Results are written back by index, so
  // the output order is the eligible order regardless of completion order, and
  // the first rejection still rejects the whole call.
  const processed = await mapWithConcurrency(eligible, concurrency, async (evidence) => {
    const identity = await judgeIdentity(evidence, input.identity, spec, deps);
    // Identity is settled before any claim assessment. An ambiguous or
    // contradicted identity stops here, so no paid assessment is spent on an
    // item we cannot attribute, and no event is produced for one.
    const gate = gateIdentity(identity.assessment, policy);
    const claim =
      gate.kind === "stop" ? null : await judgeClaim(evidence, input.identity.personId, spec, deps);
    return {
      ...materialize({
        personId: input.identity.personId,
        evidence,
        retrievedAt: input.retrievedAt,
        identity: identity.assessment,
        assessment: claim?.assessment ?? null,
        decision: decideStatus(identity.assessment, claim?.assessment ?? null, policy),
        stamp,
      }),
      records: claim === null ? [identity.record] : [identity.record, claim.record],
    };
  });

  const claims = processed.map(({ claim }) => claim);
  const events = processed.flatMap(({ event }) => (event === null ? [] : [event]));
  const records = processed.flatMap(({ records: itemRecords }) => itemRecords);
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
    records,
  };
}

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
      throw new TypeError(
        `deriveEvidence: record ${record.id} was judged under rubric ${recorded} ` +
          `(${record.specId}), not ${rubricHash}; a derivation cannot read an answer to a ` +
          "different question",
      );
    }
    const key = `${record.kind}\u0000${record.evidenceKey}`;
    const existing = byKey.get(key);
    if (existing !== undefined && existing.id !== record.id) {
      throw new TypeError(
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
    throw new TypeError(
      `deriveEvidence: no ${kind} judgment record for ${evidenceKey}; a derivation is over ` +
        "the records it was given, and a missing judgment is not a low one",
    );
  }
  return record;
}

export function progressVector(
  personId: string,
  from: Date,
  to: Date,
  events: readonly CareerEvent[],
): ProgressVector {
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
  ) as Record<ProgressDimension, number | null>;
  return {
    personId,
    from: new Date(from.getTime()),
    to: new Date(to.getTime()),
    dimensions,
    acceptedEventIds: accepted.map((event) => event.id).sort(),
  };
}

function resolveConcurrency(requested: number | undefined): number {
  const concurrency = requested ?? DEFAULT_EVIDENCE_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `processEvidence: runtime.concurrency must be an integer >= 1, received ${String(requested)}`,
    );
  }
  return concurrency;
}

/**
 * Run `worker` over `items` with at most `limit` calls in flight, returning the
 * results in input order. The first rejection rejects the returned promise, as
 * `Promise.all` did; every worker's rejection is observed, so none is unhandled.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const drain = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}
