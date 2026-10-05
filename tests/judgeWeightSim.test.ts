import { describe, expect, test } from "bun:test";
import {
  admissionCredit,
  type Decision,
  type EvidenceItem,
  fadeShare,
  logit,
  movementCredit,
  movementScale,
  type Params,
  perEventBound,
  R7_DEFAULTS,
  type Recognition,
  rankPositions,
  referralWeight,
  s12Window,
  takeSnapshot,
} from "../scripts/judgeWeightSim/model.ts";
import { SCENARIOS } from "../scripts/judgeWeightSim/scenarios.ts";
import { type RunResult, simulate } from "../scripts/judgeWeightSim/sim.ts";
import {
  type CandidateSpec,
  type Council,
  generateWorld,
  type ReferralIntent,
  type World,
} from "../scripts/judgeWeightSim/world.ts";
import { mulberry32, shuffle } from "../src/seed/prng.ts";

/** A small club: the gate opens once three candidates have both snapshots. */
const P: Params = { ...R7_DEFAULTS, M: 3, sigmaMin: 0 };
const ANSWERS: Recognition[] = ["not_yet", "soon", "yes", "not_sure"];

/** Monthly output on a straight line, credentials 0.05 below it. */
function steady(
  id: string,
  intakeDay: number,
  level: number,
  slope: number,
  extra: EvidenceItem[] = [],
): CandidateSpec {
  const items: EvidenceItem[] = [];
  for (let day = intakeDay - 360; day < 1080; day += 30) {
    const value = level + (slope * (day - intakeDay)) / 365;
    const ingestedAt = Math.max(day, intakeDay);
    items.push({ id: `${id}:o${day}`, kind: "output", datedAt: day, ingestedAt, value });
    if (day % 180 === 0) {
      items.push({
        id: `${id}:s${day}`,
        kind: "selection",
        datedAt: day,
        ingestedAt,
        value: value - 0.05,
      });
    }
  }
  return {
    id,
    intakeDay,
    A: level,
    g: slope,
    credential: "neither",
    items: [...items, ...extra],
    onTimeItems: null,
  };
}

const BACKGROUND = [
  steady("b0", 0, 0.3, 0),
  steady("b1", 10, 0.4, 0.05),
  steady("b2", 20, 0.5, -0.02),
  steady("b3", 30, 0.6, 0.1),
  steady("b4", 40, 0.7, 0.03),
  steady("b5", 50, 0.45, 0.08),
];

const refer = (judge: string, candidate: string, day = 100, strength = 0.8): ReferralIntent => ({
  id: `${judge}>${candidate}`,
  judge,
  candidate,
  day,
  strength,
  answer: "not_yet",
});

function club(parts: {
  candidate?: CandidateSpec;
  intents: ReferralIntent[];
  decision?: Decision;
  council?: Council;
  deciders?: string[];
  reversals?: World["reversals"];
}): World {
  const candidate = parts.candidate ?? steady("x", 60, 0.55, 0.15);
  return {
    name: "club",
    days: 1080,
    judges: ["a", "b"].map((id) => ({ id, role: "honest", skill: 0.5, admin: false })),
    candidates: [...BACKGROUND, candidate],
    intents: parts.intents,
    council: parts.council ?? {
      kind: "scripted",
      decisions: new Map([["x", parts.decision ?? "admit"]]),
    },
    decisionLag: 30,
    deciders: new Map([["x", parts.deciders ?? []]]),
    reversals: parts.reversals ?? [],
    population: { meanA: 0.5, sdA: 0.12 },
  };
}

const monthly = (run: RunResult, judge: string): number[] => run.monthly.get(judge) ?? [];

describe("r7 invariants (§6) on every scenario", () => {
  for (const scenario of SCENARIOS) {
    const world = generateWorld(scenario.config(R7_DEFAULTS), 1);
    const run = simulate(world, R7_DEFAULTS);

    test(`${scenario.id}: w and ω stay strictly inside (0, 1) at every event`, () => {
      expect(run.bounds.minW).toBeGreaterThan(0);
      expect(run.bounds.maxW).toBeLessThan(1);
      expect(run.bounds.minOmega).toBeGreaterThan(0);
      expect(run.bounds.maxOmega).toBeLessThan(1);
    });

    test(`${scenario.id}: adding or settling one referral moves any logit w by at most the bound`, () => {
      expect(run.maxEventDelta.admission).toBeGreaterThan(0);
      expect(run.maxEventDelta.admission).toBeLessThanOrEqual(perEventBound(R7_DEFAULTS));
      expect(run.maxEventDelta.settle).toBeLessThanOrEqual(perEventBound(R7_DEFAULTS));
    });
  }
});

