import { describe, expect, test } from "bun:test";
import {
  addComparison,
  addReferral,
  computeView,
  initialState,
  loadClub,
  meddleReferral,
  setNow,
  setStatus,
} from "../apps/club/lib/engine.ts";
import { DEMO_T_END, DEMO_T_START } from "../apps/club/lib/serialize.ts";

describe("example club engine", () => {
  test("seed view pins the six personas and never emits a single accept score", () => {
    const { view } = loadClub();
    const personas = view.people.filter((p) => p.persona);
    expect(personas.map((p) => p.id).sort()).toEqual(
      ["p-alice", "p-bram", "p-cleo", "p-dev", "p-ember", "p-fox"].sort(),
    );
    expect(view.topReferral.length).toBeGreaterThan(0);
    expect(view.topCapability.length).toBeGreaterThan(0);
    expect(view.now).toBe(DEMO_T_END);
    expect(JSON.stringify(view)).not.toContain("Talent Score");
    expect(JSON.stringify(view)).not.toContain("Capability Score");
  });

  test("at the start of the year V2 equals V0; by year end some signals move", () => {
    const state = initialState();
    const early = computeView({ ...state, now: DEMO_T_START });
    expect(early.windowOpen).toBe(false);
    expect(early.evaluatedReferrals).toBe(0);
    for (const p of early.people.filter((row) => row.persona)) {
      expect(p.v2Signal).toBe(p.v0Signal);
    }

    const late = computeView({ ...state, now: DEMO_T_END });
    expect(late.windowOpen).toBe(true);
    expect(late.evaluatedReferrals).toBeGreaterThan(0);
    expect(late.judgesWithEvidence).toBeGreaterThan(0);
    const moved = late.people.filter((p) => p.persona && p.v2Signal !== p.v0Signal);
    expect(moved.length).toBeGreaterThan(0);
  });

  test("accepting a candidate records a snapshot without changing scores", () => {
    const start = loadClub();
    const cleo = start.view.people.find((p) => p.id === "p-cleo");
    expect(cleo?.status).toBe("candidate");
    const after = setStatus(start.state, "p-cleo", "member");
    expect(after.view.people.find((p) => p.id === "p-cleo")?.status).toBe("member");
    expect(after.view.counts.members).toBe(start.view.counts.members + 1);
    expect(after.state.snapshots[0]?.decision).toBe("member");
    expect(after.view.people.find((p) => p.id === "p-cleo")?.v2Signal).toBe(cleo?.v2Signal);
  });

  test("meddling a referral slider changes Referral Signal and does not bump updatedAt", () => {
    const start = loadClub();
    const alice = start.view.people.find((p) => p.id === "p-alice");
    expect(alice).toBeDefined();
    const first = alice?.contributing[0];
    expect(first).toBeDefined();
    if (!first || !alice) return;
    const before = start.state.referrals.find((r) => r.id === first.referralId);
    expect(before).toBeDefined();
    const after = meddleReferral(start.state, first.referralId, {
      conviction: 1,
      confidence: 1,
      relationshipDepth: 1,
    });
    expect(after.error).toBeUndefined();
    const row = after.state.referrals.find((r) => r.id === first.referralId);
    expect(row?.updatedAt).toBe(before?.updatedAt);
    expect(after.view.people.find((p) => p.id === "p-alice")?.v2Signal).not.toBe(alice.v2Signal);
  });

  test("a new referral and a compare are validated then folded into the view", () => {
    const start = loadClub();
    const referred = addReferral(start.state, {
      referrerId: "p-alice",
      candidateId: "p-cleo",
      conviction: 5,
      confidence: 5,
      relationshipDepth: 4,
      evidenceType: "firsthand_work",
      evidenceText: "Watched her rewrite a stuck systems problem in a day.",
    });
    if (referred.error) {
      // Seed may already have Alice → Cleo; any other member is fine.
      const fallback = addReferral(start.state, {
        referrerId: "p-fox",
        candidateId: "p-dev",
        conviction: 5,
        confidence: 4,
        relationshipDepth: 3,
        evidenceType: "artifact",
        evidenceText: "Read the work. It is unusually careful.",
      });
      expect(fallback.error).toBeUndefined();
      expect(fallback.view.counts.referrals).toBe(start.view.counts.referrals + 1);
    } else {
      expect(referred.view.counts.referrals).toBe(start.view.counts.referrals + 1);
    }

    const next = referred.error ? start : referred;
    const pair = next.view.nextCompare;
    expect(pair).not.toBeNull();
    if (!pair) return;
    const compared = addComparison(next.state, {
      personAId: pair.personAId,
      personBId: pair.personBId,
      dimension: pair.dimension,
      outcome: "a",
    });
    expect(compared.error).toBeUndefined();
    expect(compared.view.counts.comparisons).toBe(next.view.counts.comparisons + 1);
  });

  test("setNow is a pure time-step change", () => {
    const start = loadClub();
    const early = setNow(start.state, DEMO_T_START);
    expect(early.view.now).toBe(DEMO_T_START);
    expect(early.view.evaluatedReferrals).toBe(0);
  });

  test("judge timeline is live: first frame V2=V0, last frame moves, meddling changes it", () => {
    const start = loadClub();
    expect(start.view.timeline.length).toBeGreaterThan(2);
    const first = start.view.timeline[0];
    const last = start.view.timeline[start.view.timeline.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (!first || !last) return;
    expect(first.windowOpen).toBe(false);
    expect(first.evaluatedReferrals).toBe(0);
    for (const p of first.personas) expect(p.v2).toBe(p.v0);
    expect(last.windowOpen).toBe(true);
    expect(last.personas.some((p) => p.v2 !== p.v0)).toBe(true);

    const alice = start.view.people.find((p) => p.id === "p-alice");
    const referralId = alice?.contributing[0]?.referralId;
    expect(referralId).toBeDefined();
    if (!referralId) return;
    const meddled = meddleReferral(start.state, referralId, {
      conviction: 1,
      confidence: 1,
      relationshipDepth: 1,
    });
    const before = last.personas.find((p) => p.id === "p-alice")?.v2;
    const after = meddled.view.timeline[meddled.view.timeline.length - 1]?.personas.find(
      (p) => p.id === "p-alice",
    )?.v2;
    expect(after).not.toBe(before);
  });
});
