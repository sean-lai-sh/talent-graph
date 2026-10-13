import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startPreview } from "../apps/club/components/referral/previewLadder.ts";
import { addReferral, emptyState } from "../apps/club/lib/engine.ts";
import {
  ANCHOR_NOT_OFFERED,
  commitLadderPlacement,
  LADDER_SKIP_NOTE,
  openComparisonStep,
  SIGN_IN_REQUIRED,
  TRAIT_ALREADY_PLACED,
} from "../apps/club/lib/ladderPlacement.ts";
import { commitMemberReferral, EMPTY_OBSERVATION_ERROR } from "../apps/club/lib/memberReferral.ts";
import {
  Q1_CONTEXTS,
  Q1_LENGTH,
  Q1_LENGTH_CHOICES,
  Q1_STAKE,
  Q1_STAKES,
  Q2_HARD,
  Q2_ROLES,
  Q2_WHAT,
  Q3_GROUP_CHOICES,
  Q3_RANKS,
  type QuestionDraft,
  q1Know,
  q2Distinct,
  q2Prompt,
  q2Role,
  q3Group,
  q3Rank,
  questionsContinueError,
} from "../apps/club/lib/referralQuestions.ts";
import type { ClubPerson, ClubState, MemberReferralAnswers } from "../apps/club/lib/types.ts";
import { REFERRAL_Q1_LENGTHS, REFERRAL_Q3_GROUP_SIZES } from "../apps/club/lib/types.ts";
import { DIMENSION_PROMPTS } from "../src/domain/constants.ts";
import type { Dimension, PersonStatus } from "../src/domain/types.ts";

const root = join(import.meta.dir, "..");
const NOW = "2026-09-28T12:00:00.000Z";
const EMAIL = "mina@example.test";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function person(id: string, name: string, status: PersonStatus, email?: string): ClubPerson {
  const row: ClubPerson = {
    id,
    name,
    status,
    reviewStatus: status === "member" ? "admitted" : "new",
    createdAt: "2025-10-02T00:00:00.000Z",
    updatedAt: NOW,
  };
  if (email !== undefined) row.email = email;
  return row;
}

const referrer = person("p-mina", "Mina Example", "member", EMAIL);
const applicant = person("p-priya", "Priya Example", "candidate");
const ada = person("p-ada", "Ada Example", "candidate");
const bo = person("p-bo", "Bo Example", "member");
const stranger = person("p-stranger", "Stranger Example", "candidate");

function club(people: ClubPerson[], dimensions: Dimension[] = ["output"]): ClubState {
  const state = emptyState(NOW);
  state.people = people;
  state.config = { requiredDimensions: dimensions };
  return state;
}

function referred(state: ClubState, candidateIds: string[]): ClubState {
  let next = state;
  for (const candidateId of candidateIds) {
    const result = addReferral(next, {
      referrerId: referrer.id,
      candidateId,
      conviction: 3,
      confidence: 3,
      relationshipDepth: 3,
      evidenceType: "firsthand_work",
      evidenceText: "Example observation.",
    });
    if (result.error !== undefined) throw new Error(result.error);
    next = result.state;
  }
  return next;
}

function filledDraft(partial: Partial<QuestionDraft> = {}): QuestionDraft {
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
    recognition: null,
    ...partial,
  };
}

function answers(): MemberReferralAnswers {
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
  };
}

