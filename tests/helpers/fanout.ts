/**
 * The ten-item batch the fan-out suites run over, and the instrumented and
 * gated services that watch it.
 *
 * Shared rather than copied: the hold is a deterministic per-item delay that
 * *decreases* with the item's position, so later items finish before earlier
 * ones and a pool that appended results in completion order would scramble
 * them. A second copy of that rule would let one suite's idea of "in order"
 * drift from another's.
 */

import type { JevJudgmentService } from "../../src/index.ts";
import { processEvidence } from "../../src/index.ts";
import type { EvidenceRuntime, ProcessEvidenceResult } from "../../src/longitudinal/policy.ts";
import type { FakeJudgments } from "./longitudinal.ts";
import { acceptingJudgments, day, evidence, identity, serviceOf } from "./longitudinal.ts";

/** Ten evidence items, one per day, each judged under a decreasing hold. */
export const tenItems = Array.from({ length: 10 }, (_, index) =>
  evidence(`item-${index}`, index + 1),
);

const holdMs = (sourceId: string) => tenItems.length - Number(sourceId.split("-")[1]);

/** An accepting service that reports the peak number of calls in flight. */
export function instrumented(): { service: JevJudgmentService; peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  const hold = async (sourceId: string) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, holdMs(sourceId)));
    inFlight -= 1;
  };
  return {
    peak: () => peak,
    service: serviceOf({
      async assessIdentity(canonical, item) {
        await hold(item.sourceId);
        return acceptingJudgments.assessIdentity(canonical, item);
      },
      async assessClaim(item) {
        await hold(item.sourceId);
        return acceptingJudgments.assessClaim(item);
      },
    }),
  };
}

/** `processEvidence` over `tenItems`, with every number stated here. */
export const runTenItems = (
  judgments: JevJudgmentService,
  runtime?: EvidenceRuntime,
): Promise<ProcessEvidenceResult> =>
  processEvidence({
    identity,
    evidence: tenItems,
    cutoffAt: day(90),
    retrievedAt: day(100),
    pipelineVersion: "1",
    judgments,
    ...(runtime === undefined ? {} : { runtime }),
  });

/** A service whose identity call throws for one item, before any claim. */
export const failingIdentity: FakeJudgments = {
  ...acceptingJudgments,
  async assessIdentity(canonical, item) {
    if (item.sourceId === "item-7") throw new Error("jev identity 500");
    return acceptingJudgments.assessIdentity(canonical, item);
  },
};

/** A service whose claim call throws for one item, after identity settled. */
export const failingClaim: FakeJudgments = {
  ...acceptingJudgments,
  async assessClaim(item) {
    if (item.sourceId === "item-7") throw new Error("jev 500");
    return acceptingJudgments.assessClaim(item);
  },
};
