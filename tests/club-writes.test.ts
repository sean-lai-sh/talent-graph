import { describe, expect, test } from "bun:test";
import { type ClubWritePlan, COLLECTIONS, planWrites } from "../apps/club/lib/clubWrites.ts";
import {
  addPerson,
  decide,
  emptyState,
  initialState,
  recordFeedback,
  requestFeedback,
  setReviewConfig,
} from "../apps/club/lib/engine.ts";
import type { ClubState } from "../apps/club/lib/types.ts";

const T0 = "2026-01-01T00:00:00.000Z";

function ok(result: { state: ClubState; error?: string }): ClubState {
  expect(result.error).toBeUndefined();
  return result.state;
}

/** Two candidates and a member, each added through the engine. */
function club(): { state: ClubState; ada: string; bo: string; mem: string } {
  let state = emptyState(T0);
  state = ok(addPerson(state, { name: "Ada" }));
  state = ok(addPerson(state, { name: "Bo", affiliation: "NYU" }));
  state = ok(addPerson(state, { name: "Mem", status: "member" }));
  const [ada, bo, mem] = state.people.map((p) => p.id) as [string, string, string];
  return { state, ada, bo, mem };
}

/** Collections that received writes, so a test can assert "nothing else". */
function touched(plan: ClubWritePlan): string[] {
  return COLLECTIONS.filter((c) => plan.rows[c].length > 0);
}

function emptyPlan(): ClubWritePlan {
  const rows = Object.fromEntries(
    COLLECTIONS.map((c) => [c, []]),
  ) as unknown as ClubWritePlan["rows"];
  return { rows, club: {} };
}

