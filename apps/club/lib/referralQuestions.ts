/**
 * Q1–Q3 copy for the member referral. The chip values are the enums
 * `saveMemberReferralAnswers` already accepts. Display labels that differ
 * from those enums (length and group size) are the questionnaire's words.
 */

import { EMPTY_OBSERVATION_ERROR } from "./memberReferral.ts";
import type {
  MemberReferralAnswers,
  ReferralQ1Context,
  ReferralQ1Length,
  ReferralQ1Stake,
  ReferralQ2Role,
  ReferralQ3GroupSize,
  ReferralQ3Rank,
  ReferralRecognition,
} from "./types.ts";
import {
  REFERRAL_Q1_CONTEXTS,
  REFERRAL_Q1_LENGTHS,
  REFERRAL_Q1_STAKES,
  REFERRAL_Q2_ROLES,
  REFERRAL_Q3_GROUP_SIZES,
  REFERRAL_Q3_RANKS,
} from "./types.ts";

export const Q2_SOFT_LIMIT = 280;

export const Q1_LENGTH_CHOICES: readonly { label: string; value: ReferralQ1Length }[] = [
  { label: "<3 months", value: "under 3 months" },
  { label: "3-12 months", value: "3 to 12 months" },
  { label: "1-2 years", value: "1 to 2 years" },
  { label: "2+ years", value: "2+ years" },
];

export const Q3_GROUP_CHOICES: readonly { label: string; value: ReferralQ3GroupSize }[] = [
  { label: "<10", value: "under 10" },
  { label: "10-30", value: "10 to 30" },
  { label: "30-100", value: "30 to 100" },
  { label: "100+", value: "100+" },
];

export const RECOGNITION_CHOICES: readonly { label: string; value: ReferralRecognition }[] = [
  { label: "Not yet", value: "not_yet" },
  { label: "Soon", value: "soon" },
  { label: "Yes", value: "yes" },
  { label: "Not sure", value: "not_sure" },
];

export function recognitionPrompt(name: string): string {
  return `Has ${name} received the recognition they deserve?`;
}

export const Q1_CONTEXTS: readonly ReferralQ1Context[] = REFERRAL_Q1_CONTEXTS;
export const Q1_STAKES: readonly ReferralQ1Stake[] = REFERRAL_Q1_STAKES;
export const Q2_ROLES: readonly ReferralQ2Role[] = REFERRAL_Q2_ROLES;
export const Q3_RANKS: readonly ReferralQ3Rank[] = REFERRAL_Q3_RANKS;

export function q1Know(name: string): string {
  return `How do you know ${name}? Pick the closest one.`;
}

export const Q1_LENGTH = "For how long?";

export const Q1_STAKE = "Was something real on the line?";

export function q2Prompt(name: string): string {
  return `Describe one specific thing you saw ${name} build, decide, or fix.`;
}

export const Q2_WHAT = "What was it?";
export const Q2_HARD = "What made it hard?";

export function q2Distinct(name: string): string {
  return `What did ${name} do that others wouldn't have?`;
}

export function q2Role(name: string): string {
  return `${name}'s part was...`;
}

export function q3Group(context: string): string {
  return `Think of everyone you've worked closely with in ${context}. About how many people is that?`;
}

export const Q3_CONTEXT_PENDING = "the context you picked above";

export function q3Rank(name: string): string {
  return `Where does ${name} fall?`;
}

export const ANSWER_EACH_QUESTION = "Answer each question before continuing.";

export type QuestionDraft = {
  context: ReferralQ1Context | null;
  length: ReferralQ1Length | null;
  stakes: ReferralQ1Stake[];
  what: string;
  hard: string;
  distinct: string;
  role: ReferralQ2Role | null;
  groupSize: ReferralQ3GroupSize | null;
  rank: ReferralQ3Rank | null;
  recognition: ReferralRecognition | null;
};

export function emptyQuestionDraft(): QuestionDraft {
  return {
    context: null,
    length: null,
    stakes: [],
    what: "",
    hard: "",
    distinct: "",
    role: null,
    groupSize: null,
    rank: null,
    recognition: null,
  };
}

/** Empty observation text blocks Continue. Missing chips do too, after that. */
export function questionsContinueError(draft: QuestionDraft): string | null {
  if (draft.what.trim() === "" || draft.hard.trim() === "" || draft.distinct.trim() === "") {
    return EMPTY_OBSERVATION_ERROR;
  }
  if (
    draft.context === null ||
    draft.length === null ||
    draft.stakes.length === 0 ||
    draft.role === null ||
    draft.groupSize === null ||
    draft.rank === null
  ) {
    return ANSWER_EACH_QUESTION;
  }
  return null;
}

export function questionsToAnswers(draft: QuestionDraft): MemberReferralAnswers | null {
  if (questionsContinueError(draft) !== null) return null;
  if (
    draft.context === null ||
    draft.length === null ||
    draft.role === null ||
    draft.groupSize === null ||
    draft.rank === null
  ) {
    return null;
  }
  const stakes = draft.stakes.filter((stake): stake is ReferralQ1Stake =>
    (REFERRAL_Q1_STAKES as readonly string[]).includes(stake),
  );
  if (
    !(REFERRAL_Q1_LENGTHS as readonly string[]).includes(draft.length) ||
    !(REFERRAL_Q3_GROUP_SIZES as readonly string[]).includes(draft.groupSize)
  ) {
    return null;
  }
  return {
    context: draft.context,
    length: draft.length,
    stakes,
    what: draft.what.trim(),
    hard: draft.hard.trim(),
    distinct: draft.distinct.trim(),
    role: draft.role,
    rank: draft.rank,
    groupSize: draft.groupSize,
    recognition: draft.recognition ?? "not_sure",
  };
}
