import { describe, expect, test } from "bun:test";
import {
  admissionCredit,
  checkpointWindow,
  compress,
  type Decision,
  deadBand,
  EMPTY_TERMS,
  type EvidenceItem,
  type FitPoint,
  fadeShare,
  fitNorm,
  logit,
  logitWeight,
  movementCredit,
  movementScale,
  type Params,
  R8_DEFAULTS,
  type Recognition,
  rankPositions,
  referralWeight,
  takeSnapshot,
  weights,
} from "../scripts/judgeWeightSim/model.ts";
import { boundSlack, SCENARIOS } from "../scripts/judgeWeightSim/scenarios.ts";
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
const P: Params = { ...R8_DEFAULTS, M: 3, sigmaMin: 0 };
const ANSWERS: Recognition[] = ["not_yet", "soon", "yes", "not_sure"];

function output(id: string, day: number, value: number, availableAt = day): EvidenceItem {
  return {
    id,
    kind: "output",
    datedAt: day,
    availableAt,
    channel: "submitted",
    value,
    inflation: 0,
    flaggedAt: null,
  };
}

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
    const availableAt = Math.max(day, intakeDay);
    items.push(output(`${id}:o${day}`, day, value, availableAt));
    if (day % 180 === 0) {
      items.push({
        ...output(`${id}:s${day}`, day, value - 0.05, availableAt),
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
    committee: new Map(),
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

describe("r8 invariants (§6) on every scenario", () => {
  for (const scenario of SCENARIOS) {
    const world = generateWorld(scenario.config(R8_DEFAULTS), 1);
    const run = simulate(world, R8_DEFAULTS);

    test(`${scenario.id}: w and ω stay strictly inside (0, 1) at every event`, () => {
      expect(run.bounds.minW).toBeGreaterThan(0);
      expect(run.bounds.maxW).toBeLessThan(1);
      expect(run.bounds.minOmega).toBeGreaterThan(0);
      expect(run.bounds.maxOmega).toBeLessThan(1);
    });

    test(`${scenario.id}: every event kind stays within its per-event bound`, () => {
      expect(run.maxEventDelta.factors).toBeGreaterThan(0);
      expect(run.maxEventDelta.settle12).toBeGreaterThan(0);
      expect(boundSlack(run, R8_DEFAULTS)).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("r8 weight scale", () => {
  test("soft cap: no total, however large, rounds w or ω to 0 or 1 in floating point", () => {
    for (const T of [2, 3, 5]) {
      const p = { ...R8_DEFAULTS, T };
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
        const before = logitWeight({ ...EMPTY_TERMS, sumA: s }, 0, R8_DEFAULTS);
        const after = logitWeight({ ...EMPTY_TERMS, sumA: s + step }, 0, R8_DEFAULTS);
        expect(Math.abs(after - before)).toBeLessThanOrEqual(Math.abs(step) + 1e-12);
      }
    }
  });
});

describe("r8 invariants (§6) on a small club", () => {
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
    // A flat candidate: no credential gap, so a "Yes, already" denial is not a contrarian bet.
    const candidate = steady("x", 60, 0.55, 0);
    const run = (decision: Decision, intents: ReferralIntent[]) =>
      monthly(simulate(club({ candidate, intents, decision }), P), "a")[MONTH6] ?? Number.NaN;
    const alone = [refer("a", "x")];
    const shared = [refer("a", "x"), refer("b", "x", 101)];
    expect(run("deny", alone)).toBeLessThan(P.mu0);
    expect(run("deny", alone)).toBeCloseTo(run("deny", shared), 12);
    expect(run("admit", alone)).not.toBeCloseTo(run("admit", shared), 6);
  });

  test("escrow: a denied contrarian bet's debit is not applied before settlement", () => {
    const candidate = steady("x", 60, 0.55, 0);
    const run = (answer: Recognition) =>
      simulate(club({ candidate, intents: [refer("a", "x", 100, answer)], decision: "deny" }), P);
    for (const w of monthly(run("not_yet"), "a").slice(0, MONTH6 + 1)) {
      expect(w).toBeCloseTo(P.mu0, 12);
    }
    expect(monthly(run("yes"), "a")[MONTH6]).toBeLessThan(P.mu0);
  });

  test("no permanent credit: a referral without s0 never carries admission credit", () => {
    const both = [refer("a", "x"), refer("b", "x")];
    const beforeIntake = steady("x", 400, 0.55, 0.15);
    const run = simulate(club({ candidate: beforeIntake, intents: both }), P);
    expect(monthly(run, "a")[MONTH6]).toBeCloseTo(P.mu0, 12);
    expect(run.referrals.every((r) => r.settle12 === null)).toBe(true);
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
    expect(b.referrals[0]?.settle12?.d).toBe(a.referrals[0]?.settle12?.d as number);
    expect(b.referrals[0]?.corrections).toBe(1);
    const never = run(steady("x", 60, 0.55, 0.15));
    expect(never.referrals[0]?.settle12?.d).not.toBe(a.referrals[0]?.settle12?.d as number);
  });

  test("refit: a correction after settlement re-settles under the stored version, not a newer one", () => {
    // Settles on day 495 under the quarter-450 fits; the late item lands on day 700, after two newer releases.
    const late = output("x:late", 90, 0.9, 700);
    const run = (days: number) =>
      simulate(
        {
          ...club({ candidate: steady("x", 60, 0.55, 0.15, [late]), intents: [refer("a", "x")] }),
          days,
        },
        P,
      );
    const before = run(600).referrals[0]?.settle12;
    const after = run(1080).referrals[0];
    expect(after?.corrections).toBe(1);
    expect(after?.settle12?.version).toBe(before?.version as number);
    expect(after?.settle12?.d).not.toBe(before?.d as number);
  });

  test("equal effort: evidence only a committee check can find never reaches a movement result", () => {
    const deep = (id: string, day: number): EvidenceItem => ({
      ...output(id, day, 1.2, day),
      channel: "deep",
    });
    const plain = steady("x", 60, 0.55, 0.15);
    const dug = steady("x", 60, 0.55, 0.15, [deep("x:d1", 300), deep("x:d2", 400)]);
    const run = (candidate: CandidateSpec) =>
      simulate(club({ candidate, intents: [refer("a", "x")] }), P).referrals[0]?.settle12;
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

describe("r8 invariants (§6) on the formulas", () => {
  test("position: an earlier position earns at least as much, for rewards and penalties alike", () => {
    for (const [alpha, phi] of [
      [0.75, 0.2],
      [1.5, 0.1],
      [0.3, 0.5],
    ] as const) {
      const p = { ...R8_DEFAULTS, alpha, phi };
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

  test("symmetric bets: for every recognition answer a rise and an equal fall pay the same size", () => {
    for (const answer of ANSWERS) {
      const q = referralWeight(1, 0.05, answer, R8_DEFAULTS);
      for (const d of [0.1, 1, 4]) {
        const up = movementCredit(q, 1.4, d, R8_DEFAULTS);
        expect(up).toBeGreaterThan(0);
        expect(movementCredit(q, 1.4, -d, R8_DEFAULTS)).toBe(-up);
      }
      expect(admissionCredit(q, "deny", 0, R8_DEFAULTS)).toBe(
        -admissionCredit(q, "admit", 0, R8_DEFAULTS),
      );
    }
  });

  test("compression: a larger rise earns at least as much, and a breakout more than a modest rise", () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let d = -20; d <= 20; d += 0.25) {
      const credit = movementCredit(1.2, 1, d, R8_DEFAULTS);
      expect(credit).toBeGreaterThanOrEqual(previous);
      previous = credit;
    }
    expect(compress(4)).toBeGreaterThan(compress(1));
    expect(compress(4)).toBeLessThan(4 * compress(1));
  });

  test("no drift from the dead band: residuals drawn symmetric about the fitted normal give E[d] = 0", () => {
    const rng = mulberry32(5);
    const points: FitPoint[] = [];
    for (let i = 0; i < 400; i++) {
      const x = 0.3 + 0.4 * rng();
      const noise = (rng() - 0.5) * 0.1;
      points.push({ x, y: 0.02 + 0.1 * x + noise }, { x, y: 0.02 + 0.1 * x - noise });
    }
    for (const h of [0, 0.3, 0.6, 1]) {
      const norm = fitNorm(points, { ...R8_DEFAULTS, h });
      const mean =
        points.reduce(
          (s, pt) =>
            s + deadBand((pt.y - norm.line.a - norm.line.b * pt.x - norm.median) / norm.spread, h),
          0,
        ) / points.length;
      expect(Math.abs(mean)).toBeLessThan(1e-9);
    }
  });

  test("no drift, neutral centre: even on skewed movement the fitted d averages 0", () => {
    const rng = mulberry32(6);
    const points: FitPoint[] = [];
    for (let i = 0; i < 400; i++) {
      const x = 0.3 + 0.4 * rng();
      points.push({ x, y: 0.1 * x + rng() ** 3 * 0.2 });
    }
    for (const h of [0, 0.3, 0.6]) {
      const p: Params = { ...R8_DEFAULTS, h, centre: "neutral" };
      const norm = fitNorm(points, p);
      const mean =
        points.reduce(
          (s, pt) =>
            s + deadBand((pt.y - norm.line.a - norm.line.b * pt.x - norm.median) / norm.spread, h),
          0,
        ) / points.length;
      expect(Math.abs(mean)).toBeLessThan(1e-6);
    }
  });

  test("committee input: a flag never raises evidenceScore", () => {
    const exaggerated: EvidenceItem = {
      ...output("x:big", 100, 0.9),
      inflation: 0.2,
      flaggedAt: 200,
    };
    const items = [...steady("x", 60, 0.55, 0.1).items, exaggerated];
    const before = takeSnapshot(items, checkpointWindow(0, 150, R8_DEFAULTS), R8_DEFAULTS);
    const after = takeSnapshot(items, checkpointWindow(0, 365, R8_DEFAULTS), R8_DEFAULTS);
    const unflagged = takeSnapshot(
      items.map((i) => (i.id === "x:big" ? { ...i, flaggedAt: null } : i)),
      checkpointWindow(0, 365, R8_DEFAULTS),
      R8_DEFAULTS,
    );
    expect(before.substance).toBeGreaterThan(0);
    expect(after.substance).toBeLessThan(unflagged.substance);
  });
});

describe("r8 anti-cohort watch (§3.11) on the out-of-distribution scenario", () => {
  const s6 = SCENARIOS.find((s) => s.id === "S6");
  const world = generateWorld(s6?.config(R8_DEFAULTS) as never, 1);
  const on = simulate(world, R8_DEFAULTS);
  const off = simulate(world, { ...R8_DEFAULTS, B: 0 });

  test("the watch runs and releases escrow in this world", () => {
    expect(on.watch.checks.length).toBeGreaterThan(0);
    expect(on.referrals.some((r) => r.admission?.state === "released")).toBe(true);
    expect(off.watch.checks).toEqual([]);
  });

  test("equal effort: watch checks never change any judge's movement result", () => {
    const results = (run: RunResult) =>
      run.referrals.map((r) => [r.intent.id, r.settle12, r.settle24]);
    expect(results(on)).toEqual(results(off));
  });

  test("release, never reward: no judge is ever above where they'd be without the watch", () => {
    for (const j of world.judges) {
      const withWatch = monthly(on, j.id);
      const without = monthly(off, j.id);
      expect(withWatch.length).toBe(without.length);
      for (const [i, w] of withWatch.entries()) {
        expect(w).toBeLessThanOrEqual((without[i] ?? 0) + 1e-12);
      }
    }
  });

  test("committee separation: checking records never change a committee member's weight", () => {
    expect(world.committee.size).toBeGreaterThan(0);
    for (const member of world.committee.keys()) {
      expect(monthly(on, member)).toEqual(monthly(off, member));
    }
  });

  test("budget and recusal: never more than B checks a quarter, never by a referrer or decider", () => {
    const p = { ...R8_DEFAULTS, B: 3 };
    const run = simulate(world, p);
    const perQuarter = new Map<number, number>();
    for (const check of run.watch.checks) {
      perQuarter.set(check.day, (perQuarter.get(check.day) ?? 0) + 1);
      expect(run.watch.recusedFrom.get(check.candidate)?.has(check.checker)).toBe(false);
    }
    expect(Math.max(...perQuarter.values())).toBe(3);
  });
});

describe("r8 storage invariants on a full scenario", () => {
  const s3 = generateWorld(SCENARIOS[2]?.config(R8_DEFAULTS) as never, 7);

  test("arrival order: the same evidence in any order gives the same snapshots and results", () => {
    const rng = mulberry32(99);
    const shuffled: World = {
      ...s3,
      candidates: s3.candidates.map((c) => ({ ...c, items: shuffle(rng, c.items) })),
    };
    const a = simulate(s3, R8_DEFAULTS);
    const b = simulate(shuffled, R8_DEFAULTS);
    expect(b.referrals).toEqual(a.referrals);
    expect(b.judges).toEqual(a.judges);
  });

  test("refit: later fit versions never change a result already stored", () => {
    // S1 has no late evidence, so no logged correction may legitimately re-settle a referral.
    const world = generateWorld(SCENARIOS[0]?.config(R8_DEFAULTS) as never, 7);
    const full = simulate(world, R8_DEFAULTS);
    const early = simulate({ ...world, days: 720 }, R8_DEFAULTS);
    const stored = early.referrals.filter((r) => r.settle12 !== null);
    expect(stored.length).toBeGreaterThan(10);
    for (const r of stored) {
      const later = full.referrals.find((f) => f.intent.id === r.intent.id);
      expect(later?.settle12).toEqual(r.settle12);
    }
    const used = full.referrals.flatMap((r) => (r.settle12 ? [r.settle12.version] : []));
    const storedMax = Math.max(...stored.map((r) => r.settle12?.version ?? 0));
    expect(Math.max(...used)).toBeGreaterThan(storedMax);
  });

  test("determinism: one seed gives one world and one run", () => {
    const again = generateWorld(SCENARIOS[2]?.config(R8_DEFAULTS) as never, 7);
    expect(again).toEqual(s3);
    expect(simulate(again, R8_DEFAULTS)).toEqual(simulate(s3, R8_DEFAULTS));
  });

  test("label: a judge is provisional until N scored signals", () => {
    const run = simulate(s3, { ...R8_DEFAULTS, N: 1_000_000 });
    expect(run.judges.every((j) => j.label === "provisional")).toBe(true);
    const calibrated = simulate(s3, { ...R8_DEFAULTS, N: 1 });
    expect(calibrated.judges.some((j) => j.label === "calibrated")).toBe(true);
  });
});
