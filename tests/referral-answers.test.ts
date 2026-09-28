import { describe, expect, test } from "bun:test";
import {
  AMBIGUOUS_REFERRER_ERROR,
  membersWithEmail,
  newDomainId,
  planReferralAnswers,
  resolveReferrer,
  UNLINKED_MEMBER_ERROR,
} from "../apps/club/lib/referralAnswers.ts";
import { SELF_ERROR } from "../apps/club/lib/referralSignup.ts";
import type { ClubReferral } from "../apps/club/lib/types.ts";

const NOW = "2026-09-28T12:00:00.000Z";
const EARLIER = "2026-09-20T09:00:00.000Z";

const answers = {
  conviction: 5,
  confidence: 4,
  relationshipDepth: 3,
  evidenceType: "firsthand_work",
  evidenceText: "  Shipped the parser rewrite with me.  ",
} as const;

type Input = Parameters<typeof planReferralAnswers>[0];

function plan(overrides: Partial<Input> = {}) {
  return planReferralAnswers({
    contact: { kind: "email", value: "ada@example.com" },
    candidateId: "p-ada",
    referrer: { kind: "person", personId: "p-grace" },
    userId: "user-grace",
    existing: null,
    linked: true,
    answers,
    now: NOW,
    clubNow: EARLIER,
    referralId: "ref-new",
    tokenHash: "hash-new",
    ...overrides,
  });
}

const stored: ClubReferral = {
  id: "ref-old",
  referrerId: "p-grace",
  candidateId: "p-ada",
  conviction: 2,
  confidence: 2,
  relationshipDepth: 2,
  evidenceType: "reputation",
  evidenceText: "Heard good things.",
  createdAt: EARLIER,
  updatedAt: EARLIER,
};

describe("planReferralAnswers", () => {
  test("inserts one referral from the member's person to the candidate", () => {
    expect(plan()).toEqual({
      action: "insert",
      referral: {
        id: "ref-new",
        referrerId: "p-grace",
        candidateId: "p-ada",
        conviction: 5,
        confidence: 4,
        relationshipDepth: 3,
        evidenceType: "firsthand_work",
        evidenceText: "Shipped the parser rewrite with me.",
        createdAt: NOW,
        updatedAt: NOW,
      },
      clubNow: NOW,
    });
  });

  test("a re-submit updates the same referral and keeps its createdAt", () => {
    const result = plan({ existing: stored });
    expect(result).toEqual({
      action: "update",
      referralId: "ref-old",
      patch: {
        conviction: 5,
        confidence: 4,
        relationshipDepth: 3,
        evidenceType: "firsthand_work",
        evidenceText: "Shipped the parser rewrite with me.",
        updatedAt: NOW,
      },
      clubNow: NOW,
    });
    expect(result).not.toHaveProperty("patch.createdAt");
  });

  test("a member with no member profile is rejected and nothing is written", () => {
    expect(plan({ referrer: { kind: "none" } })).toEqual({
      action: "rejected",
      error: UNLINKED_MEMBER_ERROR,
    });
  });

  test("rejects when the member's email matches more than one person", () => {
    expect(plan({ referrer: { kind: "ambiguous" } })).toEqual({
      action: "rejected",
      error: AMBIGUOUS_REFERRER_ERROR,
    });
  });

  test("rejects a member referring their own person", () => {
    expect(plan({ referrer: { kind: "person", personId: "p-ada" } })).toEqual({
      action: "rejected",
      error: SELF_ERROR,
    });
  });

  test("rejects a contact with no person behind it", () => {
    expect(plan({ candidateId: null }).action).toBe("rejected");
  });

  test("rejects an out-of-range slider through validateReferral", () => {
    const result = plan({ answers: { ...answers, conviction: 6 as 5 } });
    expect(result).toEqual({ action: "rejected", error: "conviction must be an integer in 1..5" });
  });

  test("rejects blank evidence through validateReferral", () => {
    expect(plan({ answers: { ...answers, evidenceText: "   " } })).toEqual({
      action: "rejected",
      error: "evidenceText must be non-empty",
    });
  });

  test("the exists path adds a status link for this member", () => {
    const result = plan({ linked: false });
    expect(result).toMatchObject({
      action: "insert",
      link: {
        referrerUserId: "user-grace",
        normalizedContact: "ada@example.com",
        personId: "p-ada",
        createdAt: NOW,
        tokenHash: "hash-new",
      },
    });
  });

  test("an update without a link adds one too", () => {
    expect(plan({ existing: stored, linked: false })).toMatchObject({
      action: "update",
      link: { personId: "p-ada", tokenHash: "hash-new" },
    });
  });

  test("the create path, already linked by signup, adds no second link", () => {
    expect(plan({ linked: true })).not.toHaveProperty("link");
    expect(plan({ existing: stored, linked: true })).not.toHaveProperty("link");
  });

  test("club.now moves forward to the referral, never back", () => {
    expect(plan({ clubNow: EARLIER })).toMatchObject({ clubNow: NOW });
    expect(plan({ clubNow: NOW })).toMatchObject({ clubNow: null });
    expect(plan({ clubNow: "2026-10-01T00:00:00.000Z" })).toMatchObject({ clubNow: null });
  });
});

describe("membersWithEmail", () => {
  const people = [
    { id: "p-grace", status: "member", email: "  Grace@Example.COM " },
    { id: "p-grace-candidate", status: "candidate", email: "grace@example.com" },
    { id: "p-ada", status: "member", email: "ada@example.com" },
    { id: "p-no-email", status: "member" },
  ] as const;

  test("a mixed-case stored email still matches the session email", () => {
    expect(membersWithEmail(people, "grace@example.com").map((p) => p.id)).toEqual(["p-grace"]);
  });

  test("a non-member person with the member's email does not count as the referrer", () => {
    const onlyCandidate = people.filter((p) => p.id === "p-grace-candidate");
    expect(resolveReferrer(membersWithEmail(onlyCandidate, "grace@example.com"))).toEqual({
      kind: "none",
    });
  });

  test("a blank session email matches no member, even one without an email", () => {
    expect(membersWithEmail(people, "  ")).toEqual([]);
  });
});

describe("resolveReferrer", () => {
  test("one, none, or several people with the member's email", () => {
    expect(resolveReferrer([{ id: "p-grace" }])).toEqual({ kind: "person", personId: "p-grace" });
    expect(resolveReferrer([])).toEqual({ kind: "none" });
    expect(resolveReferrer([{ id: "p-1" }, { id: "p-2" }])).toEqual({ kind: "ambiguous" });
  });
});

describe("newDomainId", () => {
  test("keeps the engine's prefix-time-random shape and does not repeat within a millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newDomainId("ref", 1_700_000_000_000)));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^ref-[0-9a-z]+-[0-9a-f]{16}$/);
  });
});
