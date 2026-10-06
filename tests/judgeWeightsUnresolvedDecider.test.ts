/**
 * SEA-79 / #120: a council decision whose deciding admin does not resolve to
 * exactly one person fails closed. The candidate's referrers who were admins
 * at that moment earn no admission credit from it; everyone else keeps theirs.
 *
 * End to end through the club: the admin lookup the decide mutation runs
 * (`adminReferrers`), the engine transition, a state stored as JSON and
 * revived, and the club pass under judge_reliability@4.1.0.
 */
import { describe, expect, test } from "bun:test";
import schema from "../apps/club/convex/schema.ts";
import { adminReferrers, BOOTSTRAP_ADMIN_EMAIL } from "../apps/club/lib/clubRole.ts";
import { admissionObservations } from "../apps/club/lib/engine/admission.ts";
import { runClubPass } from "../apps/club/lib/engine/pass.ts";
import { addReferral, decide, emptyState } from "../apps/club/lib/engine.ts";
import { clubToPerson, clubToReferral, reviveState } from "../apps/club/lib/serialize.ts";
import type { ClubDecider, ClubState } from "../apps/club/lib/types.ts";
import { type LoadedSpecs, loadSpecs } from "../src/config.ts";
import { JUDGE_RELIABILITY_V4_1_0 } from "../src/models/registry.ts";

const SPECS = loadSpecs({}, { warn: () => {} });
const V4_1: LoadedSpecs = { ...SPECS, judge_reliability: JUDGE_RELIABILITY_V4_1_0 };
const T0 = new Date("2026-01-01T00:00:00.000Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000).toISOString();

/** CLUB_ADMIN_EMAILS for these tests. */
const ENV_ADMINS = ["env@club.test"];

/**
 * alice: admin by a stored clubAccounts role. erin: admin only through the
 * env list. boss: the bootstrap email with no account. carol: a member.
 * bob: the candidate. rec: an admin who never referred.
 */
const PEOPLE = [
  { id: "alice", email: "alice@club.test", storedRoles: ["admin"] as const },
  { id: "erin", email: "ENV@club.test ", storedRoles: [] as const },
  { id: "boss", email: BOOTSTRAP_ADMIN_EMAIL, storedRoles: [] as const },
  { id: "carol", email: "carol@club.test", storedRoles: ["member"] as const },
  { id: "bob", email: "bob@club.test", storedRoles: [] as const },
  { id: "rec", email: "rec@club.test", storedRoles: ["admin"] as const },
];
const REFERRERS = ["alice", "erin", "boss", "carol"];

function club(): ClubState {
  let s = emptyState(day(0));
  for (const p of PEOPLE) {
    s.people.push({
      id: p.id,
      name: p.id,
      email: p.email,
      status: "candidate",
      reviewStatus: "new",
      createdAt: s.now,
      updatedAt: s.now,
    });
  }
  for (const from of REFERRERS) {
    const r = addReferral(s, {
      referrerId: from,
      candidateId: "bob",
      conviction: 4,
      confidence: 4,
      relationshipDepth: 4,
      evidenceType: "firsthand_work",
      evidenceText: "Seen it.",
    });
    expect(r.error).toBeUndefined();
    s = r.state;
  }
  return { ...s, now: day(30) };
}

/** What the decide mutation's lookup yields for bob's referrers. */
function adminsAmongReferrers(s: ClubState): string[] {
  const ids = new Set(s.referrals.filter((r) => r.candidateId === "bob").map((r) => r.referrerId));
  return adminReferrers(
    PEOPLE.filter((p) => ids.has(p.id)).map((p) => ({
      personId: p.id,
      email: p.email,
      storedRoles: p.storedRoles,
    })),
    ENV_ADMINS,
  );
}

/** Decide, store the state as Convex would (plain JSON), reload it. */
function decideAndReload(s: ClubState, decider: ClubDecider): ClubState {
  const done = decide(s, "bob", "admit", undefined, decider);
  expect(done.error).toBeUndefined();
  return reviveState(JSON.parse(JSON.stringify(done.state)) as ClubState);
}

/** Admission credit per judge from the club pass. */
function creditByJudge(s: ClubState): Map<string, number> {
  const pass = runClubPass({
    people: s.people.map(clubToPerson),
    referrals: s.referrals.map(clubToReferral),
    comparisons: [],
    outcomes: [],
    opportunities: [],
    admission: admissionObservations(s),
    now: new Date(day(400)),
    specs: V4_1,
  });
  return pass.calibration.admission?.sumByJudge ?? new Map();
}

describe("an unresolved decider fails closed", () => {
  test("the lookup counts stored, env-only and bootstrap admins, not members", () => {
    expect(adminsAmongReferrers(club()).sort()).toEqual(["alice", "boss", "erin"]);
  });

  test("admin referrers earn no admission credit; a non-admin referrer keeps hers", () => {
    const s = decideAndReload(club(), {
      unresolvedDecider: { adminReferrers: adminsAmongReferrers(club()) },
    });
    expect(s.snapshots[0]?.decidedBy).toBeUndefined();
    expect(s.snapshots[0]?.unresolvedDecider?.adminReferrers.sort()).toEqual([
      "alice",
      "boss",
      "erin",
    ]);
    const credit = creditByJudge(s);
    for (const admin of ["alice", "erin", "boss"]) expect(credit.has(admin)).toBe(false);
    expect(credit.get("carol") as number).toBeGreaterThan(0);
  });

  test("a resolved decider is unchanged: a non-referrer decider leaves every credit", () => {
    const credit = creditByJudge(decideAndReload(club(), { decidedBy: "rec" }));
    for (const judge of REFERRERS) expect(credit.get(judge) as number).toBeGreaterThan(0);
  });

  test("a resolved decider who referred is still recused, other admins keep credit", () => {
    const s = decideAndReload(club(), { decidedBy: "alice" });
    expect(s.snapshots[0]?.unresolvedDecider).toBeUndefined();
    const credit = creditByJudge(s);
    expect(credit.has("alice")).toBe(false);
    for (const judge of ["erin", "boss", "carol"]) {
      expect(credit.get(judge) as number).toBeGreaterThan(0);
    }
  });

  test("a snapshot without the marker loads and scores as before", () => {
    const s = decideAndReload(club(), {
      unresolvedDecider: { adminReferrers: adminsAmongReferrers(club()) },
    });
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    for (const snap of old.snapshots as Record<string, unknown>[]) delete snap.unresolvedDecider;
    const revived = reviveState(old as unknown as ClubState);
    expect(revived.snapshots[0] && "unresolvedDecider" in revived.snapshots[0]).toBe(false);
    const credit = creditByJudge(revived);
    for (const judge of REFERRERS) expect(credit.get(judge) as number).toBeGreaterThan(0);
    type Field = { isOptional: string };
    const fields = (
      schema.tables as unknown as Record<string, { validator: { fields: Record<string, Field> } }>
    ).clubSnapshots?.validator.fields as Record<string, Field>;
    expect(fields.unresolvedDecider?.isOptional).toBe("optional");
  });
});
