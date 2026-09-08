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
  const id = `snap:${input.personId}:${hashInputs({ modelRunIds, values, at: input.now }).slice(0, 16)}`;
  return Object.freeze({
    id,
    personId: input.personId,
    modelRunIds,
    values,
    decision: input.decision ?? null,
    createdAt: input.now,
  });
}
