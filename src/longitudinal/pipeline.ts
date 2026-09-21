import { CAREER_EVIDENCE_V1_0_0 } from "../models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "./dimensions.ts";
import type { JevJudgmentService } from "./judgments.ts";
import { contentFingerprint } from "./provenance.ts";
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
  const eligible = selectEligible(input.evidence, input.baselineAt, input.cutoffAt);

  // A bounded worker pool, not `Promise.all` over every item: the judgment
  // service is a paid, rate-limited API. Results are written back by index, so
  // the output order is the eligible order regardless of completion order, and
  // the first rejection still rejects the whole call.
  const processed = await mapWithConcurrency(eligible, concurrency, async (evidence) => {
    const identity = await input.judgments.assessIdentity(input.identity, evidence);
    // Identity is settled before any claim assessment. An ambiguous or
    // contradicted identity stops here, so no paid assessment is spent on an
    // item we cannot attribute, and no event is produced for one.
    const gate = gateIdentity(identity, policy);
    const assessment = gate.kind === "stop" ? null : await input.judgments.assessClaim(evidence);
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