describe("ladder placement", () => {
  test("a placement writes one weighted comparison per anchor, and Can't place writes insufficient_observation", () => {
    const state = referred(club([referrer, applicant, ada, bo, stranger]), [
      applicant.id,
      ada.id,
      bo.id,
    ]);
    const opened = openComparisonStep({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.view.skipped) throw new Error("expected a ladder");
    const trait = opened.view.traits[0];
    if (!trait) throw new Error("missing trait");
    expect(trait.anchors.map((anchor) => anchor.id).sort()).toEqual([ada.id, bo.id].sort());
    expect(trait.prompt).toBe(DIMENSION_PROMPTS.output);
    expect(JSON.stringify(opened.view)).not.toMatch(/"theta"|"percentile"|"score"/);

    const above = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "order", order: [applicant.id, ada.id, bo.id] },
    });
    expect(above.ok).toBe(true);
    if (!above.ok) return;
    expect(above.state.comparisons).toHaveLength(2);
    expect(state.comparisons).toHaveLength(0);
    for (const row of above.state.comparisons) {
      expect(row.personAId).toBe(applicant.id);
      expect(row.evaluatorId).toBe(referrer.id);
      expect(row.evaluatorId).not.toBe("user-mina");
      expect(row.confidence).toBeNull();
      expect(row.weight).toBe(1 / 2);
      expect(row.outcome).toBe("a");
      expect([ada.id, bo.id]).toContain(row.personBId);
    }

    const mixed = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "order", order: [bo.id, applicant.id, ada.id] },
    });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    const byAnchor = new Map(mixed.state.comparisons.map((row) => [row.personBId, row]));
    expect(byAnchor.get(bo.id)?.outcome).toBe("b");
    expect(byAnchor.get(ada.id)?.outcome).toBe("a");
    expect(mixed.state.comparisons.every((row) => row.weight === 1 / 2)).toBe(true);

    const cant = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "cant_place" },
    });
    expect(cant.ok).toBe(true);
    if (!cant.ok) return;
    expect(cant.state.comparisons).toHaveLength(2);
    for (const row of cant.state.comparisons) {
      expect(row.outcome).toBe("insufficient_observation");
      expect(row.personAId).toBe(applicant.id);
      expect(row.evaluatorId).toBe(referrer.id);
      expect(row.confidence).toBeNull();
      expect(row.weight).toBe(1 / 2);
      expect(row.winnerId).toBeNull();
    }
  });

  test("the server rejects an anchor it did not offer", () => {
    const state = referred(club([referrer, applicant, ada, bo, stranger]), [
      applicant.id,
      ada.id,
      bo.id,
    ]);
    const rejected = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "order", order: [applicant.id, ada.id, stranger.id] },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toBe(ANCHOR_NOT_OFFERED);
    expect(rejected.state.comparisons).toHaveLength(0);
    expect(state.comparisons).toHaveLength(0);
  });

  test("the server rejects an applicant this user did not refer", () => {
    const state = referred(club([referrer, applicant, ada, bo]), [applicant.id, ada.id, bo.id]);
    const rejected = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "cant_place" },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toBe("You have not referred this person.");
    expect(rejected.state).toBe(state);
  });

  test("the server rejects a second placement for a trait", () => {
    const state = referred(club([referrer, applicant, ada, bo]), [applicant.id, ada.id, bo.id]);
    const first = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "cant_place" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = commitLadderPlacement({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state: first.state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "order", order: [applicant.id, ada.id, bo.id] },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe(TRAIT_ALREADY_PLACED);
    expect(second.state.comparisons).toHaveLength(2);
    expect(second.state.comparisons).toBe(first.state.comparisons);
  });

  test("the server rejects an unauthenticated call", () => {
    const state = referred(club([referrer, applicant, ada, bo]), [applicant.id, ada.id, bo.id]);
    const rejected = commitLadderPlacement({
      session: null,
      ownedPersonIds: [applicant.id],
      state,
      personId: applicant.id,
      dimension: "output",
      placement: { kind: "cant_place" },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toBe(SIGN_IN_REQUIRED);
    expect(rejected.state).toBe(state);

    const source = read("apps/club/convex/comparisonStep.ts");
    for (const name of ["getComparisonStep", "submitLadderPlacement"]) {
      const marker = `export const ${name} = `;
      const start = source.indexOf(marker);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = source.slice(start, start + 900);
      expect(body).toContain("getAuthUser");
      expect(body).toContain("SIGN_IN_REQUIRED");
      expect(body).not.toContain("requireAdmin");
    }
    expect(source).toContain("commitLadderPlacement(");
    expect(source).toContain("loadState(ctx.db, club)");
    expect(source).toContain("saveState(ctx.db, club, before, result.state)");
    expect(source).toContain('withIndex("by_club_referrer_and_contact"');
    expect(source).not.toContain("requireAdmin");
  });

  test("fewer than 2 anchors skips the step and the answers stay saved", () => {
    const state = club([referrer, applicant, ada]);
    const saved = commitMemberReferral({
      state,
      email: EMAIL,
      candidateId: applicant.id,
      referredByUser: true,
      answers: answers(),
      submittedAt: state.now,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.state.referrals).toHaveLength(1);
    expect(saved.state.referrals[0]).toMatchObject({
      referrerId: referrer.id,
      candidateId: applicant.id,
    });
    const opened = openComparisonStep({
      session: { email: EMAIL },
      ownedPersonIds: [applicant.id],
      state: saved.state,
      personId: applicant.id,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.view).toEqual({
      skipped: true,
      note: LADDER_SKIP_NOTE,
      applicantName: "Priya Example",
    });
    expect(saved.state.referrals).toHaveLength(1);
    expect(saved.state.comparisons).toHaveLength(0);
  });
});

describe("referral questions", () => {
  test("empty Q2 text is an inline error", () => {
    expect(questionsContinueError(filledDraft({ what: "", hard: "", distinct: "" }))).toBe(
      EMPTY_OBSERVATION_ERROR,
    );
    expect(questionsContinueError(filledDraft({ what: "   " }))).toBe(EMPTY_OBSERVATION_ERROR);
    expect(questionsContinueError(filledDraft())).toBeNull();
    const questions = read("apps/club/components/referral/ReferralQuestions.tsx");
    expect(questions).toContain('role="alert"');
    expect(questions).toContain("EMPTY_OBSERVATION_ERROR");
  });

  test("Q1–Q3 wording matches the questionnaire, with the applicant's name in place of she/her", () => {
    expect(q1Know("Priya")).toBe("How do you know Priya? Pick the closest one.");
    expect(Q1_LENGTH).toBe("For how long?");
    expect(Q1_LENGTH_CHOICES.map((choice) => choice.label)).toEqual([
      "<3 months",
      "3-12 months",
      "1-2 years",
      "2+ years",
    ]);
    expect(Q1_LENGTH_CHOICES.map((choice) => choice.value)).toEqual([...REFERRAL_Q1_LENGTHS]);
    expect(Q1_STAKE).toBe("Was something real on the line?");
    expect([...Q1_CONTEXTS]).toEqual([
      "Built something together with a deadline",
      "Same team at work, internship, or research",
      "Class project",
      "Same club or org, different projects",
      "Friends, haven't worked together",
      "Know their work online",
      "Heard about them from others",
    ]);
    expect([...Q1_STAKES]).toEqual([
      "Grade",
      "Money",
      "Real users",
      "A ship date or competition",
      "No",
    ]);
    expect(q2Prompt("Priya")).toBe(
      "Describe one specific thing you saw Priya build, decide, or fix.",
    );
    expect(Q2_WHAT).toBe("What was it?");
    expect(Q2_HARD).toBe("What made it hard?");
    expect(q2Distinct("Priya")).toBe("What did Priya do that others wouldn't have?");
    expect(q2Role("Priya")).toBe("Priya's part was...");
    expect([...Q2_ROLES]).toEqual([
      "Led it or started it",
      "Major contributor",
      "Kept it running",
      "One of several",
      "I only heard about it",
    ]);
    expect(q3Group("Class project")).toBe(
      "Think of everyone you've worked closely with in Class project. About how many people is that?",
    );
    expect(Q3_GROUP_CHOICES.map((choice) => choice.label)).toEqual([
      "<10",
      "10-30",
      "30-100",
      "100+",
    ]);
    expect(Q3_GROUP_CHOICES.map((choice) => choice.value)).toEqual([...REFERRAL_Q3_GROUP_SIZES]);
    expect(q3Rank("Priya")).toBe("Where does Priya fall?");
    expect([...Q3_RANKS]).toEqual([
      "The best of them",
      "Top 5%",
      "Top 20%",
      "Top half",
      "Hard to say",
    ]);
    for (const line of [q1Know("Priya"), q2Distinct("Priya"), q2Role("Priya"), q3Rank("Priya")]) {
      expect(line).not.toMatch(/\b(she|her|hers)\b/i);
    }
    const questions = read("apps/club/components/referral/ReferralQuestions.tsx");
    expect(questions).toContain("q1Know(name)");
    expect(questions).toContain("q2Distinct(name)");
    expect(questions).toContain("q2Role(name)");
    expect(questions).toContain("q3Rank(name)");
    expect(questions).toContain("q3Group(");
  });
});

describe("demo home ladder", () => {
  test("the public seed yields a ladder with 2 to 5 anchors and no Convex", () => {
    const started = startPreview("p-preview", "Priya Example");
    expect("error" in started).toBe(false);
    if ("error" in started) return;
    expect(started.view.skipped).toBe(false);
    if (started.view.skipped) return;
    expect(started.view.traits.length).toBeGreaterThan(0);
    expect(started.view.traits.length).toBeLessThanOrEqual(3);
    for (const trait of started.view.traits) {
      expect(trait.anchors.length).toBeGreaterThanOrEqual(2);
      expect(trait.anchors.length).toBeLessThanOrEqual(5);
      expect(trait.prompt).toBe(DIMENSION_PROMPTS[trait.dimension]);
    }
    expect(read("apps/club/app/demo/home/MemberHomePreview.tsx")).toContain(
      "ReferralSignupPreview",
    );
    expect(read("apps/club/components/referral/ReferralSignup.tsx")).toContain(
      'import("./previewLadder.ts")',
    );
    expect(read("apps/club/components/referral/previewLadder.ts")).not.toContain("convex");
  });
});
