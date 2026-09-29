import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLUB_TABLES, planWrites } from "../apps/club/lib/clubWrites.ts";
import { computeView, emptyState } from "../apps/club/lib/engine.ts";
import { signalText } from "../apps/club/lib/format.ts";
import { resolveMemberPersonId } from "../apps/club/lib/memberIdentity.ts";
import {
  AMBIGUOUS_CONTACT_ERROR,
  AMBIGUOUS_MEMBER_ERROR,
  commitMemberReferral,
  EMPTY_OBSERVATION_ERROR,
  memberReferralAnswers,
  NO_CONTACT_ERROR,
  NOT_LINKED_ERROR,
  NOT_YOUR_REFERRAL_ERROR,
  referralAnswersToEngine,
} from "../apps/club/lib/memberReferral.ts";
import { reviveState } from "../apps/club/lib/serialize.ts";
import type { ClubPerson, ClubState, MemberReferralAnswers } from "../apps/club/lib/types.ts";
import {
  REFERRAL_Q1_CONTEXTS,
  REFERRAL_Q1_LENGTHS,
  REFERRAL_Q1_STAKES,
  REFERRAL_Q2_ROLES,
  REFERRAL_Q3_GROUP_SIZES,
  REFERRAL_Q3_RANKS,
} from "../apps/club/lib/types.ts";
import { EVIDENCE_TYPES } from "../src/domain/constants.ts";
import type { EvidenceType, PersonStatus, Scale5 } from "../src/domain/types.ts";

const root = join(import.meta.dir, "..");
const NOW = "2026-09-28T12:00:00.000Z";
const LATER = "2026-09-28T15:30:00.000Z";
const EARLIER = "2026-09-27T09:00:00.000Z";
const MINA = "mina@example.test";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function mutationBody(source: string, name: string): string {
  const marker = `export const ${name} = mutation(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing mutation ${name}`);
  const rest = source.slice(start);
  const boundary = rest.slice(marker.length).search(/\n(?:export const |function |const |\/\*\*)/);
  return boundary < 0 ? rest : rest.slice(0, marker.length + boundary);
}

function person(id: string, name: string, status: PersonStatus, email?: string): ClubPerson {
  const row: ClubPerson = {
    id,
    name,
    status,
    reviewStatus: status === "member" ? "admitted" : status === "archived" ? "denied" : "new",
    createdAt: NOW,
    updatedAt: NOW,
  };
  if (email !== undefined) row.email = email;
  return row;
}

function club(people: ClubPerson[]): ClubState {
  const state = emptyState(NOW);
  state.people = people;
  return state;
}

function answers(partial: Partial<MemberReferralAnswers> = {}): MemberReferralAnswers {
  return {
    context: "Class project",
    length: "3 to 12 months",
    stakes: ["No"],
    what: "Shipped the parser.",
    hard: "The spec kept moving.",
    distinct: "Wrote the failing test first.",
    role: "Major contributor",
    rank: "Top 20%",
    groupSize: "10 to 30",
    ...partial,
  };
}

function mapped(partial: Partial<MemberReferralAnswers> = {}) {
  const result = referralAnswersToEngine(answers(partial));
  if (!result.ok) throw new Error(result.error);
  return result.referral;
}

const member = person("p-mina", "Mina Example", "member", MINA);
const applicant = person("p-ada", "Ada Example", "candidate", "ada@example.test");

function linkedState(): ClubState {
  return club([member, applicant]);
}

describe("resolveMemberPersonId", () => {
  test("one member email match is that person's id, ignoring case and surrounding space", () => {
    const state = club([
      member,
      person("p-ada", "Ada Example", "candidate", MINA),
      person("p-old", "Old Example", "archived", MINA),
    ]);
    expect(resolveMemberPersonId(state, "  Mina@Example.test ")).toEqual({
      status: "linked",
      personId: "p-mina",
    });
  });

  test("zero members or two members with the same email are not linked", () => {
    expect(resolveMemberPersonId(club([applicant]), MINA)).toEqual({ status: "not_linked" });
    expect(resolveMemberPersonId(club([]), MINA)).toEqual({ status: "not_linked" });
    expect(resolveMemberPersonId(linkedState(), "  ")).toEqual({ status: "not_linked" });
    expect(
      resolveMemberPersonId(
        club([member, person("p-mina-2", "Mina Two", "member", "MINA@example.test"), applicant]),
        MINA,
      ),
    ).toEqual({ status: "not_linked" });
  });
});