describe("r7 invariants (§6) on a small club", () => {
  test("recusal: a decision the judge took part in never changes that judge's weight", () => {
    const run = (decision: Decision, deciders: string[]) =>
      simulate(club({ intents: [refer("a", "x"), refer("b", "x")], decision, deciders }), P);
    expect(monthly(run("admit", ["a"]), "a")).toEqual(monthly(run("deny", ["a"]), "a"));
    expect(monthly(run("admit", []), "a")).not.toEqual(monthly(run("deny", []), "a"));
  });

  test("no self-caused credit: when the decision rested entirely on the judge, early credit is 0", () => {
    const council: Council = {
      kind: "scored",
      signal: 1,
      substance: 0,
      credentials: 0,
      threshold: 0.5,
      noise: new Map(),
    };
    // Admission credit lands on day 160; accuracy only on day 280. Month 6 ends on day 179.
    const alone = simulate(club({ intents: [refer("a", "x")], council }), P);
    expect(monthly(alone, "a")[5]).toBeCloseTo(P.mu0, 12);
    const shared = simulate(club({ intents: [refer("a", "x"), refer("b", "x")], council }), P);
    expect(monthly(shared, "a")[5]).toBeGreaterThan(P.mu0);
  });

  test("no permanent credit: a referral without a starting snapshot never carries admission credit", () => {
    const noOutput = steady("x", 60, 0.55, 0.15);
    noOutput.items = noOutput.items.filter((i) => i.kind === "selection");
    const both = [refer("a", "x"), refer("b", "x")];
    const run = simulate(club({ candidate: noOutput, intents: both }), P);
    for (const w of monthly(run, "a")) expect(w).toBeCloseTo(P.mu0, 12);
    const control = simulate(club({ intents: both }), P);
    expect(monthly(control, "a")[5]).toBeGreaterThan(P.mu0);
  });

  test("settlement: once settled, only the movement term remains, whatever the admission was", () => {
    const p = { ...P, beta: 1 };
    const run = (decision: Decision) =>
      simulate(club({ intents: [refer("a", "x"), refer("b", "x")], decision }), p);
    // Admission on day 160, settlement on day 495; month 9 ends on day 269, month 21 on day 629.
    expect(monthly(run("admit"), "a")[8]).not.toBeCloseTo(monthly(run("deny"), "a")[8] ?? 0, 6);
    expect(monthly(run("admit"), "a")[20]).toBeCloseTo(monthly(run("deny"), "a")[20] ?? 0, 12);
  });

  test("fixed decision date: a reversal after t + D never changes any weight", () => {
    // The council decides on day 130; admission is scored on day t + max(D, G + S) = 160.
    const both = [refer("a", "x"), refer("b", "x")];
    const reversed = [{ candidate: "x", day: 145, decision: "deny" as const }];
    const run = (D: number, reversals: World["reversals"]) =>
      simulate(club({ intents: both, reversals }), { ...P, D });
    expect(run(30, reversed).judges).toEqual(run(30, []).judges);
    expect(run(60, reversed).judges).not.toEqual(run(60, []).judges);
  });

  test("no manufactured movement: pre-referral evidence ingested after s0 changes neither s12 nor any weight", () => {
    const late: EvidenceItem = {
      id: "x:late",
      kind: "output",
      datedAt: 90,
      ingestedAt: 450,
      value: 2,
    };
    const base = steady("x", 60, 0.55, 0.15);
    const withLate = steady("x", 60, 0.55, 0.15, [late]);
    expect(takeSnapshot(withLate.items, s12Window(100, P), P)).toEqual(
      takeSnapshot(base.items, s12Window(100, P), P),
    );
    const a = simulate(club({ candidate: base, intents: [refer("a", "x")] }), P);
    const b = simulate(club({ candidate: withLate, intents: [refer("a", "x")] }), P);
    expect(b.judges).toEqual(a.judges);
    const onTime = steady("x", 60, 0.55, 0.15, [{ ...late, ingestedAt: 120 }]);
    const c = simulate(club({ candidate: onTime, intents: [refer("a", "x")] }), P);
    expect(c.judges).not.toEqual(a.judges);
  });

  test("gate: below M, movement never reaches a weight", () => {
    const rising = steady("x", 60, 0.55, 0.15);
    const falling = steady("x", 60, 0.55, 0.15);
    // Diverges only after the day-280 accuracy score, so only movement can tell them apart.
    falling.items = falling.items.filter((i) => i.datedAt <= 300);
    const run = (candidate: CandidateSpec, p: Params) =>
      simulate(club({ candidate, intents: [refer("a", "x")] }), p);
    const closed = { ...P, M: 1000 };
    expect(run(rising, closed).judges).toEqual(run(falling, closed).judges);
    expect(run(rising, P).judges).not.toEqual(run(falling, P).judges);
    expect(movementScale(P.M - 1, 1, P)).toBe(0);
    expect(movementScale(P.M + 5, 0, { ...P, sigmaMin: 0.01 })).toBe(0);
  });

  test("fade: a dead-band settlement still shrinks the accuracy term", () => {
    // Recused, so no admission credit; a huge dead band, so d = 0. Settlement is on day 495.
    const p = { ...P, h: 100 };
    const run = simulate(club({ intents: [refer("a", "x")], deciders: ["a"] }), p);
    const before = Math.abs(logit(monthly(run, "a")[15] ?? 0) - logit(P.mu0));
    const after = Math.abs(logit(monthly(run, "a")[16] ?? 0) - logit(P.mu0));
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    for (let n = 0; n < 50; n++) expect(fadeShare(n + 1, P)).toBeLessThan(fadeShare(n, P));
  });
});

