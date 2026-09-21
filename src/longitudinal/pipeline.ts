import { CAREER_EVIDENCE_V1_0_0, careerEvidenceSpecId } from "../models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "./dimensions.ts";
import type {
  ClaimAssessment,
  IdentityAssessment,
  JevJudgment,
  JevJudgmentService,
  JevRequestOptions,
} from "./judgments.ts";
import { contentFingerprint } from "./provenance.ts";
import type { JevJudgmentRecord, JevJudgmentStore } from "./records.ts";
import {
  evidenceKeyFor,
  JudgmentInvariantError,
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
  CareerEvidenceDimension,
  CareerEvidenceVector,
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

/** What a judgment stage needs: the service, and where records are kept. */
export interface JudgmentDeps {
  service: JevJudgmentService;
  store?: JevJudgmentStore;
  /**
   * Judgments already in flight, by record id. A second ask for a record
   * another worker is already paying for waits for that one instead of
   * issuing its own: duplicate evidence in one batch, or two runs sharing a
   * store, cost one judgment, and the append-only store is never handed the
   * same observation twice.
   */
  pending?: Map<string, SharedJudgment>;
  /** Cancellation, handed to the service with every request. */
  signal?: AbortSignal;
}

/**
 * The in-flight judgments of every run sharing one store.
 *
 * Coalescing is keyed by record id, which names the request *and* the
 * evidence, so two callers that meet here are waiting for the same
 * observation. It is scoped per store — concurrent runs coalesce exactly when
 * a hit by one would have been a hit for the other — and a run with no store
 * coalesces within itself only (see `processEvidence`), because there is
 * nowhere for a shared answer to have been recorded.
 */
const IN_FLIGHT_BY_STORE = new WeakMap<JevJudgmentStore, Map<string, SharedJudgment>>();

/** The pending-judgment map shared by every run over `store`. */
function pendingFor(store: JevJudgmentStore): Map<string, SharedJudgment> {
  const existing = IN_FLIGHT_BY_STORE.get(store);
  if (existing !== undefined) return existing;
  const created = new Map<string, SharedJudgment>();
  IN_FLIGHT_BY_STORE.set(store, created);
  return created;
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
  const expected = expectationFor({
    fingerprint: deps.service.identityFingerprint(identity, evidence),
    kind: "identity",
    personId: identity.personId,
    evidence,
    spec,
  });
  const coalesced = await coalesce(deps, expected, (options) =>
    deps.service.assessIdentity(identity, evidence, options),
  );
  return (
    coalesced.judged ?? {
      assessment: projectIdentity(coalesced.record, spec),
      record: coalesced.record,
    }
  );
}

/** The claim judgment for one evidence item; store first, network second. */
export async function judgeClaim(
  evidence: GrokEvidenceItem,
  personId: string,
  spec: CareerEvidenceSpec,
  deps: JudgmentDeps,
): Promise<JevJudgment<ClaimAssessment>> {
  const expected = expectationFor({
    fingerprint: deps.service.claimFingerprint(evidence),
    kind: "claim",
    personId,
    evidence,
    spec,
  });
  const coalesced = await coalesce(deps, expected, (options) =>
    deps.service.assessClaim(evidence, personId, options),
  );
  return (
    coalesced.judged ?? {
      assessment: projectClaim(coalesced.record, spec),
      record: coalesced.record,
    }
  );
}

/**
 * What a record has to be, to be the observation this request is asking for.
 *
 * Every path that accepts a record from a store — a cache hit, and the
 * re-read after a write that lost a race — checks it against this. A store
 * that answers with something else is a bug to be shouted about, not a
 * cheaper judgment and not an unavailable one.
 */
interface RecordExpectation {
  /** `recordIdFor(fingerprint, evidenceKey)`: the address, and the id. */
  id: string;
  kind: JevJudgmentRecord["kind"];
  fingerprint: string;
  personId: string;
  evidenceKey: string;
  /** The rubric half of the spec id; the version is deliberately not compared. */
  rubricHash: string;
}

function expectationFor(input: {
  fingerprint: string;
  kind: JevJudgmentRecord["kind"];
  personId: string;
  evidence: GrokEvidenceItem;
  spec: CareerEvidenceSpec;
}): RecordExpectation {
  const evidenceKey = evidenceKeyFor(input.personId, input.evidence);
  return {
    id: recordIdFor(input.fingerprint, evidenceKey),
    kind: input.kind,
    fingerprint: input.fingerprint,
    personId: input.personId,
    evidenceKey,
    rubricHash: rubricHashOf(careerEvidenceSpecId(input.spec)),
  };
}

/**
 * The record, if it is the one that was asked for; a `TypeError` otherwise.
 *
 * The person is never part of a request — the claim state is the evidence
 * alone, and the identity state is a name and its identities — so the
 * fingerprint alone does not name an observation. The address is the record
 * id, which carries the evidence key as well, and what comes back is checked
 * against both: a store that answers with another person's record is a bug
 * here, not a cheap judgment.
 *
 * The rubric is checked for the same reason `deriveEvidence` checks it: the
 * assessment is read out of the record under a spec, so a record answering
 * different questions cannot be read here either, however well its shape
 * fits. Only the rubric hash is compared, not the version — a thresholds-only
 * bump asks the model exactly the same things — which neither widens nor
 * narrows what hits: the fingerprint already carries the whole spec id, so a
 * version bump misses before this is reached.
 */
function assertRecordedFor(
  record: JevJudgmentRecord,
  expected: RecordExpectation,
): JevJudgmentRecord {
  if (
    record.id !== expected.id ||
    record.kind !== expected.kind ||
    record.requestFingerprint !== expected.fingerprint ||
    record.personId !== expected.personId ||
    record.evidenceKey !== expected.evidenceKey
  ) {
    throw new JudgmentInvariantError(
      `judgment store: ${expected.id} holds ${record.id}, a ${record.kind} record for ` +
        `${record.evidenceKey}; a store must return the record it was asked for`,
    );
  }
  const recordedRubric = rubricHashOf(record.specId);
  if (recordedRubric !== expected.rubricHash) {
    throw new JudgmentInvariantError(
      `judgment store: ${record.id} was judged under rubric ${recordedRubric} ` +
        `(${record.specId}), not ${expected.rubricHash}; an answer to a different question is ` +
        "not a cached judgment",
    );
  }
  return record;
}

/**
 * A stored record for this exact request *about this exact evidence*, or
 * `null`. Never a near miss: what the store hands back is checked by
 * `assertRecordedFor` before anything is read out of it.
 */
async function recordedJudgment(
  store: JevJudgmentStore | undefined,
  expected: RecordExpectation,
): Promise<JevJudgmentRecord | null> {
  const record = (await store?.get(expected.id)) ?? null;
  return record === null ? null : assertRecordedFor(record, expected);
}

/**
 * One in-flight judgment and the askers waiting on it.
 *
 * Askers share the request, not each other's cancellation. The call runs
 * under `controller` — an internal signal, never a caller's — and that
 * controller is aborted only once *every* asker has gone away. An asker that
 * aborts while others are still waiting rejects on its own and leaves the
 * call running for them.
 *
 * `controller` is absent when the asker that started the call had no signal:
 * a request nobody can cancel stays uncancellable, which is the safe side of
 * this trade — a late joiner with a signal can still stop waiting, it just
 * cannot stop the request.
 *
 * The entry lives as long as an asker is waiting on it, not as long as the
 * asker that started it: a judgment whose starter aborted is still owed to
 * everyone who joined, and still the one a later asker should join rather
 * than buy again.
 */
export interface SharedJudgment {
  record: Promise<JevJudgmentRecord>;
  controller?: AbortController;
  /** Signals of the askers still waiting that have not aborted. */
  signalled: Set<AbortSignal>;
  /** Askers still waiting that gave no signal, and so never go away. */
  unsignalled: number;
  /** Askers waiting, however they wait. The entry is dropped at zero. */
  waiters: number;
  /** Set when the judgment has settled; there is nothing left to cancel. */
  done: boolean;
}

/**
 * Register one asker on a shared judgment; the returned function unregisters
 * it. When the last asker that could still want the answer aborts, and none
 * of the others can cancel, the shared request is cancelled too.
 */
function joinShared(shared: SharedJudgment, signal: AbortSignal | undefined): () => void {
  shared.waiters += 1;
  const depart = () => {
    shared.waiters -= 1;
    // Nobody is left to want an answer that has not arrived: stop paying for
    // it. A judgment that already settled has nothing to cancel, and an
    // already-aborted controller keeps the reason its abort carried.
    if (shared.waiters === 0 && !shared.done) shared.controller?.abort();
  };
  if (signal === undefined) {
    shared.unsignalled += 1;
    return () => {
      shared.unsignalled -= 1;
      depart();
    };
  }
  if (signal.aborted) return depart;
  const onAbort = () => {
    shared.signalled.delete(signal);
    if (shared.signalled.size === 0 && shared.unsignalled === 0) {
      shared.controller?.abort(signal.reason);
    }
  };
  shared.signalled.add(signal);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    shared.signalled.delete(signal);
    signal.removeEventListener("abort", onAbort);
    depart();
  };
}

