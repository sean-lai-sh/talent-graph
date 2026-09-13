"use server";

import {
  addPerson,
  decide,
  loadClub,
  recordFeedback,
  requestFeedback,
  resetClub,
  setReviewConfig,
} from "../lib/engine.ts";
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

export async function actionLoad(): Promise<EngineResult> {
  return loadClub();
}

export async function actionReset(): Promise<EngineResult> {
  return resetClub();
}

export async function actionAddPerson(
  state: ClubState,
  input: AddPersonInput,
): Promise<EngineResult> {
  return addPerson(state, input);
}

export async function actionDecide(
  state: ClubState,
  personId: string,
  decision: Decision,
): Promise<EngineResult> {
  return decide(state, personId, decision);
}

export async function actionRequestFeedback(
  state: ClubState,
  input: RequestFeedbackInput,
): Promise<EngineResult> {
  return requestFeedback(state, input);
}

export async function actionRecordFeedback(
  state: ClubState,
  input: RecordFeedbackInput,
): Promise<EngineResult> {
  return recordFeedback(state, input);
}

export async function actionSetReviewConfig(
  state: ClubState,
  input: SetReviewConfigInput,
): Promise<EngineResult> {
  return setReviewConfig(state, input);
}
