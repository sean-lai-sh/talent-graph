"use server";

import type { Dimension } from "../../../../src/domain/types.ts";
import { placePreview, startPreviewFrom } from "../../components/referral/previewLadder.ts";
import { exampleBoard, exampleInputs } from "../../lib/exampleScore.ts";
import type { LadderPlacement } from "../../lib/ladderPlacement.ts";

/** Restore the fixture and score it again. Does not call generateSeed. */
export async function actionExampleReset() {
  return exampleBoard();
}

/**
 * Ladder anchors for the public demo. The engine runs here.
 * The client receives the view (names and prompts), not weights.
 */
export async function actionStartExamplePreview(personId: string, name: string) {
  const started = startPreviewFrom(exampleInputs(), personId, name);
  if ("error" in started) return started;
  return started.view;
}

/** Replay the visitor's placements on the fixture. The returned value has no weights. */
export async function actionPlaceExamplePreview(input: {
  personId: string;
  name: string;
  steps: { dimension: Dimension; placement: LadderPlacement }[];
}) {
  const started = startPreviewFrom(exampleInputs(), input.personId, input.name);
  if ("error" in started) return { error: started.error };
  let bundle = started;
  for (const step of input.steps) {
    const placed = placePreview(bundle, step.dimension, step.placement);
    if (!placed.ok) return { error: placed.error };
    bundle = placed.bundle;
  }
  return { ok: true as const };
}