/** `promise`, unless this asker's own signal aborts first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Judge once, however many askers there are.
 *
 * The first asker runs `judge`, records what comes back and keeps its own
 * assessment — the service is the authority on what it observed, and nothing
 * re-projects an answer that was handed over directly. Every other asker
 * waits on that same promise and projects the record, which is the whole
 * point of the record being the observation: a second reader needs nothing
 * else.
 *
 * What askers share is the observation and, deliberately, its absence: if the
 * judgment fails for anything other than a cancellation, every asker sees
 * that failure and each isolates it under its own `onItemError`. What they do
 * *not* share is a cancellation — one caller going away is not an answer
 * about anyone else's batch (see `SharedJudgment`).
 *
 * `record` is what was finally recorded, which is not always what was judged:
 * see `recordJudgment`.
 */
async function coalesce<TAssessment>(
  deps: JudgmentDeps,
  expected: RecordExpectation,
  judge: (options: JevRequestOptions | undefined) => Promise<JevJudgment<TAssessment>>,
): Promise<{ record: JevJudgmentRecord; judged?: JevJudgment<TAssessment> }> {
  const id = expected.id;
  const pending = deps.pending;
  const inFlight = pending?.get(id);
  // A shared call whose controller has already been aborted is no use to a
  // new asker: it starts its own instead, and takes over the entry.
  if (inFlight !== undefined && inFlight.controller?.signal.aborted !== true) {
    const leave = joinShared(inFlight, deps.signal);
    try {
      return { record: await untilAborted(inFlight.record, deps.signal) };
    } finally {
      leave();
      evict(pending, id, inFlight);
    }
  }
  // The caller may have gone away while the store was being read — the pool
  // checked before handing this item out, and that was several awaits ago.
  // Starting a request now would buy an answer nobody is waiting for.
  deps.signal?.throwIfAborted();
  let judged: JevJudgment<TAssessment> | undefined;
  const controller = deps.signal === undefined ? undefined : new AbortController();
  const record = (async () => {
    // The lookup is part of the shared work, not something each asker does
    // first. Done separately it can be overtaken: a `get` issued before
    // another asker wrote can resolve "nothing recorded here" after that
    // asker has written and gone, and believing that stale miss buys the
    // same judgment twice. Inside, an asker arriving during the lookup joins
    // the lookup and the judgment as one unit.
    const recorded = await recordedJudgment(deps.store, expected);
    if (recorded !== null) return recorded;
    // The lookup took time, and the controller is aborted once every asker
    // has gone: a judgment nobody is waiting for is not bought.
    controller?.signal.throwIfAborted();
    judged = await judge(controller === undefined ? undefined : { signal: controller.signal });
    // The service answers for the request it was given. A record about
    // another person, another rubric or another question is refused here,
    // before the write: filed at an address nothing computes, it would read
    // back as a permanent miss and a re-billed judgment rather than an error.
    return recordJudgment(deps.store, assertRecordedFor(judged.record, expected), expected);
  })();
  // Every asker observes this rejection through its own `await`; this only
  // keeps the shared copy from being reported as an unhandled one.
  record.catch(() => {});
  const shared: SharedJudgment = {
    record,
    signalled: new Set(),
    unsignalled: 0,
    waiters: 0,
    done: false,
    ...(controller === undefined ? {} : { controller }),
  };
  const settle = () => {
    shared.done = true;
  };
  record.then(settle, settle);
  const leave = joinShared(shared, deps.signal);
  pending?.set(id, shared);
  try {
    const settled = await untilAborted(record, deps.signal);
    // The assessment the service returned is authoritative only for the
    // record it returned: if the store already held a different observation
    // at this address, that one is what everyone reads.
    return judged !== undefined && judged.record === settled
      ? { record: settled, judged }
      : { record: settled };
  } finally {
    leave();
    evict(pending, id, shared);
  }
}

