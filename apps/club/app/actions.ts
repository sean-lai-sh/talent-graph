"use server";

import type {
  ComparisonOutcome,
  Dimension,
  EvidenceType,
  PersonStatus,
  Scale5,
} from "../../../src/domain/types.ts";
import {
  addComparison,
  addReferral,
  loadClub,
  meddleReferral,
  resetClub,
  setNow,
  setStatus,
} from "../lib/engine.ts";
import type { ClubState, EngineResult } from "../lib/types.ts";

export async function actionLoad(): Promise<EngineResult> {
  return loadClub();
}

export async function actionReset(): Promise<EngineResult> {
  return resetClub();
}

export async function actionSetNow(state: ClubState, now: string): Promise<EngineResult> {
  return setNow(state, now);
}

export async function actionSetStatus(
  state: ClubState,
  personId: string,
  status: PersonStatus,
): Promise<EngineResult> {
  return setStatus(state, personId, status);
}

export async function actionAddReferral(
  state: ClubState,
  input: {
    referrerId: string;
    candidateId: string;
    conviction: Scale5;
    confidence: Scale5;
    relationshipDepth: Scale5;
    evidenceType: EvidenceType;
    evidenceText: string;
  },
): Promise<EngineResult> {
  return addReferral(state, input);
}

export async function actionMeddleReferral(
  state: ClubState,
  referralId: string,
  patch: { conviction: Scale5; confidence: Scale5; relationshipDepth: Scale5 },
): Promise<EngineResult> {
  return meddleReferral(state, referralId, patch);
}

export async function actionAddComparison(
  state: ClubState,
  input: {
    personAId: string;
    personBId: string;
    dimension: Dimension;
    outcome: ComparisonOutcome;
  },
): Promise<EngineResult> {
  return addComparison(state, input);
}