describe("referralAnswersToEngine", () => {
  const baseDepth: Record<
    (typeof REFERRAL_Q1_CONTEXTS)[number],
    { evidenceType: EvidenceType; depth: Scale5 }
  > = {
    "Built something together with a deadline": { evidenceType: "firsthand_work", depth: 4 },
    "Same team at work, internship, or research": { evidenceType: "firsthand_work", depth: 4 },
    "Class project": { evidenceType: "firsthand_work", depth: 3 },
    "Same club or org, different projects": { evidenceType: "firsthand_personal", depth: 2 },
    "Friends, haven't worked together": { evidenceType: "firsthand_personal", depth: 2 },
    "Know their work online": { evidenceType: "artifact", depth: 1 },
    "Heard about them from others": { evidenceType: "reputation", depth: 1 },
  };

  test("every Q1 context sets evidence type and base depth", () => {
    for (const context of REFERRAL_Q1_CONTEXTS) {
      const expected = baseDepth[context];
      const referral = mapped({ context, length: "3 to 12 months", stakes: ["No"] });
      expect(referral.evidenceType).toBe(expected.evidenceType);
      expect(referral.relationshipDepth).toBe(expected.depth);
      expect(EVIDENCE_TYPES).toContain(referral.evidenceType);
    }
  });

  test("length adjusts depth and any real stake adds one", () => {
    const context = "Class project" as const;
    expect(mapped({ context, length: "under 3 months", stakes: ["No"] }).relationshipDepth).toBe(2);
    expect(mapped({ context, length: "3 to 12 months", stakes: [] }).relationshipDepth).toBe(3);
    expect(mapped({ context, length: "1 to 2 years", stakes: ["No"] }).relationshipDepth).toBe(3);
    expect(mapped({ context, length: "2+ years", stakes: ["No"] }).relationshipDepth).toBe(4);
    expect(mapped({ context, length: "3 to 12 months", stakes: ["Grade"] }).relationshipDepth).toBe(
      4,
    );
    expect(
      mapped({ context, length: "1 to 2 years", stakes: ["Grade", "Money", "No"] })
        .relationshipDepth,
    ).toBe(4);
    for (const length of REFERRAL_Q1_LENGTHS) {
      expect(mapped({ context, length, stakes: ["No"] }).relationshipDepth).toBeGreaterThanOrEqual(
        1,
      );
    }
    for (const stake of REFERRAL_Q1_STAKES) {
      if (stake === "No") continue;
      expect(mapped({ context, length: "3 to 12 months", stakes: [stake] }).relationshipDepth).toBe(
        4,
      );
    }
  });

  test("depth clamps at 1 and at 5", () => {
    expect(
      mapped({
        context: "Heard about them from others",
        length: "under 3 months",
        stakes: ["No"],
      }).relationshipDepth,
    ).toBe(1);
    expect(
      mapped({
        context: "Heard about them from others",
        length: "under 3 months",
        stakes: ["A ship date or competition"],
      }).relationshipDepth,
    ).toBe(1);
    expect(
      mapped({
        context: "Built something together with a deadline",
        length: "2+ years",
        stakes: ["Real users"],
      }).relationshipDepth,
    ).toBe(5);
    expect(
      mapped({
        context: "Same team at work, internship, or research",
        length: "2+ years",
        stakes: ["Money", "Grade"],
      }).relationshipDepth,
    ).toBe(5);
  });

  test("Q2 role 'I only heard about it' downgrades evidence type to reputation", () => {
    for (const role of REFERRAL_Q2_ROLES) {
      const referral = mapped({
        context: "Built something together with a deadline",
        role,
      });
      expect(referral.evidenceType).toBe(
        role === "I only heard about it" ? "reputation" : "firsthand_work",
      );
    }
    expect(
      mapped({ context: "Know their work online", role: "I only heard about it" }).evidenceType,
    ).toBe("reputation");
  });

  test("a chip outside the questionnaire is rejected", () => {
    expect(memberReferralAnswers({ ...answers(), context: "We met once" })).toBeNull();
    expect(memberReferralAnswers({ ...answers(), stakes: ["Grade", "Reputation"] })).toBeNull();
  });

  test("evidence text is the three Q2 answers with labels, and blank answers are rejected", () => {
    const referral = mapped({
      what: "  Shipped the parser. ",
      hard: "The spec kept moving.",
      distinct: "Wrote the failing test first.",
      role: "Led it or started it",
    });
    expect(referral.evidenceText).toBe(
      [
        "What was it?: Shipped the parser.",
        "What made it hard?: The spec kept moving.",
        "What did they do that others wouldn't have?: Wrote the failing test first.",
      ].join("\n"),
    );
    expect(referral.evidenceText).not.toContain("Led it or started it");
    const partial = mapped({ what: "Shipped it.", hard: "  ", distinct: "" });
    expect(partial.evidenceText).toContain("What was it?: Shipped it.");
    expect(partial.evidenceText).toContain("What made it hard?:");
    expect(partial.evidenceText).toContain("What did they do that others wouldn't have?:");

    for (const blank of [
      { what: "", hard: "", distinct: "" },
      { what: "  ", hard: "\n", distinct: " \t " },
    ]) {
      const rejected = referralAnswersToEngine(answers(blank));
      expect(rejected).toEqual({ ok: false, error: EMPTY_OBSERVATION_ERROR });
    }
  });

  test("every Q3 rank and group size maps, and hard to say caps confidence at 2", () => {
    const conviction: Record<(typeof REFERRAL_Q3_RANKS)[number], Scale5> = {
      "The best of them": 5,
      "Top 5%": 5,
      "Top 20%": 4,
      "Top half": 3,
      "Hard to say": 2,
    };
    const confidence: Record<(typeof REFERRAL_Q3_GROUP_SIZES)[number], Scale5> = {
      "under 10": 2,
      "10 to 30": 3,
      "30 to 100": 4,
      "100+": 5,
    };
    for (const rank of REFERRAL_Q3_RANKS) {
      const referral = mapped({ rank, groupSize: "30 to 100" });
      expect(referral.conviction).toBe(conviction[rank]);
      expect(referral.confidence).toBe(rank === "Hard to say" ? 2 : 4);
    }
    for (const groupSize of REFERRAL_Q3_GROUP_SIZES) {
      expect(mapped({ rank: "Top half", groupSize }).confidence).toBe(confidence[groupSize]);
      expect(mapped({ rank: "Hard to say", groupSize }).confidence).toBe(2);
      expect(mapped({ rank: "Hard to say", groupSize }).conviction).toBe(2);
    }
  });
});