/**
 * Drop a shared judgment once the last asker has stopped waiting.
 *
 * Not when its starter stops: a judgment whose starter aborted is still owed
 * to whoever joined it, and a later asker should join that one rather than
 * pay for the same answer again. The identity check keeps one run from
 * dropping an entry a later asker has already taken over.
 */
function evict(
  pending: Map<string, SharedJudgment> | undefined,
  id: string,
  shared: SharedJudgment,
): void {
  if (shared.waiters === 0 && pending?.get(id) === shared) pending.delete(id);
}

/**
 * Write the observation down, and take the store's word for it on a collision.
 *
 * Records are append-only, so a `put` that loses a race against another
 * worker's write of the *same* address throws rather than overwriting. That
 * is not a reason to fail the batch: the judgment at that address is already
 * recorded, and the recorded one is the observation — this run's answer to
 * the same question arrived second. It is read back, checked exactly as a
 * cache hit is, and used; a store that answers the re-read with someone
 * else's record, or with an answer to another rubric, is as loud here as it
 * is on the way in. A `put` that fails for any other reason (a misfiled
 * record, a store that is down) leaves nothing at the address and is
 * re-thrown.
 */
async function recordJudgment(
  store: JevJudgmentStore | undefined,
  record: JevJudgmentRecord,
  expected: RecordExpectation,
): Promise<JevJudgmentRecord> {
  if (store === undefined) return record;
  try {
    await store.put(record);
    return record;
  } catch (error) {
    // `?? null` for the same reason the hit path has it: a store that answers
    // an empty address with `undefined` is answering "nothing is recorded
    // here", and the write failure is what the caller needs to hear about.
    const recorded = (await store.get(record.id)) ?? null;
    if (recorded === null) throw error;
    return assertRecordedFor(recorded, expected);
  }
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
