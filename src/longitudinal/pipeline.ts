/**
 * Orchestration only: select, judge, gate, judge, decide, materialize.
 *
 * Every decision this makes lives in `./stages.ts` as a pure function, every
 * shared judgment in `./coalescing.ts`, and the pure re-derivation over
 * records already paid for in `./derive.ts`. What is left here is the bounded
 * fan-out over evidence, the two service calls, and assembling the snapshot
 * over the results.
 */

import { CAREER_EVIDENCE_V1_0_0 } from "../models/careerEvidence.ts";
import { assertSpec } from "../models/spec.ts";
import type { JudgmentDeps } from "./coalescing.ts";
import { pendingFor } from "./coalescing.ts";
import { judgeClaim, judgeIdentity } from "./judge.ts";
import type { IdentityAssessment, JevJudgment } from "./judgments.ts";
import type { ProcessEvidenceInput, ProcessEvidenceResult } from "./policy.ts";
import {
  DEFAULT_EVIDENCE_CONCURRENCY,
  DEFAULT_EVIDENCE_ITEM_ERROR,
  evidencePolicyFor,
} from "./policy.ts";
import { contentFingerprint } from "./provenance.ts";
import { JudgmentInvariantError } from "./records.ts";
import { decideStatus, gateIdentity, materialize, selectEligible } from "./stages.ts";

/**
 * Run the evidence pipeline over one person's evidence: the impure half.
 *
 * The fan-out is a bounded worker pool, not `Promise.all` over every item: the
 * judgment service is a paid, rate-limited API.
 */
export async function processEvidence(input: ProcessEvidenceInput): Promise<ProcessEvidenceResult> {
  const spec = assertSpec(input.spec ?? CAREER_EVIDENCE_V1_0_0);
  const policy = evidencePolicyFor(spec);
  const stamp = { model: policy.model, questionVersion: policy.questionVersion };
  const concurrency = resolveConcurrency(input.runtime?.concurrency);
  const onItemError = input.runtime?.onItemError ?? DEFAULT_EVIDENCE_ITEM_ERROR;
  const signal = input.runtime?.signal;
  const store = input.runtime?.store;
  const deps: JudgmentDeps = {
    service: input.judgments,
    ...(store === undefined ? {} : { store }),
    // Shared with every other run over the same store; private to this call
    // when there is none, which still coalesces duplicate items in one batch.
    pending: store === undefined ? new Map() : pendingFor(store),
    ...(signal === undefined ? {} : { signal }),
  };
  const eligible = selectEligible(input.evidence, input.baselineAt, input.cutoffAt);
  signal?.throwIfAborted();

  // A bounded worker pool, not `Promise.all` over every item: the judgment
  // service is a paid, rate-limited API. Results are written back by index, so
  // the output order is the eligible order regardless of completion order.
  const processed = await mapWithConcurrency(eligible, concurrency, signal, async (evidence) => {
    // What was observed for this item before it failed, if it failed. An
    // identity judgment already paid for is kept whatever happens next.
    let observedIdentity: JevJudgment<IdentityAssessment> | null = null;
    try {
      const identity = await judgeIdentity(evidence, input.identity, spec, deps);
      observedIdentity = identity;
      // Identity is settled before any claim assessment. An ambiguous or
      // contradicted identity stops here, so no paid assessment is spent on an
      // item we cannot attribute, and no event is produced for one.
      const gate = gateIdentity(identity.assessment, policy);
      signal?.throwIfAborted();
      const claim =
        gate.kind === "stop"
          ? null
          : await judgeClaim(evidence, input.identity.personId, spec, deps);
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
    } catch (error) {
      // A cancelled batch has no partial result, and a caller that asked for
      // all-or-nothing gets it: both reject the whole call.
      if (signal?.aborted === true || onItemError === "throw") throw error;
      // Isolation is for a judgment that could not be *made*, not for one
      // that is not readable. A broken invariant — a store answering with
      // another person's record, a record under a foreign rubric, a
      // malformed answer — is a bug no retry fixes, and turning it into a
      // `review` claim would hide it behind a plausible-looking outcome.
      //
      // By class, never by shape: `fetch` reports a DNS or connection
      // failure as a plain `TypeError`, and an outage is the ordinary
      // unavailable judgment this mode exists to isolate.
      if (error instanceof JudgmentInvariantError) throw error;
      // Everything else is one item's failure, and stays one item's failure:
      // a `review` claim that says the judgment was unavailable. No
      // assessment ran, so there is no kind, no event and no score — an
      // absence, never a zero.
      const identity = observedIdentity?.assessment ?? null;
      return {
        ...materialize({
          personId: input.identity.personId,
          evidence,
          retrievedAt: input.retrievedAt,
          identity,
          assessment: null,
          decision: decideStatus(identity, null, policy),
          stamp,
        }),
        records: observedIdentity === null ? [] : [observedIdentity.record],
      };
    }
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
 * results in input order.
 *
 * Whether a failing item rejects this at all is the worker's business: under
 * `onItemError: "review"` a failed item is isolated and never reaches here,
 * so the pool runs to the end. A worker that does reject — `onItemError:
 * "throw"`, a broken invariant, an abort — rejects the returned promise at
 * once, but does not stop the pool: items already in flight, and items
 * already handed out, may still complete and be recorded after the caller has
 * seen the rejection. Every worker's rejection is observed, so none is
 * unhandled.
 *
 * `signal` is checked before each item is handed out, so an abort stops the
 * pool from starting work the caller no longer wants; the items already in
 * flight are cancelled by the same signal inside the service.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal | undefined,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const drain = async (): Promise<void> => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}
