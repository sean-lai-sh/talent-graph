import { describe, expect, test } from "bun:test";
import {
  admissionCredit,
  type Curve,
  checkpointWindow,
  creditCurve,
  type Decision,
  EMPTY_TERMS,
  type EvidenceItem,
  type FitPoint,
  type FlagBook,
  fadeShare,
  fitNorm,
  logit,
  logitWeight,
  movementBeyondNormal,
  movementCredit,
  movementScale,
  type Params,
  R10_DEFAULTS,
  type Recognition,
  rankPositions,
  referralWeight,
  takeSnapshot,
  weights,
} from "../scripts/judgeWeightSim/model.ts";
import { boundSlack, preselected, SCENARIOS } from "../scripts/judgeWeightSim/scenarios.ts";
import { latestSettlement, type RunResult, simulate } from "../scripts/judgeWeightSim/sim.ts";
import {
  type CandidateSpec,
  type Council,
  type FlagIntent,
  generateWorld,
  type ReferralIntent,
  type World,
} from "../scripts/judgeWeightSim/world.ts";
import { mulberry32, shuffle } from "../src/seed/prng.ts";

/** A small club: the gate opens once three candidates have both snapshots. */
const P: Params = { ...R10_DEFAULTS, M: 3, sigmaMin: 0 };
const ANSWERS: Recognition[] = ["not_yet", "soon", "yes", "not_sure"];
const CURVES: { curve: Curve; h: number; p: number }[] = [
  { curve: "G1", h: 0.3, p: 1 },
  { curve: "G2", h: 0.5, p: 1 },
  { curve: "G3", h: 0.5, p: 1.25 },
  { curve: "G3", h: 0.25, p: 1.5 },
];

function output(id: string, day: number, value: number, availableAt = day): EvidenceItem {
  return {
    id,
    kind: "output",
    datedAt: day,
    availableAt,
    channel: "submitted",
    value,
    inflation: 0,
  };
}

