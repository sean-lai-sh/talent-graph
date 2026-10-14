"use server";

import { exampleBoard } from "../../lib/exampleScore.ts";

/** Restore the fixture and score it again. Does not call generateSeed. */
export async function actionExampleReset() {
  return exampleBoard();
}
