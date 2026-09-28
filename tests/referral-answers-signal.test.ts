import { describe, expect, test } from "bun:test";
import { computeView, initialState } from "../apps/club/lib/engine.ts";
import { planReferralAnswers } from "../apps/club/lib/referralAnswers.ts";
import { clubToReferral } from "../apps/club/lib/serialize.ts";
import type { ClubState } from "../apps/club/lib/types.ts";
import { loadSpecs } from "../src/config.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";

describe("a member's Section A answers reach Referral Signal", () => {
  test("the referral is scored on the candidate once club.now reaches it", () => {
    const club = initialState();
    const candidate = club.people.find((p) => p.status === "candidate");
    if (!candidate) throw new Error("seed has no candidate");
    const member = club.people.find(
      (p) =>
        p.status === "member" &&
        !club.referrals.some((r) => r.referrerId === p.id && r.candidateId === candidate.id),
    );
    if (!member) throw new Error("seed has no member free to refer the candidate");
    const submittedAt = new Date(Date.parse(club.now) + 3_600_000).toISOString();

    const plan = planReferralAnswers({
      contact: { kind: "email", value: "candidate@example.com" },
      candidateId: candidate.id,
      referrer: { kind: "person", personId: member.id },
      userId: "user-member",
      existing: null,
      linked: true,
      answers: {
        conviction: 3,
        confidence: 2,
        relationshipDepth: 2,
        evidenceType: "reputation",
        evidenceText: "Two teammates of mine vouch for their infra work.",
      },
      now: submittedAt,
      clubNow: club.now,
      referralId: "ref-section-a",
      tokenHash: "unused",
    });
    if (plan.action !== "insert") throw new Error(`unexpected ${plan.action}`);

    const rowsOnly: ClubState = {
      ...club,
      referrals: [...club.referrals, plan.referral],
    };
    const withNow: ClubState = { ...rowsOnly, now: plan.clubNow ?? rowsOnly.now };
    const viewOf = (state: ClubState) => {
      const person = computeView(state).people.find((p) => p.id === candidate.id);
      if (!person) throw new Error("candidate missing from the view");
      return person;
    };
    const before = viewOf(rowsOnly);
    const after = viewOf(withNow);

    expect(before.referrals.map((r) => r.referralId)).not.toContain("ref-section-a");
    expect(after.incomingCount).toBe(before.incomingCount + 1);
    // A weaker edge than any already there, so a signal that counts it drops.
    if (before.v0Signal === null || after.v0Signal === null) throw new Error("candidate unscored");
    expect(after.v0Signal).toBeLessThan(before.v0Signal);

    const edge = after.referrals.find((r) => r.referralId === "ref-section-a");
    expect(edge).toMatchObject({
      referrerId: member.id,
      referrerName: member.name,
      contributing: true,
    });
    expect(edge?.strength).toBeCloseTo(
      referralStrength(clubToReferral(plan.referral), loadSpecs().referral_signal),
      12,
    );
    expect(edge?.strength).toBeGreaterThan(0);
  });
});
