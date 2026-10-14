import type { Dimension, RubricScore, Scale5 } from "../../../src/domain/types.ts";
import type { IsoDate } from "./types.ts";

export const OBSERVATION_REQUIRED = "Write what you observed.";

export type FeedbackInboxItem = {
  id: string;
  candidateId: string;
  candidateName: string;
  note: string;
  requestedAt: IsoDate;
  dueAt: IsoDate;
  state: "pending" | "overdue";
  dueLabel: string;
};

export type MemberResponseDraft = {
  requestId: string;
  dimension: Dimension;
  score: RubricScore | null;
  confidence: Scale5 | null;
  evidenceText: string;
};

/** Empty observation copy for the form. The mutation repeats the check. */
export function memberResponseFormError(evidenceText: string): string | null {
  if (evidenceText.trim() === "") return OBSERVATION_REQUIRED;
  return null;
}
