import type { EvidenceType, Scale5 } from "../../../src/domain/types.ts";
import { validateReferral } from "../../../src/domain/validate.ts";
import { normalizedEmail } from "./memberFeedback.ts";
import { type NormalizedContact, type PersonMatch, SELF_ERROR } from "./referralSignup.ts";
import { clubToReferral } from "./serialize.ts";
import type { ClubPerson, ClubReferral, IsoDate } from "./types.ts";

export type ReferralAnswers = {
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
};

/** A `memberReferrals` row without its `clubId`. */
export type MemberLink = {
  referrerUserId: string;
  normalizedContact: string;
  personId: string;
  createdAt: IsoDate;
  tokenHash: string;
};

export type AnswersPlan =
  | { action: "rejected"; error: string }
  | {
      action: "insert";
      referral: ClubReferral;
      link?: MemberLink;
      clubNow: IsoDate | null;
    }
  | {
      action: "update";
      referralId: string;
      patch: ReferralAnswers & { updatedAt: IsoDate };
      link?: MemberLink;
      clubNow: IsoDate | null;
    };

export const AMBIGUOUS_REFERRER_ERROR =
  "Your account matches more than one person. Ask an admin to merge them.";
export const UNLINKED_MEMBER_ERROR =
  "Your account isn't linked to a member profile yet. Ask an admin to add your email.";
export const AMBIGUOUS_CANDIDATE_ERROR =
  "More than one profile has this contact. Ask an admin to merge them.";
const UNKNOWN_CANDIDATE_ERROR = "Refer this person first.";

/** Stored emails are as typed, so both sides are normalized before comparing. */
export function membersWithEmail<P extends Pick<ClubPerson, "status" | "email">>(
  people: readonly P[],
  email: string,
): P[] {
  const value = normalizedEmail(email);
  if (!value) return [];
  return people.filter(
    (person) => person.status === "member" && normalizedEmail(person.email) === value,
  );
}

export function newDomainId(prefix: string, nowMs: number): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const random = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${nowMs.toString(36)}-${random}`;
}

export function planReferralAnswers(input: {
  contact: NormalizedContact;
  candidate: PersonMatch;
  /** The signed-in member among the member rows, by session email. */
  referrer: PersonMatch;
  userId: string;
  existing: ClubReferral | null;
  linked: boolean;
  answers: ReferralAnswers;
  now: IsoDate;
  clubNow: IsoDate;
  referralId: string;
  tokenHash: string;
}): AnswersPlan {
  const { candidate, referrer, now } = input;
  if (candidate.kind === "none") return { action: "rejected", error: UNKNOWN_CANDIDATE_ERROR };
  if (candidate.kind === "ambiguous") {
    return { action: "rejected", error: AMBIGUOUS_CANDIDATE_ERROR };
  }
  const candidateId = candidate.personId;
  if (referrer.kind === "none") return { action: "rejected", error: UNLINKED_MEMBER_ERROR };
  if (referrer.kind === "ambiguous") return { action: "rejected", error: AMBIGUOUS_REFERRER_ERROR };
  if (referrer.personId === candidateId) {
    return { action: "rejected", error: SELF_ERROR };
  }

  const answers = { ...input.answers, evidenceText: input.answers.evidenceText.trim() };
  const referral: ClubReferral = input.existing
    ? { ...input.existing, ...answers, updatedAt: now }
    : {
        id: input.referralId,
        referrerId: referrer.personId,
        candidateId,
        ...answers,
        createdAt: now,
        updatedAt: now,
      };
  const valid = validateReferral(clubToReferral(referral));
  if (!valid.ok) return { action: "rejected", error: valid.errors.join("; ") };

  const link: MemberLink | undefined = input.linked
    ? undefined
    : {
        referrerUserId: input.userId,
        normalizedContact: input.contact.value,
        personId: candidateId,
        createdAt: now,
        tokenHash: input.tokenHash,
      };
  // `computeWorld` only counts referrals created by `club.now`, which otherwise
  // moves only on an admin write.
  const clubNow = Date.parse(now) > Date.parse(input.clubNow) ? now : null;

  if (input.existing) {
    return {
      action: "update",
      referralId: input.existing.id,
      patch: { ...answers, updatedAt: now },
      ...(link ? { link } : {}),
      clubNow,
    };
  }
  return {
    action: "insert",
    referral,
    ...(link ? { link } : {}),
    clubNow,
  };
}
