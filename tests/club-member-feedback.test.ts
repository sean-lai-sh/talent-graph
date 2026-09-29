import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyState } from "../apps/club/lib/engine.ts";
import {
  type FeedbackOrg,
  listOwnFeedbackRequests,
  type MemberResponseDraft,
  memberResponseFormError,
  NOT_YOUR_REQUEST,
  OBSERVATION_REQUIRED,
  prepareMemberResponse,
  REQUEST_CLOSED,
} from "../apps/club/lib/memberFeedback.ts";
import type { ClubFeedbackRequest, ClubPerson, ClubState } from "../apps/club/lib/types.ts";
import type { Dimension, PersonStatus, RubricScore } from "../src/domain/types.ts";

const root = join(import.meta.dir, "..");
const NOW = "2026-09-27T12:00:00.000Z";
const MINA = "mina@example.test";
const OTTO = "otto@example.test";

function person(
  id: string,
  name: string,
  email: string,
  status: PersonStatus = "member",
): ClubPerson {
  return { id, name, email, status, createdAt: NOW, updatedAt: NOW };
}

function request(
  partial: Partial<ClubFeedbackRequest> & Pick<ClubFeedbackRequest, "id">,
): ClubFeedbackRequest {
  return {
    candidateId: "p-ada",
    memberId: "p-mina",
    requestedAt: NOW,
    dueAt: "2026-09-29T12:00:00.000Z",
    note: "How does she run a review?",
    respondedAt: null,
    evaluationId: null,
    ...partial,
  };
}

function orgWith(requests: ClubFeedbackRequest[], key = "org-1"): FeedbackOrg {
  const state = emptyState(NOW);
  state.people = [
    person("p-ada", "Ada Example", "ada@example.test", "candidate"),
    person("p-mina", "Mina Example", MINA),
    person("p-otto", "Otto Example", OTTO),
  ];
  state.feedbackRequests = requests;
  return { key, state };
}

const pending = request({ id: "fb-pending", note: "Pending note for Mina." });
const overdue = request({
  id: "fb-overdue",
  requestedAt: "2026-09-24T12:00:00.000Z",
  dueAt: "2026-09-26T12:00:00.000Z",
  note: "Overdue note for Mina.",
});
const closed = request({
  id: "fb-closed",
  respondedAt: "2026-09-26T12:00:00.000Z",
  evaluationId: "eval-old",
  note: "Already answered.",
});
const ottos = request({
  id: "fb-otto",
  memberId: "p-otto",
  note: "Only Otto should see this.",
});

function draft(partial: Partial<MemberResponseDraft> = {}): MemberResponseDraft {
  return {
    requestId: pending.id,
    dimension: "agency",
    score: 3,
    confidence: 4,
    evidenceText: "She shipped the underspecified brief without check-ins.",
    ...partial,
  };
}

function respond(org: FeedbackOrg, email: string, response: MemberResponseDraft, now = NOW) {
  return prepareMemberResponse({ orgs: [org], email, response, now });
}

