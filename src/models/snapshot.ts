/**
 * Prediction snapshots — decisions keep their provenance.
 *
 * A snapshot freezes the exact numbers a decision was made on, tied to the
 * ModelRun ids that produced them. Later spec versions recompute freely;
 * the snapshot never changes.
 */

import type { PredictionSnapshot } from "../domain/types.ts";
import { hashInputs } from "../modelRun.ts";

export interface CreateSnapshotInput {
  personId: string;
  modelRunIds: string[];
  /** e.g. { referralSignal: 78.3, "problem_solving.percentile": 93 } */
  values: Record<string, number | null>;
  decision?: string;
  now: Date;
}

export function createPredictionSnapshot(input: CreateSnapshotInput): PredictionSnapshot {
  if (input.modelRunIds.length === 0) {
    throw new Error("createPredictionSnapshot: at least one modelRunId is required");
  }
  const values = Object.freeze({ ...input.values });
  const modelRunIds = Object.freeze([...input.modelRunIds]) as string[];
  // Object.freeze does not freeze a Date's internal time value, so keep a
  // private copy rather than the caller's mutable instance.
  const createdAt = new Date(input.now.getTime());
  const id = `snap:${input.personId}:${hashInputs({ modelRunIds, values, at: createdAt }).slice(0, 16)}`;
  return Object.freeze({
    id,
    personId: input.personId,
    modelRunIds,
    values,
    decision: input.decision ?? null,
    createdAt,
  });
}