describe("r7 invariants (§6) on the formulas", () => {
  test("position: an earlier position earns at least as much, for rewards and penalties alike", () => {
    for (const [alpha, phi] of [
      [0.75, 0.2],
      [1.5, 0.1],
      [0.3, 0.5],
    ] as const) {
      const p = { ...R7_DEFAULTS, alpha, phi };
      for (const answer of ANSWERS) {
        for (let k = 1; k < 12; k += 0.5) {
          const early = referralWeight(k, 0.05, answer, p);
          const later = referralWeight(k + 0.5, 0.05, answer, p);
          expect(movementCredit(early, 1, 0.1, p)).toBeGreaterThanOrEqual(
            movementCredit(later, 1, 0.1, p),
          );
          expect(movementCredit(early, 1, -0.1, p)).toBeLessThanOrEqual(
            movementCredit(later, 1, -0.1, p),
          );
          expect(admissionCredit(early, "admit", 0.2, p)).toBeGreaterThanOrEqual(
            admissionCredit(later, "admit", 0.2, p),
          );
          expect(admissionCredit(early, "deny", 0.2, p)).toBeLessThanOrEqual(
            admissionCredit(later, "deny", 0.2, p),
          );
        }
      }
    }
  });

  test("position: same-day ties share the average position; recused referrals take none", () => {
    const ranked = rankPositions([
      { id: "r1", judge: "a", day: 5, eligible: true },
      { id: "r2", judge: "b", day: 5, eligible: true },
      { id: "r3", judge: "c", day: 3, eligible: false },
      { id: "r4", judge: "d", day: 9, eligible: true },
    ]);
    expect([...ranked.entries()].sort()).toEqual([
      ["r1", 1.5],
      ["r2", 1.5],
      ["r4", 3],
    ]);
  });

  test("symmetric bets: for every recognition answer a rise and an equal fall pay the same size", () => {
    for (const answer of ANSWERS) {
      const q = referralWeight(1, 0.05, answer, R7_DEFAULTS);
      for (const d of [0.01, 0.05, 0.2]) {
        const up = movementCredit(q, 1.4, d, R7_DEFAULTS);
        expect(up).toBeGreaterThan(0);
        expect(movementCredit(q, 1.4, -d, R7_DEFAULTS)).toBe(-up);
      }
      expect(admissionCredit(q, "deny", 0.3, R7_DEFAULTS)).toBe(
        -admissionCredit(q, "admit", 0.3, R7_DEFAULTS),
      );
    }
  });
});

describe("r7 storage invariants on a full scenario", () => {
  const world = generateWorld(SCENARIOS[2]?.config(R7_DEFAULTS) as never, 7);

  test("arrival order: the same evidence in any order gives the same snapshots and results", () => {
    const rng = mulberry32(99);
    const shuffled: World = {
      ...world,
      candidates: world.candidates.map((c) => ({ ...c, items: shuffle(rng, c.items) })),
    };
    const a = simulate(world, R7_DEFAULTS);
    const b = simulate(shuffled, R7_DEFAULTS);
    expect(b.referrals).toEqual(a.referrals);
    expect(b.judges).toEqual(a.judges);
  });

  test("refit: later e versions never change a result already stored", () => {
    const full = simulate(world, R7_DEFAULTS);
    const early = simulate({ ...world, days: 720 }, R7_DEFAULTS);
    const stored = early.referrals.filter((r) => r.settlement !== null);
    expect(stored.length).toBeGreaterThan(10);
    for (const r of stored) {
      const later = full.referrals.find((f) => f.intent.id === r.intent.id);
      expect(later?.settlement).toEqual(r.settlement);
    }
    const versions = full.referrals.flatMap((r) => (r.settlement ? [r.settlement.eVersion] : []));
    const storedMax = Math.max(...stored.map((r) => r.settlement?.eVersion ?? 0));
    expect(Math.max(...versions)).toBeGreaterThan(storedMax);
  });

  test("determinism: one seed gives one world and one run", () => {
    const again = generateWorld(SCENARIOS[2]?.config(R7_DEFAULTS) as never, 7);
    expect(again).toEqual(world);
    expect(simulate(again, R7_DEFAULTS)).toEqual(simulate(world, R7_DEFAULTS));
  });

  test("label: a judge is provisional until N scored signals", () => {
    const run = simulate(world, { ...R7_DEFAULTS, N: 1_000_000 });
    expect(run.judges.every((j) => j.label === "provisional")).toBe(true);
    const calibrated = simulate(world, { ...R7_DEFAULTS, N: 1 });
    expect(calibrated.judges.some((j) => j.label === "calibrated")).toBe(true);
  });
});