describe("planWrites", () => {
  test("a deep copy plans nothing, nested snapshot fields included", () => {
    const { state: start, ada } = club();
    const state = ok(decide(start, ada, "start_review"));
    expect(state.snapshots[0]?.values).toBeDefined();
    expect(planWrites(state, structuredClone(state))).toEqual(emptyPlan());
  });

  test("the example club against its own copy plans nothing", () => {
    const state = initialState();
    expect(planWrites(state, structuredClone(state))).toEqual(emptyPlan());
  });

  test("reordering rows is not a write", () => {
    const { state } = club();
    const after = structuredClone(state);
    after.people.reverse();
    expect(planWrites(state, after)).toEqual(emptyPlan());
  });

  test("an undefined field equals an absent one", () => {
    const { state, ada } = club();
    const after = structuredClone(state);
    const person = after.people.find((p) => p.id === ada);
    if (!person) throw new Error("no ada");
    (person as { bio?: string | undefined }).bio = undefined;
    expect("bio" in person).toBe(true);
    expect(planWrites(state, after)).toEqual(emptyPlan());
    expect(planWrites(after, state)).toEqual(emptyPlan());
  });

  test("decide replaces one person and inserts one snapshot", () => {
    const { state, ada } = club();
    const after = ok(decide(state, ada, "start_review"));
    const plan = planWrites(state, after);
    expect(touched(plan)).toEqual(["people", "snapshots"]);
    const person = after.people.find((p) => p.id === ada);
    const snapshot = after.snapshots[0];
    if (!person || !snapshot) throw new Error("decide wrote no person or snapshot");
    expect(plan.rows.people).toEqual([{ kind: "replace", id: ada, row: person }]);
    expect(plan.rows.snapshots).toEqual([{ kind: "insert", row: snapshot }]);
    expect(plan.club).toEqual({});
  });

  test("decide on the example club touches only the decided person", () => {
    const before = initialState();
    const after = ok(decide(before, "p-cleo", "admit"));
    const plan = planWrites(before, after);
    expect(touched(plan)).toEqual(["people", "snapshots"]);
    expect(plan.rows.people.map((w) => w.kind === "replace" && w.id)).toEqual(["p-cleo"]);
    expect(plan.rows.snapshots.map((w) => w.kind)).toEqual(["insert"]);
  });

  test("a nested field change is a replace", () => {
    const { state, ada } = club();
    const before = ok(decide(state, ada, "start_review"));
    const after = structuredClone(before);
    const snap = after.snapshots[0];
    if (!snap) throw new Error("no snapshot");
    snap.values.incomingCount += 1;
    const plan = planWrites(before, after);
    expect(plan.rows.snapshots).toEqual([{ kind: "replace", id: snap.id, row: snap }]);
    expect(touched(plan)).toEqual(["snapshots"]);
  });

  test("requestFeedback inserts requests and moves a new candidate into review", () => {
    const { state, ada, bo, mem } = club();
    const after = ok(
      requestFeedback(state, { candidateId: ada, memberIds: [mem, bo], note: "hi" }),
    );
    const plan = planWrites(state, after);
    expect(touched(plan)).toEqual(["people", "feedbackRequests"]);
    expect(plan.rows.feedbackRequests).toEqual(
      after.feedbackRequests.map((row) => ({ kind: "insert", row })),
    );
    expect(plan.rows.people.map((w) => w.kind === "replace" && w.id)).toEqual([ada]);
  });

  test("recordFeedback inserts an evaluation and closes its request", () => {
    const { state: start, ada, mem } = club();
    const before = ok(requestFeedback(start, { candidateId: ada, memberIds: [mem], note: "" }));
    const after = ok(
      recordFeedback(before, {
        evaluatorId: mem,
        candidateId: ada,
        dimension: "agency",
        score: 3,
        confidence: 4,
        evidenceText: "shipped it",
      }),
    );
    const plan = planWrites(before, after);
    expect(touched(plan)).toEqual(["evaluations", "feedbackRequests"]);
    const evaluation = after.evaluations[0];
    const request = after.feedbackRequests[0];
    if (!evaluation || !request) throw new Error("missing rows");
    expect(plan.rows.evaluations).toEqual([{ kind: "insert", row: evaluation }]);
    expect(plan.rows.feedbackRequests).toEqual([{ kind: "replace", id: request.id, row: request }]);
    expect(request.evaluationId).toBe(evaluation.id);
  });

  test("setReviewConfig writes the club config and no rows", () => {
    const { state } = club();
    const after = ok(setReviewConfig(state, { requiredDimensions: ["agency", "output"] }));
    const plan = planWrites(state, after);
    expect(touched(plan)).toEqual([]);
    expect(plan.club).toEqual({ config: { requiredDimensions: ["agency", "output"] } });
  });

  test("a reordered config is a write (config compare is order-sensitive)", () => {
    const { state } = club();
    const before = { ...state, config: { requiredDimensions: ["agency", "output"] } } as ClubState;
    const after = { ...state, config: { requiredDimensions: ["output", "agency"] } } as ClubState;
    expect(planWrites(before, after).club).toEqual({ config: after.config });
  });

  test("a moved clock writes only now", () => {
    const { state } = club();
    const after = { ...state, now: "2026-02-01T00:00:00.000Z" };
    expect(planWrites(state, after)).toEqual({ ...emptyPlan(), club: { now: after.now } });
  });

  test("a row missing from after is deleted; order follows each state", () => {
    const { state, ada, bo, mem } = club();
    const after = ok(addPerson({ ...state, people: [state.people[2]!] }, { name: "Cy" }));
    const cy = after.people[1]!;
    expect(planWrites(state, after).rows.people).toEqual([
      { kind: "insert", row: cy },
      { kind: "delete", id: ada },
      { kind: "delete", id: bo },
    ]);
    expect(after.people[0]!.id).toBe(mem);
  });

  test("a duplicate id in either state throws, naming the collection and id", () => {
    const { state, ada } = club();
    const dup = { ...state, people: [...state.people, state.people[0]!] };
    for (const [before, after] of [
      [dup, state],
      [state, dup],
    ] as const) {
      expect(() => planWrites(before, after)).toThrow(ada);
      expect(() => planWrites(before, after)).toThrow("people");
    }
  });
});
