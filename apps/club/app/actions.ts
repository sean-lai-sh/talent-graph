"use server";

import {
  addPerson,
  anyReferrerDecided,
  decide,
  loadClub,
  recordFeedback,
  requestFeedback,
  resetClub,
  setReviewConfig,
} from "../lib/engine.ts";
import { roundAverageOf } from "../lib/format.ts";
import type {
  AddPersonInput,
  ClubState,
  Decision,
  EngineResult,
  RecordFeedbackInput,
  RequestFeedbackInput,
  SetReviewConfigInput,
} from "../lib/types.ts";

/** In-memory example. Nothing persists; the whole state rides along with each call. */

function withRoundAverage(result: EngineResult): EngineResult {
  return { ...result, roundAverage: roundAverageOf(result.view.people) };
}

export async function actionLoad(): Promise<EngineResult> {
  return withRoundAverage(loadClub());
}

export async function actionReset(): Promise<EngineResult> {
  return withRoundAverage(resetClub());
}

export async function actionAddPerson(
  state: ClubState,
  input: AddPersonInput,
): Promise<EngineResult> {
  return withRoundAverage(addPerson(state, input));
}

export async function actionDecide(
  state: ClubState,
  personId: string,
  decision: Decision,
): Promise<EngineResult> {
  return withRoundAverage(
    decide(state, personId, decision, undefined, anyReferrerDecided(state, personId)),
  );
}

export async function actionRequestFeedback(
  state: ClubState,
  input: RequestFeedbackInput,
): Promise<EngineResult> {
  return withRoundAverage(requestFeedback(state, input));
}

export async function actionRecordFeedback(
  state: ClubState,
  input: RecordFeedbackInput,
): Promise<EngineResult> {
  return withRoundAverage(recordFeedback(state, input));
}

export async function actionSetReviewConfig(
  state: ClubState,
  input: SetReviewConfigInput,
): Promise<EngineResult> {
  return withRoundAverage(setReviewConfig(state, input));
}