/** Monthly output on a straight line, credentials `credentialGap` below it (0.05 by default). */
function steady(
  id: string,
  intakeDay: number,
  level: number,
  slope: number,
  extra: EvidenceItem[] = [],
  credentialGap = 0.05,
): CandidateSpec {
  const items: EvidenceItem[] = [];
  for (let day = intakeDay - 360; day < 1500; day += 30) {
    const value = level + (slope * (day - intakeDay)) / 365;
    const availableAt = Math.max(day, intakeDay);
    items.push(output(`${id}:o${day}`, day, value, availableAt));
    if (day % 180 === 0) {
      items.push({
        ...output(`${id}:s${day}`, day, value - credentialGap, availableAt),
        kind: "selection",
      });
    }
  }
  return {
    id,
    intakeDay,
    A: level,
    g: slope,
    credential: "neither",
    breakout: null,
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

const refer = (
  judge: string,
  candidate: string,
  day = 100,
  answer: Recognition = "yes",
): ReferralIntent => ({
  id: `${judge}>${candidate}`,
  judge,
  candidate,
  day,
  strength: 0.8,
  answer,
});

function club(parts: {
  candidate?: CandidateSpec;
  intents: ReferralIntent[];
  decision?: Decision;
  council?: Council;
  deciders?: string[];
  reversals?: World["reversals"];
  flags?: FlagIntent[];
  days?: number;
}): World {
  const candidate = parts.candidate ?? steady("x", 60, 0.55, 0.15);
  return {
    name: "club",
    days: parts.days ?? 1080,
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
    committee: new Map([
      ["m1", 0.05],
      ["m2", 0.05],
      ["m3", 0.05],
    ]),
    relations: [],
    flags: parts.flags ?? [],
    population: { meanA: 0.5, sdA: 0.12, meanG: 0.02 },
  };
}

const SIGNAL_COUNCIL: Council = {
  kind: "scored",
  signal: 1,
  substance: 0,
  credentials: 0,
  threshold: 0.5,
  noise: new Map(),
};

const monthly = (run: RunResult, judge: string): number[] => run.monthly.get(judge) ?? [];
// Factors and admission credit land on day 160 and accuracy on day 280, so month 6 (day 179) shows admission alone.
const MONTH6 = 5;

describe("r10 invariants (§6) on every scenario", () => {
  for (const scenario of SCENARIOS) {
    const world = generateWorld(scenario.config(R10_DEFAULTS), 1);
    const run = simulate(world, R10_DEFAULTS);

    test(`${scenario.id}: w and ω stay strictly inside (0, 1) at every event`, () => {
      expect(run.bounds.minW).toBeGreaterThan(0);
      expect(run.bounds.maxW).toBeLessThan(1);
      expect(run.bounds.minOmega).toBeGreaterThan(0);
      expect(run.bounds.maxOmega).toBeLessThan(1);
    });

    test(`${scenario.id}: every event kind stays within its per-event bound`, () => {
      expect(run.maxEventDelta.factors).toBeGreaterThan(0);
      expect(run.maxEventDelta.settle).toBeGreaterThan(0);
      expect(boundSlack(run, R10_DEFAULTS)).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("r10 weight scale", () => {
  test("soft cap: no total, however large, rounds w or ω to 0 or 1 in floating point", () => {
    for (const T of [2, 3, 5]) {
      const p = { ...R10_DEFAULTS, T };
      for (const sumA of [-1e9, -1e3, -40, 40, 1e3, 1e9]) {
        const { w, omega } = weights(logitWeight({ ...EMPTY_TERMS, sumA }, 0, p), p);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThan(1);
        expect(omega).toBeGreaterThan(0);
        expect(omega).toBeLessThan(1);
      }
    }
  });

  test("soft cap: one event moves logit w by no more than it moves Σ", () => {
    for (let s = -10; s <= 10; s += 0.5) {
      for (const step of [-2, -0.3, 0.3, 2]) {
        const before = logitWeight({ ...EMPTY_TERMS, sumA: s }, 0, R10_DEFAULTS);
        const after = logitWeight({ ...EMPTY_TERMS, sumA: s + step }, 0, R10_DEFAULTS);
        expect(Math.abs(after - before)).toBeLessThanOrEqual(Math.abs(step) + 1e-12);
      }
    }
  });
});

describe("r10 invariants (§6) on a small club", () => {
  test("recusal: a decision the judge took part in never gives that judge admission credit", () => {
    const run = (decision: Decision, deciders: string[]) =>
      simulate(club({ intents: [refer("a", "x"), refer("b", "x")], decision, deciders }), P);
    expect(monthly(run("admit", ["a"]), "a")).toEqual(monthly(run("deny", ["a"]), "a"));
    expect(monthly(run("admit", []), "a")).not.toEqual(monthly(run("deny", []), "a"));
  });

  test("no self-caused credit: an admission resting entirely on the judge gives no early credit", () => {
    const alone = simulate(club({ intents: [refer("a", "x")], council: SIGNAL_COUNCIL }), P);
    expect(monthly(alone, "a")[MONTH6]).toBeCloseTo(P.mu0, 12);
    const shared = simulate(
      club({ intents: [refer("a", "x"), refer("b", "x")], council: SIGNAL_COUNCIL }),
      P,
    );
    expect(monthly(shared, "a")[MONTH6]).toBeGreaterThan(P.mu0);
  });

  test("denials: the early debit doesn't depend on ρ", () => {
    // A flat candidate: no credential gap, so the denial is not escrowed.
    const candidate = steady("x", 60, 0.55, 0);
    const run = (decision: Decision, intents: ReferralIntent[]) =>
      monthly(simulate(club({ candidate, intents, decision }), P), "a")[MONTH6] ?? Number.NaN;
    const alone = [refer("a", "x")];
    const shared = [refer("a", "x"), refer("b", "x", 101)];
    expect(run("deny", alone)).toBeLessThan(P.mu0);
    expect(run("deny", alone)).toBeCloseTo(run("deny", shared), 12);
    expect(run("admit", alone)).not.toBeCloseTo(run("admit", shared), 6);
  });

  test("escrow: a denied pre-credential referral's debit is held, and the answer never changes that", () => {
    const run = (candidate: CandidateSpec, answer: Recognition) =>
      monthly(
        simulate(club({ candidate, intents: [refer("a", "x", 100, answer)], decision: "deny" }), P),
        "a",
      ).slice(0, MONTH6 + 1);
    const preCredential = steady("x", 60, 0.55, 0, [], 0.3);
    const flat = steady("x", 60, 0.55, 0);
    for (const answer of ANSWERS) {
      for (const w of run(preCredential, answer)) expect(w).toBeCloseTo(P.mu0, 12);
      expect(run(flat, answer)[MONTH6]).toBeLessThan(P.mu0);
    }
  });

  test("no permanent credit: a referral without s0 never carries admission credit", () => {
    const both = [refer("a", "x"), refer("b", "x")];
    const beforeIntake = steady("x", 400, 0.55, 0.15);
    const run = simulate(club({ candidate: beforeIntake, intents: both }), P);
    expect(monthly(run, "a")[MONTH6]).toBeCloseTo(P.mu0, 12);
    expect(run.referrals.every((r) => r.settlements.every((s) => s === null))).toBe(true);
    const control = simulate(club({ intents: both }), P);
    expect(monthly(control, "a")[MONTH6]).toBeGreaterThan(P.mu0);
  });

  test("settlement: once settled, only the movement term remains, whatever the admission was", () => {
    const p = { ...P, beta: 1 };
    const run = (decision: Decision) =>
      simulate(club({ intents: [refer("a", "x"), refer("b", "x")], decision }), p);
    // Settlement is on day 495; month 9 ends on day 269, month 21 on day 629.
    expect(monthly(run("admit"), "a")[8]).not.toBeCloseTo(monthly(run("deny"), "a")[8] ?? 0, 6);
    expect(monthly(run("admit"), "a")[20]).toBeCloseTo(monthly(run("deny"), "a")[20] ?? 0, 12);
  });

  test("settlement: a later checkpoint replaces the earlier movement term instead of adding to it", () => {
    // Pre-credential, so it settles at 12 and 24 months; a huge T keeps the soft cap linear.
    const candidate = steady("x", 60, 0.55, 0.15, [], 0.3);
    const p = { ...P, T: 1e6 };
    const run = (horizons: number[]) =>
      simulate(club({ candidate, intents: [refer("a", "x")], days: 900 }), { ...p, horizons });
    const both = run([365, 730]);
    const first = run([365]);
    const [s12, s24] = both.referrals[0]?.settlements ?? [];
    expect(s12).not.toBeNull();
    expect(s24).not.toBeNull();
    const gap = (both.judges[0]?.logit ?? 0) - (first.judges[0]?.logit ?? 0);
    expect(gap).toBeCloseTo(both.kappaM * ((s24?.ell ?? 0) - (s12?.ell ?? 0)), 9);
    expect(Math.abs(gap - both.kappaM * (s24?.ell ?? 0))).toBeGreaterThan(1e-6);
  });

  test("fixed decision date: a reversal after t + D never changes any weight", () => {
    // The council decides on day 130; factors are fixed on day t + max(D, G + S) = 160.
    const both = [refer("a", "x"), refer("b", "x")];
    const reversed = [{ candidate: "x", day: 145, decision: "deny" as const }];
    const run = (D: number, reversals: World["reversals"]) =>
      simulate(club({ intents: both, reversals }), { ...P, D });
    expect(run(30, reversed).judges).toEqual(run(30, []).judges);
    expect(run(60, reversed).judges).not.toEqual(run(60, []).judges);
  });

  test("no manufactured movement: withholding pre-referral evidence settles exactly as on time", () => {
    const strong = output("x:strong", 90, 0.9, 90);
    const onTime = steady("x", 60, 0.55, 0.15, [strong]);
    const withheld = steady("x", 60, 0.55, 0.15, [{ ...strong, availableAt: 450 }]);
    const run = (candidate: CandidateSpec) =>
      simulate(club({ candidate, intents: [refer("a", "x")] }), P);
    const a = run(onTime);
    const b = run(withheld);
    expect(b.referrals[0]?.settlements[0]?.d).toBe(a.referrals[0]?.settlements[0]?.d as number);
    expect(b.referrals[0]?.corrections).toBe(1);
    const never = run(steady("x", 60, 0.55, 0.15));
    expect(never.referrals[0]?.settlements[0]?.d).not.toBe(
      a.referrals[0]?.settlements[0]?.d as number,
    );
  });

  test("refit: a correction after settlement re-settles under the stored version, not a newer one", () => {
    // Settles on day 495 under the quarter-450 fits; the late item lands on day 700, after two newer releases.
    const late = output("x:late", 90, 0.9, 700);
    const run = (days: number) =>
      simulate(
        club({ candidate: steady("x", 60, 0.55, 0.15, [late]), intents: [refer("a", "x")], days }),
        P,
      );
    const before = run(600).referrals[0]?.settlements[0];
    const after = run(1080).referrals[0];
    expect(after?.corrections).toBe(1);
    expect(after?.settlements[0]?.version).toBe(before?.version as number);
    expect(after?.settlements[0]?.d).not.toBe(before?.d as number);
  });

  test("equal effort: evidence only a committee check can find never reaches a movement result", () => {
    const deep = (id: string, day: number): EvidenceItem => ({
      ...output(id, day, 1.2, day),
      channel: "deep",
    });
    const plain = steady("x", 60, 0.55, 0.15);
    const dug = steady("x", 60, 0.55, 0.15, [deep("x:d1", 300), deep("x:d2", 400)]);
    const run = (candidate: CandidateSpec) =>
      simulate(club({ candidate, intents: [refer("a", "x")] }), P).referrals[0]?.settlements;
    expect(run(dug)).toEqual(run(plain));
  });

  test("gate: below M, movement never reaches a weight", () => {
    const rising = steady("x", 60, 0.55, 0.15);
    const flat = steady("x", 60, 0.55, 0.15);
    // Diverges only after the day-280 accuracy score, so only movement can tell them apart.
    flat.items = flat.items.filter((i) => i.datedAt <= 300);
    const run = (candidate: CandidateSpec, p: Params) =>
      simulate(club({ candidate, intents: [refer("a", "x")] }), p);
    const closed = { ...P, M: 1000 };
    expect(run(rising, closed).judges).toEqual(run(flat, closed).judges);
    expect(run(rising, P).judges).not.toEqual(run(flat, P).judges);
    expect(movementScale(P.M - 1, 1, P)).toBe(0);
    expect(movementScale(P.M + 5, 0, { ...P, sigmaMin: 0.01 })).toBe(0);
  });

  test("fade: a within-noise settlement still shrinks the accuracy term", () => {
    // Recused, so no admission credit; G1 with a huge band, so d = 0. Settlement is on day 495.
    const p: Params = { ...P, curve: "G1", h: 100 };
    const run = simulate(club({ intents: [refer("a", "x")], deciders: ["a"] }), p);
    expect(run.referrals[0]?.settlements[0]?.d).toBe(0);
    const before = Math.abs(logit(monthly(run, "a")[15] ?? 0) - logit(P.mu0));
    const after = Math.abs(logit(monthly(run, "a")[16] ?? 0) - logit(P.mu0));
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    for (let n = 0; n < 50; n++) expect(fadeShare(n + 1, P)).toBeLessThan(fadeShare(n, P));
  });
});

describe("r10 frozen fits (§3.6)", () => {
  test("refit: a fit never includes the settling candidate, not even its intake pair", () => {
    // Referred on day 500, long after the day-60 intake: x's own intake pair is in the fit it settles under.
    const run = simulate(club({ intents: [refer("a", "x", 500)] }), P);
    const s = run.referrals[0]?.settlements[0];
    const version = run.versions.find((v) => v.version === s?.version);
    const s0 = run.referrals[0]?.factors?.s0?.substance as number;
    const s12 = takeSnapshot(
      run.referrals[0] ? steady("x", 60, 0.55, 0.15).items : [],
      checkpointWindow(500, 365, P),
      P,
    ).substance;
    const points = version?.e[0] ?? [];
    expect(points.some((pt) => pt.id === "x")).toBe(true);
    const without = movementBeyondNormal(
      s0,
      s12,
      fitNorm(
        points.filter((pt) => pt.id !== "x"),
        P,
      ),
      P,
    );
    const withX = movementBeyondNormal(s0, s12, fitNorm(points, P), P);
    expect(s?.d).toBeCloseTo(without, 12);
    expect(Math.abs(withX - without)).toBeGreaterThan(1e-6);
  });
});

describe("r10 committee flags (§3.12) on a small club", () => {
  // x's best claim in the year after the day-100 referral, lowered by 0.2.
  const target = "x:o420";
  const flag = (accomplice: string | null, reverseAfter: number | null): FlagIntent => ({
    id: "flag:x",
    item: target,
    candidate: "x",
    amount: 0.2,
    proposedAt: 400,
    honest: false,
    proposer: "m1",
    accomplice,
    reverseAfter,
  });
  // Deferred in r10: flags only run with their switch on.
  const PF: Params = { ...P, flags: true };
  const run = (flags: FlagIntent[], p: Params = PF) =>
    simulate(club({ intents: [refer("a", "x")], flags }), p);
  const none = run([]);

  test("flags are off by default: even an approved pair's flag never runs", () => {
    const off = run([flag("m2", null)], P);
    expect(off.flags).toEqual([]);
    expect(off.referrals).toEqual(none.referrals);
  });

  test("a flag without a second approval has no effect", () => {
    const solo = run([flag(null, null)]);
    expect(solo.flags[0]?.approvedAt).toBeNull();
    expect(solo.referrals).toEqual(none.referrals);
    expect(solo.monthly).toEqual(none.monthly);
  });

  test("an approved flag lowers the claim, and its reversal restores every snapshot and settlement exactly", () => {
    const approved = run([flag("m2", null)]);
    expect(approved.flags[0]?.approvedAt).toBe(430);
    expect(approved.referrals[0]?.settlements[0]?.d).toBeLessThan(
      none.referrals[0]?.settlements[0]?.d as number,
    );
    // Approved before x's intake checkpoint (day 455) and reversed after the day-540
    // release, so that release's fits read the flag and must be rebuilt.
    const reversed = run([flag("m2", 120)]);
    expect(reversed.flags[0]?.reversedAt).toBe(550);
    expect(reversed.referrals).toEqual(none.referrals);
    expect(reversed.versions.map((v) => [v.f, v.e])).toEqual(none.versions.map((v) => [v.f, v.e]));
  });

  test("a flag never raises evidenceScore", () => {
    const items = steady("x", 60, 0.55, 0.1).items;
    const window = checkpointWindow(100, 365, P);
    const book: FlagBook = new Map([[target, [{ id: "f", amount: 0.3, approvedAt: 0 }]]]);
    const negative: FlagBook = new Map([[target, [{ id: "f", amount: -0.3, approvedAt: 0 }]]]);
    const plain = takeSnapshot(items, window, P).substance;
    expect(takeSnapshot(items, window, P, book).substance).toBeLessThan(plain);
    expect(takeSnapshot(items, window, P, negative).substance).toBe(plain);
  });
});

describe("r10 invariants (§6) on the formulas", () => {
  test("position: an earlier position earns at least as much, for rewards and penalties alike", () => {
    for (const [alpha, phi] of [
      [0.75, 0.2],
      [1.5, 0.1],
      [0.3, 0.5],
    ] as const) {
      const p = { ...R10_DEFAULTS, alpha, phi };
      for (const answer of ANSWERS) {
        for (let k = 1; k < 12; k += 0.5) {
          const early = referralWeight(k, 0.05, answer, p);
          const later = referralWeight(k + 0.5, 0.05, answer, p);
          expect(movementCredit(early, 1, 1, p)).toBeGreaterThanOrEqual(
            movementCredit(later, 1, 1, p),
          );
          expect(movementCredit(early, 1, -1, p)).toBeLessThanOrEqual(
            movementCredit(later, 1, -1, p),
          );
          expect(admissionCredit(early, "admit", 0.2, p)).toBeGreaterThanOrEqual(
            admissionCredit(later, "admit", 0.2, p),
          );
          expect(admissionCredit(early, "deny", 0, p)).toBeLessThanOrEqual(
            admissionCredit(later, "deny", 0, p),
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

  test("symmetric bets: for every answer and curve a rise and an equal fall pay the same size", () => {
    for (const shape of CURVES) {
      const p = { ...R10_DEFAULTS, ...shape };
      for (const answer of ANSWERS) {
        const q = referralWeight(1, 0.05, answer, p);
        for (const z of [0.4, 1, 4]) {
          const up = movementCredit(q, 1.4, creditCurve(z, p), p);
          expect(up).toBeGreaterThan(0);
          expect(movementCredit(q, 1.4, creditCurve(-z, p), p)).toBe(-up);
        }
        expect(admissionCredit(q, "deny", 0, p)).toBe(-admissionCredit(q, "admit", 0, p));
      }
    }
  });

  test("monotone curve: a larger rise always earns at least as much, for every shape", () => {
    for (const shape of CURVES) {
      const p = { ...R10_DEFAULTS, ...shape };
      let previous = Number.NEGATIVE_INFINITY;
      for (let z = -20; z <= 20; z += 0.05) {
        const credit = movementCredit(1.2, 1, creditCurve(z, p), p);
        expect(credit).toBeGreaterThanOrEqual(previous);
        previous = credit;
      }
    }
  });

  test("neutral centre: on a fit's own skewed data, the average credit is 0 for every shape", () => {
    const rng = mulberry32(6);
    const points: FitPoint[] = [];
    for (let i = 0; i < 400; i++) {
      const x = 0.3 + 0.4 * rng();
      points.push({ id: `c${i}`, x, y: 0.1 * x + rng() ** 3 * 0.2 });
    }
    for (const shape of CURVES) {
      const p = { ...R10_DEFAULTS, ...shape };
      const norm = fitNorm(points, p);
      const mean =
        points.reduce((s, pt) => {
          const z = (pt.y - norm.line.a - norm.line.b * pt.x) / norm.spread;
          return s + creditCurve(z - norm.centre, p);
        }, 0) / points.length;
      expect(Math.abs(mean)).toBeLessThan(1e-9);
    }
  });

  test("neutral centre: out of sample, a sprayer's credit per referral stays near 0 however many it makes", () => {
    const s3 = SCENARIOS.find((s) => s.id === "S3");
    const world = generateWorld(s3?.config(R10_DEFAULTS) as never, 1);
    for (const shape of CURVES) {
      const run = simulate(world, { ...R10_DEFAULTS, ...shape });
      const ds = run.referrals
        .filter((r) => r.intent.judge === "spray")
        .map((r) => latestSettlement(r)?.d)
        .filter((d): d is number => d !== undefined);
      expect(ds.length).toBeGreaterThan(80);
      const mean = (xs: number[]) => xs.reduce((s, d) => s + d, 0) / xs.length;
      const firstHalf = mean(ds.slice(0, Math.floor(ds.length / 2)));
      expect(Math.abs(mean(ds))).toBeLessThan(0.2);
      expect(Math.abs(mean(ds) - firstHalf)).toBeLessThan(0.2);
    }
  });
});

describe("r10 anti-cohort watch (§3.11) on the out-of-distribution scenario", () => {
  const s6 = SCENARIOS.find((s) => s.id === "S6");
  const world = generateWorld(s6?.config(R10_DEFAULTS) as never, 1);
  // Deferred in r10: the watch only runs with its switch on.
  const on = simulate(world, { ...R10_DEFAULTS, watch: true });
  const off = simulate(world, R10_DEFAULTS);

  test("the watch runs, and never changes any judge's weight or movement result", () => {
    expect(on.watch.checks.length).toBeGreaterThan(0);
    expect(off.watch.checks).toEqual([]);
    expect(on.monthly).toEqual(off.monthly);
    expect(on.referrals).toEqual(off.referrals);
  });

  test("committee separation: checking records never change a committee member's weight", () => {
    const members = [...world.committee.keys()].filter((m) => world.judges.some((j) => j.id === m));
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) expect(monthly(on, member)).toEqual(monthly(off, member));
  });

  test("budget: never more than B a quarter, half of them random, never more than C per judge, never a conflict", () => {
    const p = { ...R10_DEFAULTS, watch: true, B: 6, C: 1 };
    const run = simulate(world, p);
    const quarters = new Map<number, typeof run.watch.checks>();
    for (const check of run.watch.checks) {
      quarters.set(check.day, [...(quarters.get(check.day) ?? []), check]);
      // Conflicts as they stood on the check's day: anyone who had referred or voted by then.
      const referredBy = run.referrals
        .filter((r) => r.intent.candidate === check.candidate && r.intent.day <= check.day)
        .map((r) => r.intent.judge);
      const firstReferral = Math.min(
        ...run.referrals
          .filter((r) => r.intent.candidate === check.candidate)
          .map((r) => r.intent.day),
      );
      const votedBy =
        firstReferral + world.decisionLag <= check.day
          ? (world.deciders.get(check.candidate) ?? [])
          : [];
      expect([...referredBy, ...votedBy]).not.toContain(check.checker);
    }
    expect(quarters.size).toBeGreaterThan(3);
    for (const checks of quarters.values()) {
      expect(checks.length).toBeLessThanOrEqual(p.B);
      expect(checks.filter((c) => c.half === "random").length).toBeLessThanOrEqual(p.B / 2);
      const perJudge = new Map<string, number>();
      for (const c of checks) {
        for (const j of run.watch.eligible.get(c.candidate) ?? []) {
          perJudge.set(j, (perJudge.get(j) ?? 0) + 1);
        }
      }
      expect(Math.max(...perJudge.values())).toBeLessThanOrEqual(p.C);
    }
  });
});

describe("r10 trims", () => {
  test('recognition answers no longer change the stake: universal "Not yet" changes nothing', () => {
    const s4 = SCENARIOS.find((s) => s.id === "S4") as (typeof SCENARIOS)[number];
    const config = s4.config(R10_DEFAULTS);
    const honest = simulate(generateWorld(config, 1), R10_DEFAULTS);
    const notYet = simulate(generateWorld(s4.counterfactual?.(config) ?? config, 1), R10_DEFAULTS);
    expect(notYet.monthly).toEqual(honest.monthly);
    const answers = (run: RunResult) => run.referrals.map((r) => r.intent.answer);
    expect(answers(notYet)).not.toEqual(answers(honest));
  });

  test("volume scaling: past V settled referrals, the movement sum is scaled by V / n", () => {
    const p = { ...R10_DEFAULTS, T: 1e6 };
    const at = (nSettled: number) =>
      logitWeight({ ...EMPTY_TERMS, sumM: 1, nSettled }, 1, p) -
      logitWeight({ ...EMPTY_TERMS, sumM: 0, nSettled }, 1, p);
    expect(at(5)).toBeCloseTo(1, 6);
    expect(at(10)).toBeCloseTo(1, 6);
    expect(at(20)).toBeCloseTo(0.5, 6);
    expect(at(40)).toBeCloseTo(0.25, 6);
  });

  test("pre-selection: every candidate comes from the top quarter on level plus a year of slope", () => {
    const s1 = SCENARIOS[0] as (typeof SCENARIOS)[number];
    const score = (c: CandidateSpec) => (c.A + c.g - 0.52) / Math.hypot(0.12, 0.08);
    const pre = generateWorld(preselected(s1).config(R10_DEFAULTS), 1);
    const broad = generateWorld(s1.config(R10_DEFAULTS), 1);
    expect(Math.min(...pre.candidates.map(score))).toBeGreaterThanOrEqual(0.674);
    expect(broad.candidates.filter((c) => score(c) < 0.674).length).toBeGreaterThan(80);
    expect(pre.population.sdA).toBeLessThan(broad.population.sdA);
  });
});

describe("r10 storage invariants on a full scenario", () => {
  const s3 = generateWorld(SCENARIOS[2]?.config(R10_DEFAULTS) as never, 7);

  test("arrival order: the same evidence in any order gives the same snapshots and results", () => {
    const rng = mulberry32(99);
    const shuffled: World = {
      ...s3,
      candidates: s3.candidates.map((c) => ({ ...c, items: shuffle(rng, c.items) })),
    };
    const a = simulate(s3, R10_DEFAULTS);
    const b = simulate(shuffled, R10_DEFAULTS);
    expect(b.referrals).toEqual(a.referrals);
    expect(b.judges).toEqual(a.judges);
  });

  test("refit: later fit versions never change a result already stored", () => {
    // S1 has no late evidence, so no logged correction may legitimately re-settle a referral.
    const world = generateWorld(SCENARIOS[0]?.config(R10_DEFAULTS) as never, 7);
    const full = simulate(world, R10_DEFAULTS);
    const early = simulate({ ...world, days: 720 }, R10_DEFAULTS);
    const stored = early.referrals.filter((r) => r.settlements[0] !== null);
    expect(stored.length).toBeGreaterThan(10);
    for (const r of stored) {
      const later = full.referrals.find((f) => f.intent.id === r.intent.id);
      expect(later?.settlements[0]).toEqual(r.settlements[0]);
    }
    const used = full.referrals.flatMap((r) =>
      r.settlements[0] ? [r.settlements[0].version] : [],
    );
    const storedMax = Math.max(...stored.map((r) => r.settlements[0]?.version ?? 0));
    expect(Math.max(...used)).toBeGreaterThan(storedMax);
  });

  test("determinism: one seed gives one world and one run", () => {
    const again = generateWorld(SCENARIOS[2]?.config(R10_DEFAULTS) as never, 7);
    expect(again).toEqual(s3);
    expect(simulate(again, R10_DEFAULTS)).toEqual(simulate(s3, R10_DEFAULTS));
  });

  test("label: a judge is provisional until N scored signals", () => {
    const run = simulate(s3, { ...R10_DEFAULTS, N: 1_000_000 });
    expect(run.judges.every((j) => j.label === "provisional")).toBe(true);
    const calibrated = simulate(s3, { ...R10_DEFAULTS, N: 1 });
    expect(calibrated.judges.some((j) => j.label === "calibrated")).toBe(true);
  });
});
