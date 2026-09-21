/**
 * The policy a career-evidence spec implies, and the shape of one run.
 *
 * Nothing here decides anything or calls anything: it is the gate thresholds
 * and the stamp a spec carries, the fan-out shape a caller may ask for, and
 * what `processEvidence` takes and returns. Kept apart from the orchestration
 * so a reader can see the contract without the fan-out, and from the stages so
 * a stage that decides never reads a stamping field.
 */

import { CAREER_EVIDENCE_V1_0_0 } from "../models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../models/spec.ts";
import type { JevJudgmentService } from "./judgments.ts";
import type { JevJudgmentRecord } from "./records.ts";
import type { EvidenceThresholds } from "./stages.ts";
import type { JevJudgmentStore } from "./store.ts";
import type {
  CanonicalIdentity,
  CareerEvent,
  EvidenceClaim,
  GrokEvidenceItem,
  ProfileSnapshot,
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
 * What one item's failure does to the batch. `review` by default: one bad
 * item never kills the other nine.
 */
export type EvidenceItemErrorMode = "review" | "throw";

/** Default per-item failure handling: isolate the item, keep the batch. */
export const DEFAULT_EVIDENCE_ITEM_ERROR: EvidenceItemErrorMode = "review";

/**
 * Fan-out shape for one `processEvidence` call: how many items are judged at
 * once, what a failing item does to the rest, where judgments are cached, and
 * how the caller cancels.
 *
 * Deliberately *not* transport policy. How long one request may take and how
 * often it is retried is the client's business, set once where the client is
 * constructed in the app layer; nothing here reaches the wire except the
 * signal, which is passed to the judgment service untouched.
 */
export interface EvidenceRuntime {
  /** Maximum evidence items assessed at once. Integer >= 1. */
  concurrency?: number;
  /**
   * What a judgment failure does to the item and to the batch.
   *
   * `review` (the default) isolates it: the item becomes a `review` claim
   * with a `judgment_unavailable` reason and no event, and the other items
   * are judged and returned as usual. Nothing about that claim is a low
   * assessment — there is no assessment at all, which is exactly what the
   * reason says.
   *
   * `throw` restores the all-or-nothing behaviour: the first failure rejects
   * the whole call. For callers that would rather have no result than a
   * partial one. It rejects early, it does not stop the pool: items already
   * in flight, and items the pool had already handed out, may still be paid
   * for and recorded after the call has rejected. `signal` is what stops the
   * fan-out early.
   */
  onItemError?: EvidenceItemErrorMode;
  /**
   * Cancellation from the caller. Checked before each item and between the
   * two judgments of one item, and handed to the judgment service so an
   * in-flight request is cancelled rather than waited out.
   *
   * An abort rejects the whole call whatever `onItemError` says: a cancelled
   * batch has no partial result to report, and a claim built from work the
   * caller abandoned would be a claim nobody asked for.
   *
   * It cancels *claims*, not observations. A judgment that was already made
   * — because the service ignored the signal, or answered in the same tick —
   * is still written to the store: it was paid for, it is a true record of
   * what the model said, and throwing it away would only mean buying it
   * again. A retry after a cancelled run therefore starts from a store hit.
   *
   * A judgment several runs are waiting on is cancelled only when every one
   * of them has aborted. One caller going away is not an answer about anyone
   * else's batch, so the others keep the request and their claims.
   */
  signal?: AbortSignal;
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
  /**
   * Rubric the judgments were made against, and the only source of the gate
   * thresholds. Defaults to the registered version.
   *
   * There is deliberately no separate `policy` override: the thresholds a run
   * decided under have to be the ones its spec records, or a claim could be
   * gated by numbers nothing in its provenance names. A run under different
   * numbers is a run under a different spec.
   */
  spec?: CareerEvidenceSpec;
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
   *
   * An item the fan-out isolated contributes only what was actually observed
   * — its identity record, or nothing at all. The set is therefore *not*
   * complete for a run that had a `judgment_unavailable` claim, and
   * `deriveEvidence` refuses to derive over a gap rather than invent one:
   * re-run with the same store first, which re-judges exactly the missing
   * item and leaves the rest a store hit.
   */
  records: JevJudgmentRecord[];
}