describe("saveMemberReferralAnswers", () => {
  const sample = answers();

  function save(
    state: ClubState,
    overrides: Partial<{
      email: string;
      candidateId: string;
      referredByUser: boolean;
      answers: MemberReferralAnswers;
      submittedAt: string;
    }> = {},
  ) {
    return commitMemberReferral({
      state,
      email: overrides.email ?? MINA,
      candidateId: overrides.candidateId ?? applicant.id,
      referredByUser: overrides.referredByUser ?? true,
      answers: overrides.answers ?? sample,
      submittedAt: overrides.submittedAt ?? NOW,
    });
  }

  test("a linked member writes one clubReferrals row for the applicant they referred", () => {
    const before = linkedState();
    const result = save(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.referrals).toHaveLength(1);
    const row = result.state.referrals[0];
    if (!row) throw new Error("missing referral row");
    expect(row).toMatchObject({
      referrerId: "p-mina",
      candidateId: "p-ada",
      ...mapped(),
    });
    expect(row.referrerId).not.toBe("user-mina");
    const writes = planWrites(before, result.state);
    expect(CLUB_TABLES.referrals).toBe("clubReferrals");
    expect(writes.rows.referrals).toEqual([{ kind: "insert", row }]);
    expect(writes.rows.people).toEqual([]);
    expect(before.referrals).toHaveLength(0);
  });

  test("before the write the applicant has no Referral Signal; after, V0 is nonzero", () => {
    const before = linkedState();
    const beforePerson = computeView(before).people.find((p) => p.id === applicant.id);
    expect(beforePerson?.incomingCount).toBe(0);
    expect(beforePerson?.v0Signal).toBeNull();
    expect(signalText(beforePerson?.v0Signal ?? null)).toBe("Insufficient Evidence");
    expect(beforePerson?.missingEvidence.some((item) => item.kind === "no_referrals")).toBe(true);

    const saved = save(before);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = reviveState(saved.state);
    expect(loaded.referrals).toHaveLength(1);
    expect(loaded.referrals[0]).toMatchObject({ referrerId: "p-mina", candidateId: "p-ada" });
    const afterPerson = computeView(loaded).people.find((p) => p.id === applicant.id);
    expect(afterPerson?.incomingCount).toBe(1);
    expect(afterPerson?.v0Signal).toBeGreaterThan(0);
    expect(signalText(afterPerson?.v0Signal ?? null)).not.toBe("Insufficient Evidence");
  });

  test("a later submission moves club.now forward to the referral's createdAt", () => {
    const before = linkedState();
    const result = save(before, { submittedAt: LATER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.now).toBe(LATER);
    expect(result.state.referrals[0]?.createdAt).toBe(LATER);
    expect(planWrites(before, result.state).club).toEqual({ now: LATER });
    const view = computeView(reviveState(result.state)).people.find((p) => p.id === applicant.id);
    expect(view?.incomingCount).toBe(1);
  });

  test("an earlier submission never moves club.now back", () => {
    const before = linkedState();
    const result = save(before, { submittedAt: EARLIER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.now).toBe(NOW);
    expect(result.state.referrals[0]?.createdAt).toBe(EARLIER);
    expect(planWrites(before, result.state).club).toEqual({});
    const view = computeView(reviveState(result.state)).people.find((p) => p.id === applicant.id);
    expect(view?.incomingCount).toBe(1);
  });

  test("a second save for the same candidate updates the one row and keeps createdAt", () => {
    const first = save(linkedState(), { submittedAt: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const original = first.state.referrals[0];
    if (!original) throw new Error("missing referral row");
    const second = save(first.state, {
      submittedAt: LATER,
      answers: answers({ rank: "The best of them", what: "Ran the launch." }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.link).toBeNull();
    expect(second.state.referrals).toHaveLength(1);
    expect(second.state.referrals[0]).toEqual({
      ...original,
      conviction: 5,
      evidenceText: [
        "What was it?: Ran the launch.",
        "What made it hard?: The spec kept moving.",
        "What did they do that others wouldn't have?: Wrote the failing test first.",
      ].join("\n"),
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(second.state.now).toBe(LATER);
    const updated = second.state.referrals[0];
    if (!updated) throw new Error("missing updated row");
    const writes = planWrites(first.state, second.state);
    expect(writes.rows.referrals).toEqual([{ kind: "replace", id: original.id, row: updated }]);
    expect(writes.club).toEqual({ now: LATER });
  });

  test("a person already in the club that this user had not referred gets a link", () => {
    const before = linkedState();
    const result = save(before, { referredByUser: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link).toEqual({ normalizedContact: "ada@example.test" });
    expect(result.state.referrals).toHaveLength(1);
    expect(result.state.referrals[0]).toMatchObject({ referrerId: "p-mina", candidateId: "p-ada" });

    const owned = save(before);
    expect(owned.ok && owned.link).toBeNull();
  });

  test("a person not in the club, or with no contact on file, writes nothing", () => {
    const before = linkedState();
    expect(save(before, { referredByUser: false, candidateId: "p-nobody" })).toEqual({
      ok: false,
      error: NOT_YOUR_REFERRAL_ERROR,
      state: before,
    });
    const bare = club([member, person("p-bare", "Bare Example", "candidate")]);
    expect(save(bare, { referredByUser: false, candidateId: "p-bare" })).toEqual({
      ok: false,
      error: NO_CONTACT_ERROR,
      state: bare,
    });
  });

  test("a contact that several people carry is rejected and writes nothing", () => {
    const twinEmail = club([
      member,
      applicant,
      person("p-ada-again", "Ada Again", "candidate", "ada@example.test"),
    ]);
    expect(save(twinEmail, { referredByUser: false })).toEqual({
      ok: false,
      error: AMBIGUOUS_CONTACT_ERROR,
      state: twinEmail,
    });

    const withPhone = (id: string, phone: string): ClubPerson => ({
      ...person(id, id, "candidate"),
      phone,
    });
    const twinPhone = club([
      member,
      withPhone("p-ada", "(212) 555-0199"),
      withPhone("p-other", "+1 646 555 0100"),
      withPhone("p-ada-again", "+1 212 555 0199"),
    ]);
    expect(save(twinPhone, { referredByUser: false, candidateId: "p-ada" })).toEqual({
      ok: false,
      error: AMBIGUOUS_CONTACT_ERROR,
      state: twinPhone,
    });
    const lone = save(twinPhone, { referredByUser: false, candidateId: "p-other" });
    expect(lone.ok && lone.link).toEqual({ normalizedContact: "+16465550100" });
    expect(AMBIGUOUS_CONTACT_ERROR).not.toBe(NO_CONTACT_ERROR);
  });

  test("an unlinked account and an email on two members get different errors", () => {
    const none = linkedState();
    none.people = [person("p-mina", "Mina Example", "candidate", MINA), applicant];
    expect(save(none)).toEqual({ ok: false, error: NOT_LINKED_ERROR, state: none });

    const two = club([
      member,
      person("p-mina-2", "Mina Two", "member", "MINA@example.test"),
      applicant,
    ]);
    expect(save(two)).toEqual({ ok: false, error: AMBIGUOUS_MEMBER_ERROR, state: two });
    expect(AMBIGUOUS_MEMBER_ERROR).not.toBe(NOT_LINKED_ERROR);
    expect(two.referrals).toHaveLength(0);
    expect(two.people).toHaveLength(3);
  });

  test("referring your own person row is rejected by the engine self-referral rule", () => {
    const state = club([member]);
    const result = save(state, { candidateId: member.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no self-referral");
    expect(result.state.referrals).toHaveLength(0);
    expect(state.referrals).toHaveLength(0);
  });

  test("the mutation runs that write through loadState and saveState, not requireAdmin", () => {
    const referral = read("apps/club/convex/referral.ts");
    const body = mutationBody(referral, "saveMemberReferralAnswers");
    expect(body).toContain("getAuthUser");
    expect(body).toContain("saveOwnedMemberReferral(");
    expect(body).toContain("commitMemberReferral(");
    expect(body).toContain("loadState(ctx.db, club)");
    expect(body).toContain("saveState(ctx.db, club, before, result.state)");
    expect(body).toContain('withIndex("by_club_referrer_and_contact"');
    expect(body).toContain("result.link?.normalizedContact");
    expect(body).toContain("newStatusToken()");
    expect(body).toContain("insertMemberReferralLink(ctx.db, club._id");
    expect(body).toContain("token: issued.token");
    expect(body).not.toContain("new Date().toISOString() },");
    expect(body).not.toContain("requireAdmin");
    expect(body).not.toContain("applyEngine");
    expect(read("apps/club/lib/memberReferral.ts")).toContain("addReferral(");
    expect(read("apps/club/lib/memberFeedback.ts")).toContain("resolveMemberPersonId(");
    expect(read("apps/club/lib/memberFeedback.ts")).not.toContain("personIdsForEmail");
    const submit = mutationBody(referral, "submitReferralSignup");
    expect(submit).toContain("contact: v.string()");
    expect(submit).toContain("name: v.string()");
    expect(submit).not.toContain("commitMemberReferral");
    expect(submit).not.toContain("clubReferrals");
  });
});
