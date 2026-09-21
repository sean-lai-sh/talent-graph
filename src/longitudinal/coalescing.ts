/**
 * One judgment, however many askers there are.
 *
 * Two runs over the same store, or the same item twice in one batch, ask for
 * the same observation: they share the request rather than each buying it.
 * What askers share is the observation and, deliberately, its absence; what
 * they do not share is a cancellation.
 *
 * The fan-out shape around this — the concurrency cap and per-item isolation —
 * is `./pipeline.ts`; the checks on what a store hands back are
 * `./expectations.ts`.
 */

import type { RecordExpectation } from "./expectations.ts";
import { assertRecordedFor, recordedJudgment, recordJudgment } from "./expectations.ts";
import type { JevJudgment, JevJudgmentService, JevRequestOptions } from "./judgments.ts";
import type { JevJudgmentRecord } from "./records.ts";
import type { JevJudgmentStore } from "./store.ts";

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
export function pendingFor(store: JevJudgmentStore): Map<string, SharedJudgment> {
  const existing = IN_FLIGHT_BY_STORE.get(store);
  if (existing !== undefined) return existing;
  const created = new Map<string, SharedJudgment>();
  IN_FLIGHT_BY_STORE.set(store, created);
  return created;
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
export async function coalesce<TAssessment>(
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