describe("member feedback inbox", () => {
  test("a member sees only their own open requests", () => {
    const org = orgWith([pending, overdue, closed, ottos]);
    const mina = listOwnFeedbackRequests({ orgs: [org], email: "Mina@Example.test", clock: NOW });
    expect(mina.map((item) => item.id)).toEqual(["fb-overdue", "fb-pending"]);
    expect(mina.map((item) => item.note)).toEqual([
      "Overdue note for Mina.",
      "Pending note for Mina.",
    ]);
    const otto = listOwnFeedbackRequests({ orgs: [org], email: OTTO, clock: NOW });
    expect(otto.map((item) => item.id)).toEqual(["fb-otto"]);
    expect(
      listOwnFeedbackRequests({ orgs: [org], email: "nobody@example.test", clock: NOW }),
    ).toEqual([]);
  });

  test("overdue requests are flagged overdue and pending ones are not", () => {
    const listed = listOwnFeedbackRequests({
      orgs: [orgWith([pending, overdue])],
      email: MINA,
      clock: NOW,
    });
    const late = listed.find((item) => item.id === "fb-overdue");
    const open = listed.find((item) => item.id === "fb-pending");
    expect(late?.state).toBe("overdue");
    expect(late?.dueLabel.startsWith("overdue")).toBe(true);
    expect(open?.state).toBe("pending");
    expect(open?.dueLabel.startsWith("due in")).toBe(true);
  });

  test("a valid response closes the request and writes rubric evidence", () => {
    const org = orgWith([pending, overdue]);
    const plan = respond(org, MINA, draft());
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    const closedRequest = plan.state.feedbackRequests.find((row) => row.id === pending.id);
    const evaluation = plan.state.evaluations[0];
    expect(closedRequest?.respondedAt).toBe(NOW);
    expect(closedRequest?.evaluationId).toBe(evaluation?.id);
    expect(evaluation).toMatchObject({
      evaluatorId: "p-mina",
      candidateId: "p-ada",
      dimension: "agency",
      score: 3,
      confidence: 4,
      evidenceText: draft().evidenceText,
    });
    expect(
      plan.state.feedbackRequests.find((row) => row.id === overdue.id)?.respondedAt,
    ).toBeNull();
    expect(org.state.feedbackRequests.find((row) => row.id === pending.id)?.respondedAt).toBeNull();
  });

  test("an empty observation is rejected in the form and in the mutation", () => {
    expect(memberResponseFormError("   ")).toBe(OBSERVATION_REQUIRED);
    expect(memberResponseFormError("Saw her ship it.")).toBeNull();
    const org = orgWith([pending]);
    const plan = respond(org, MINA, draft({ evidenceText: "  " }));
    expect(plan).toEqual({ key: null, error: expect.stringContaining("non-empty") });
    expect(org.state.evaluations).toHaveLength(0);
    expect(org.state.feedbackRequests[0]?.respondedAt).toBeNull();
  });

  test("an invalid score or dimension is rejected and the request stays open", () => {
    const org = orgWith([pending]);
    const badScore = respond(org, MINA, draft({ score: 9 as RubricScore }));
    expect(badScore).toMatchObject({ key: null });
    if ("error" in badScore) expect(badScore.error).toContain("score");
    const badDimension = respond(org, MINA, draft({ dimension: "charisma" as Dimension }));
    expect(badDimension).toMatchObject({ key: null });
    if ("error" in badDimension) expect(badDimension.error).toContain("unknown dimension");
    expect(org.state.evaluations).toHaveLength(0);
    expect(org.state.feedbackRequests[0]?.respondedAt).toBeNull();
  });

  test("another member's request is rejected", () => {
    const org = orgWith([ottos, pending]);
    const plan = respond(org, MINA, draft({ requestId: ottos.id }));
    expect(plan).toEqual({ key: null, error: NOT_YOUR_REQUEST });
    expect(respond(org, MINA, draft({ requestId: "fb-missing" }))).toEqual({
      key: null,
      error: NOT_YOUR_REQUEST,
    });
    expect(org.state.evaluations).toHaveLength(0);
    expect(org.state.feedbackRequests.find((row) => row.id === ottos.id)?.respondedAt).toBeNull();
  });

  test("a closed request is rejected", () => {
    const state: ClubState = orgWith([closed]).state;
    state.evaluations = [
      {
        id: "eval-old",
        evaluatorId: "p-mina",
        candidateId: "p-ada",
        dimension: "agency",
        score: 2,
        confidence: 3,
        evidenceText: "Earlier note.",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const plan = prepareMemberResponse({
      orgs: [{ key: "org-1", state }],
      email: MINA,
      response: draft({ requestId: closed.id, evidenceText: "A second answer." }),
      now: NOW,
    });
    expect(plan).toEqual({ key: null, error: REQUEST_CLOSED });
    expect(state.evaluations).toHaveLength(1);
    expect(state.feedbackRequests[0]?.evaluationId).toBe("eval-old");
  });

  test("the inbox form and the mutation both call the shared plan", () => {
    const inbox = readFileSync(
      join(root, "apps/club/components/feedback/FeedbackInbox.tsx"),
      "utf8",
    );
    const club = readFileSync(join(root, "apps/club/convex/club.ts"), "utf8");
    const lib = readFileSync(join(root, "apps/club/lib/memberFeedback.ts"), "utf8");
    expect(inbox).toContain("memberResponseFormError");
    expect(inbox).toContain("Overdue");
    expect(club).toContain("prepareMemberResponse");
    expect(lib).toContain("recordFeedback(");
  });
});
