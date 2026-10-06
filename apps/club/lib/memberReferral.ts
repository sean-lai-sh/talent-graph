/**
 * Member Q1–Q3 answers become one engine referral. The numeric table lives
 * only here. Validation of the resulting referral stays in `addReferral`.
 */

import type { EvidenceType, Scale5 } from "../../../src/domain/types.ts";
import { addReferral } from "./engine.ts";
import { memberEmailIsAmbiguous, resolveMemberPersonId } from "./memberIdentity.ts";
import { type NormalizedContact, parseContact, peopleWithContact } from "./referralSignup.ts";
import type {
  ClubPerson,
  ClubState,
  IsoDate,
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
  REFERRAL_RECOGNITIONS,
} from "./types.ts";

export const NOT_LINKED_ERROR =
  "Your account is not linked to a member profile yet. Ask the council.";
export const AMBIGUOUS_MEMBER_ERROR =
  "Your account matches more than one member profile. Ask the council to merge them.";
export const NOT_YOUR_REFERRAL_ERROR = "You have not referred this person.";
export const NO_CONTACT_ERROR = "This person has no email or phone on file. Ask the council.";
export const AMBIGUOUS_CONTACT_ERROR =
  "More than one profile has this contact. Ask the council to merge them.";
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

/** The `memberReferrals` row to add when the member had not referred this person before. */
export type MemberReferralLink = { normalizedContact: string };

export type MemberReferralWrite =
  | { ok: true; state: ClubState; link: MemberReferralLink | null }
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
  recognition?: string | undefined;
}): MemberReferralAnswers | null {
  if (!includes(REFERRAL_Q1_CONTEXTS, raw.context)) return null;
  if (!includes(REFERRAL_Q1_LENGTHS, raw.length)) return null;
  if (!includes(REFERRAL_Q2_ROLES, raw.role)) return null;
  if (!includes(REFERRAL_Q3_RANKS, raw.rank)) return null;
  if (!includes(REFERRAL_Q3_GROUP_SIZES, raw.groupSize)) return null;
  const recognition = raw.recognition ?? "not_sure";
  if (!includes(REFERRAL_RECOGNITIONS, recognition)) return null;
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
    recognition,
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

function contactOf(person: ClubPerson): NormalizedContact | null {
  for (const raw of [person.email, person.phone]) {
    if (!raw) continue;
    const parsed = parseContact(raw);
    if (parsed.ok) return parsed.contact;
  }
  return null;
}

function laterOf(a: IsoDate, b: IsoDate): IsoDate {
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Resolve the member, map the answers, and run `addReferral`. An error
 * returns the input state unchanged so the caller writes nothing.
 *
 * `input.state.now` is the stored `club.now`. The referral is created at
 * `submittedAt`, and `now` only moves forward to it: `computeView` counts
 * referrals created by `now`, and nothing else advances the clock until
 * the next admin write.
 *
 * A second save for the same candidate replaces the member's referral in
 * place (same id, same `createdAt`). A person the member had not referred
 * yet gets a `link` for the caller to store as a `memberReferrals` row.
 */
export function commitMemberReferral(input: {
  state: ClubState;
  email: string;
  candidateId: string;
  referredByUser: boolean;
  answers: MemberReferralAnswers;
  submittedAt: IsoDate;
}): MemberReferralWrite {
  const fail = (error: string): MemberReferralWrite => ({ ok: false, error, state: input.state });
  let link: MemberReferralLink | null = null;
  if (!input.referredByUser) {
    const candidate = input.state.people.find((person) => person.id === input.candidateId);
    if (!candidate) return fail(NOT_YOUR_REFERRAL_ERROR);
    const contact = contactOf(candidate);
    if (contact === null) return fail(NO_CONTACT_ERROR);
    // The memberReferrals row is looked up by contact, so it has to name one person.
    if (peopleWithContact(input.state.people, contact).length > 1) {
      return fail(AMBIGUOUS_CONTACT_ERROR);
    }
    link = { normalizedContact: contact.value };
  }
  const member = resolveMemberPersonId(input.state, input.email);
  if (member.status !== "linked") {
    return fail(
      memberEmailIsAmbiguous(input.state, input.email) ? AMBIGUOUS_MEMBER_ERROR : NOT_LINKED_ERROR,
    );
  }
  const mapped = referralAnswersToEngine(input.answers);
  if (!mapped.ok) return fail(mapped.error);
  const isPair = (row: { referrerId: string; candidateId: string }) =>
    row.referrerId === member.personId && row.candidateId === input.candidateId;
  const existing = input.state.referrals.find(isPair);
  const result = addReferral(
    {
      ...input.state,
      now: input.submittedAt,
      referrals: input.state.referrals.filter((row) => row !== existing),
    },
    {
      referrerId: member.personId,
      candidateId: input.candidateId,
      conviction: mapped.referral.conviction,
      confidence: mapped.referral.confidence,
      relationshipDepth: mapped.referral.relationshipDepth,
      evidenceType: mapped.referral.evidenceType,
      evidenceText: mapped.referral.evidenceText,
      // A member's own referral. An existing row keeps the origin it had, so
      // a member who interviewed the candidate stays an interview yes.
      origin: existing?.origin ?? "referral",
      recognition: input.answers.recognition ?? "not_sure",
    },
  );
  if (result.error !== undefined) return fail(result.error);
  const referrals = existing
    ? result.state.referrals.map((row) =>
        isPair(row)
          ? {
              ...row,
              id: existing.id,
              createdAt: existing.createdAt,
              updatedAt: laterOf(existing.createdAt, row.updatedAt),
            }
          : row,
      )
    : result.state.referrals;
  return {
    ok: true,
    state: { ...result.state, referrals, now: laterOf(input.state.now, input.submittedAt) },
    link,
  };
}
