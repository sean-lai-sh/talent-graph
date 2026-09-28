/**
 * Member Q1–Q3 answers become one engine referral. The numeric table lives
 * only here. Validation of the resulting referral stays in `addReferral`.
 */

import type { EvidenceType, Scale5 } from "../../../src/domain/types.ts";
import { addReferral } from "./engine.ts";
import { resolveMemberPersonId } from "./memberIdentity.ts";
import type {
  ClubState,
  MemberReferralAnswers,
  ReferralQ1Context,
  ReferralQ1Length,
  ReferralQ1Stake,
  ReferralQ2Role,
  ReferralQ3GroupSize,
  ReferralQ3Rank,
} from "./types.ts";
import {
  REFERRAL_Q1_CONTEXTS,
  REFERRAL_Q1_LENGTHS,
  REFERRAL_Q1_STAKES,
  REFERRAL_Q2_ROLES,
  REFERRAL_Q3_GROUP_SIZES,
  REFERRAL_Q3_RANKS,
} from "./types.ts";

export const NOT_LINKED_ERROR =
  "Your account is not linked to a member profile yet. Ask the council.";
export const NOT_YOUR_REFERRAL_ERROR = "You have not referred this person.";
export const EMPTY_OBSERVATION_ERROR = "Describe one specific thing you saw.";

const HEARD_ONLY: ReferralQ2Role = "I only heard about it";

const CONTEXT: Record<ReferralQ1Context, { evidenceType: EvidenceType; depth: number }> = {
  "Built something together with a deadline": { evidenceType: "firsthand_work", depth: 4 },
  "Same team at work, internship, or research": { evidenceType: "firsthand_work", depth: 4 },
  "Class project": { evidenceType: "firsthand_work", depth: 3 },
  "Same club or org, different projects": { evidenceType: "firsthand_personal", depth: 2 },
  "Friends, haven't worked together": { evidenceType: "firsthand_personal", depth: 2 },
  "Know their work online": { evidenceType: "artifact", depth: 1 },
  "Heard about them from others": { evidenceType: "reputation", depth: 1 },
};

const LENGTH_DELTA: Record<ReferralQ1Length, number> = {
  "under 3 months": -1,
  "3 to 12 months": 0,
  "1 to 2 years": 0,
  "2+ years": 1,
};

const REAL_STAKE = new Set<ReferralQ1Stake>([
  "Grade",
  "Money",
  "Real users",
  "A ship date or competition",
]);

const RANK_CONVICTION: Record<ReferralQ3Rank, Scale5> = {
  "The best of them": 5,
  "Top 5%": 5,
  "Top 20%": 4,
  "Top half": 3,
  "Hard to say": 2,
};

const GROUP_CONFIDENCE: Record<ReferralQ3GroupSize, Scale5> = {
  "under 10": 2,
  "10 to 30": 3,
  "30 to 100": 4,
  "100+": 5,
};

const Q2_LINES: readonly [label: string, field: "what" | "hard" | "distinct"][] = [
  ["What was it?", "what"],
  ["What made it hard?", "hard"],
  ["What did they do that others wouldn't have?", "distinct"],
];

export type EngineReferralFields = {
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
};

export type ReferralAnswersResult =
  | { ok: true; referral: EngineReferralFields }
  | { ok: false; error: string };

export type MemberReferralWrite =
  | { ok: true; state: ClubState }
  | { ok: false; error: string; state: ClubState };

export const ANSWERS_REJECTED_ERROR = "Those answers do not match the referral questions.";

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** Narrow a Convex payload using the same chip lists the validator was built from. */
export function memberReferralAnswers(raw: {
  context: string;
  length: string;
  stakes: readonly string[];
  what: string;
  hard: string;
  distinct: string;
  role: string;
  rank: string;
  groupSize: string;
}): MemberReferralAnswers | null {
  if (!includes(REFERRAL_Q1_CONTEXTS, raw.context)) return null;
  if (!includes(REFERRAL_Q1_LENGTHS, raw.length)) return null;
  if (!includes(REFERRAL_Q2_ROLES, raw.role)) return null;
  if (!includes(REFERRAL_Q3_RANKS, raw.rank)) return null;
  if (!includes(REFERRAL_Q3_GROUP_SIZES, raw.groupSize)) return null;
  const stakes: ReferralQ1Stake[] = [];
  for (const stake of raw.stakes) {
    if (!includes(REFERRAL_Q1_STAKES, stake)) return null;
    stakes.push(stake);
  }
  return {
    context: raw.context,
    length: raw.length,
    stakes,
    what: raw.what,
    hard: raw.hard,
    distinct: raw.distinct,
    role: raw.role,
    rank: raw.rank,
    groupSize: raw.groupSize,
  };
}

function clampDepth(value: number): Scale5 {
  if (value <= 1) return 1;
  if (value >= 5) return 5;
  if (value === 2 || value === 3 || value === 4) return value;
  throw new Error(`relationship depth ${value} is not an integer in 1..5`);
}

function confidenceFor(rank: ReferralQ3Rank, groupSize: ReferralQ3GroupSize): Scale5 {
  const confidence = GROUP_CONFIDENCE[groupSize];
  if (rank !== "Hard to say" || confidence <= 2) return confidence;
  return 2;
}

function evidenceText(answers: MemberReferralAnswers): string | null {
  const lines = Q2_LINES.map(([label, field]) => ({ label, text: answers[field].trim() }));
  if (lines.every((line) => line.text === "")) return null;
  return lines.map((line) => `${line.label}: ${line.text}`).join("\n");
}

export function referralAnswersToEngine(answers: MemberReferralAnswers): ReferralAnswersResult {
  const text = evidenceText(answers);
  if (text === null) return { ok: false, error: EMPTY_OBSERVATION_ERROR };
  const context = CONTEXT[answers.context];
  const stake = answers.stakes.some((item) => REAL_STAKE.has(item)) ? 1 : 0;
  const evidenceType = answers.role === HEARD_ONLY ? "reputation" : context.evidenceType;
  return {
    ok: true,
    referral: {
      conviction: RANK_CONVICTION[answers.rank],
      confidence: confidenceFor(answers.rank, answers.groupSize),
      relationshipDepth: clampDepth(context.depth + LENGTH_DELTA[answers.length] + stake),
      evidenceType,
      evidenceText: text,
    },
  };
}

/**
 * Resolve the member, map the answers, and run `addReferral`. An error
 * returns the input state unchanged so the caller writes nothing.
 */
export function commitMemberReferral(input: {
  state: ClubState;
  email: string;
  candidateId: string;
  referredByUser: boolean;
  answers: MemberReferralAnswers;
}): MemberReferralWrite {
  if (!input.referredByUser) {
    return { ok: false, error: NOT_YOUR_REFERRAL_ERROR, state: input.state };
  }
  const link = resolveMemberPersonId(input.state, input.email);
  if (link.status !== "linked") {
    return { ok: false, error: NOT_LINKED_ERROR, state: input.state };
  }
  const mapped = referralAnswersToEngine(input.answers);
  if (!mapped.ok) return { ok: false, error: mapped.error, state: input.state };
  const result = addReferral(input.state, {
    referrerId: link.personId,
    candidateId: input.candidateId,
    conviction: mapped.referral.conviction,
    confidence: mapped.referral.confidence,
    relationshipDepth: mapped.referral.relationshipDepth,
    evidenceType: mapped.referral.evidenceType,
    evidenceText: mapped.referral.evidenceText,
  });
  if (result.error !== undefined) {
    return { ok: false, error: result.error, state: input.state };
  }
  return { ok: true, state: result.state };
}
