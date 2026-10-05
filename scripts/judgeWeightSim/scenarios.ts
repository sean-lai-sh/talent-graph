/**
 * The five §5 scenarios. Each states its data-generating process, builds a
 * world from a seed, and carries its pass criteria as explicit, thresholded
 * checks. A criterion's metric is oriented so larger is better and it passes
 * when the metric is at least `floor`; `scale` turns the distance to the
 * floor into a margin comparable across criteria.
 */

import { logit, type Params, perEventBound } from "./model.ts";
import { type RunResult, simulate } from "./sim.ts";
import { generateWorld, type JudgeArchetype, type World, type WorldConfig } from "./world.ts";

export interface Criterion {
  id: string;
  /** The spec's pass condition, in words. */
  claim: string;
  /** The stated threshold, in words. */
  threshold: string;
  /** "mean" averages the metric over replicates; "worst" takes the minimum. */
  aggregate: "mean" | "worst";
  /** NaN when the replicate never exercised the criterion. */
  measure: (run: RunResult, world: World, p: Params) => number;
  floor: number;
  scale: number;
}

export interface Scenario {
  id: string;
  name: string;
  /** The data-generating process; only S5's depends on a parameter (M). */
  config: (p: Params) => WorldConfig;
  criteria: Criterion[];
}

// --- statistics -----------------------------------------------------------------

function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.v === order[i]?.v) j++;
    for (let n = i; n <= j; n++) out[(order[n] as { i: number }).i] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(x: readonly number[], y: readonly number[]): number {
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  const mean = (n + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (rx[i] as number) - mean;
    const dy = (ry[i] as number) - mean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

const logitOf = (run: RunResult, id: string): number =>
  run.judges.find((j) => j.id === id)?.logit ?? Number.NaN;

const skillOrder = (run: RunResult, world: World, ids?: readonly string[]): number => {
  const judges = world.judges.filter((j) => !ids || ids.includes(j.id));
  return spearman(
    judges.map((j) => j.skill),
    judges.map((j) => logitOf(run, j.id)),
  );
};

/** Spearman of weight against skill on the given month's weights. */
const skillOrderAt = (run: RunResult, world: World, month: number): number =>
  spearman(
    world.judges.map((j) => j.skill),
    world.judges.map((j) => run.monthly.get(j.id)?.[month - 1] ?? Number.NaN),
  );

// --- judge archetypes ------------------------------------------------------------

/** An honest judge whose perception noise on level and slope shrinks with skill. */
function honest(id: string, skill: number, extra: Partial<JudgeArchetype> = {}): JudgeArchetype {
  return {
    id,
    role: "honest",
    skill,
    levelNoise: 0.02 + 0.2 * (1 - skill),
    slopeNoise: 0.02 + 0.2 * (1 - skill),
    lagDays: 10,
    consensus: 0,
    pickZ: 1,
    honesty: 1,
    ...extra,
  };
}

const BASE: Omit<WorldConfig, "name" | "judges" | "council"> = {
  days: 36 * 30,
  candidates: 150,
  arrivalDays: 24 * 30,
  pEvidence: 0.6,
  slowShare: 0,
  councilNoise: 0.4,
  decidersPerDecision: 2,
  coachBoost: 0,
  withholdUntil: null,
};

const FAIR_COUNCIL = {
  kind: "scored",
  signal: 0.2,
  substance: 1,
  credentials: 0.3,
  threshold: 1.2,
} as const;

const S1_JUDGES: JudgeArchetype[] = [0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25].map(
  (skill, i) => honest(`j${i + 1}`, skill, { admin: i === 1 || i === 4 || i === 6 }),
);

// --- S1 --------------------------------------------------------------------------

/**
 * S1 best case. 150 candidates arrive over 24 months, A ~ N(0.5, 0.12) and
 * g ~ N(0.02, 0.08) per year; output evidence in 60% of months, ingested
 * within two weeks. Credentials lag substance for fast risers and catch up
 * over ~18 months. Eight honest judges, skill 0.95 down to 0.25 (perception
 * noise 0.03–0.17 on level and slope), all looking 10–30 days after intake,
 * honest recognition answers. Three are admins; two admins decide each case.
 * Fair council: mostly visible substance, a little signal and credentials.
 */
const S1: Scenario = {
  id: "S1",
  name: "Best case",
  config: () => ({ ...BASE, name: "S1", judges: S1_JUDGES, council: FAIR_COUNCIL }),
  criteria: [
    {
      id: "S1.a",
      claim: "True skill order recovered by month 36",
      threshold: "mean Spearman(skill, weight) ≥ 0.7",
      aggregate: "mean",
      measure: (run, world) => skillOrder(run, world),
      floor: 0.7,
      scale: 0.3,
    },
    {
      id: "S1.b",
      claim: "Skill order already visible early, from admission (goal 1)",
      threshold: "mean Spearman at month 12 ≥ 0.5",
      aggregate: "mean",
      measure: (run, world) => skillOrderAt(run, world, 12),
      floor: 0.5,
      scale: 0.5,
    },
  ],
};

// --- S2 --------------------------------------------------------------------------

/**
 * S2 mostly good. S1's world plus one consensus-picker `cp`: the same level
 * perception as j3 (skill 0.75), but it ranks candidates 90% on visible
 * credentials, so it refers already-credentialed people, and answers the
 * recognition question honestly (mostly "Yes, already").
 */
const S2: Scenario = {
  id: "S2",
  name: "Mostly good",
  config: () => ({
    ...BASE,
    name: "S2",
    judges: [
      ...S1_JUDGES,
      { ...honest("cp", 0.75), role: "consensus-picker", skill: 0.2, consensus: 0.9 },
    ],
    council: FAIR_COUNCIL,
  }),
  criteria: [
    {
      id: "S2.a",
      claim: "The consensus-picker ends below early spotters of equal or better accuracy",
      threshold: "mean of min logit(j1..j3) − logit(cp) ≥ 0",
      aggregate: "mean",
      measure: (run) =>
        Math.min(...["j1", "j2", "j3"].map((id) => logitOf(run, id))) - logitOf(run, "cp"),
      floor: 0,
      scale: 0.5,
    },
    {
      id: "S2.b",
      claim: "The consensus-picker ends below its equal-accuracy twin j3 in every replicate",
      threshold: "worst logit(j3) − logit(cp) > 0",
      aggregate: "worst",
      measure: (run) => logitOf(run, "j3") - logitOf(run, "cp"),
      floor: 1e-9,
      scale: 0.5,
    },
  ],
};

// --- S3 --------------------------------------------------------------------------

/**
 * S3 mixed. An early spotter (skill 0.9, looks on intake day), three ordinary
 * honest judges (0.6, 0.5, 0.4, looking 3–4 months after intake), a consensus-picker (0.2), a sprayer who refers everyone on intake
 * day at full strength saying "Not yet" (skill 0), and a noisy judge (0.1,
 * perception noise 0.4). Admins: h1, the consensus-picker and the noisy judge.
 * 30% of candidates' evidence reaches us 3–6 months late.
 */
const S3: Scenario = {
  id: "S3",
  name: "Mixed",
  config: () => ({
    ...BASE,
    name: "S3",
    slowShare: 0.3,
    judges: [
      honest("spot", 0.9, { role: "early spotter", lagDays: 0 }),
      honest("h1", 0.6, { lagDays: 90, admin: true }),
      honest("h2", 0.5, { lagDays: 90 }),
      honest("h3", 0.4, { lagDays: 120 }),
      {
        ...honest("cp", 0.6),
        role: "consensus-picker",
        skill: 0.2,
        consensus: 0.9,
        admin: true,
      },
      { ...honest("spray", 0), role: "sprayer", spray: true, honesty: 0 },
      {
        ...honest("noisy", 0.1),
        role: "noisy",
        levelNoise: 0.4,
        slopeNoise: 0.4,
        admin: true,
      },
    ],
    council: FAIR_COUNCIL,
  }),
  criteria: [
    {
      id: "S3.a",
      claim: "Skill order recovered",
      threshold: "mean Spearman(skill, weight) ≥ 0.6",
      aggregate: "mean",
      measure: (run, world) => skillOrder(run, world),
      floor: 0.6,
      scale: 0.4,
    },
    {
      id: "S3.b",
      claim: "The sprayer doesn't gain from first positions: it ends at or below μ0",
      threshold: "mean logit μ0 − logit(spray) ≥ 0",
      aggregate: "mean",
      measure: (run, _w, p) => logit(p.mu0) - logitOf(run, "spray"),
      floor: 0,
      scale: 0.5,
    },
    {
      id: "S3.c",
      claim: "The sprayer ends below every honest judge",
      threshold: "mean of min logit(honest) − logit(spray) ≥ 0",
      aggregate: "mean",
      measure: (run) =>
        Math.min(...["spot", "h1", "h2", "h3"].map((id) => logitOf(run, id))) -
        logitOf(run, "spray"),
      floor: 0,
      scale: 0.5,
    },
  ],
};

// --- S4 --------------------------------------------------------------------------

const S4_SPOTTERS = ["sp1", "sp2", "sp3"];
const S4_GAMERS = ["col1", "col2"];

/**
 * S4 adversarial. Three honest early spotters (0.9, 0.8, 0.7; sp3 is an
 * admin), two honest ordinary judges (0.5, 0.4; admins). A colluding pair:
 * col1 picks with poor perception (noise 0.25) at a low bar and also refers
 * its friends (8% of candidates) on intake day; col2 refers whatever col1
 * refers one day later. Both always answer "Not yet" at full strength. Every
 * candidate they refer is coached: output dated after the referral is
 * inflated by 0.06. Their friends withhold their two best pre-intake outputs
 * until 8 months after intake. The council leans on credentials (1.2) over
 * substance (0.3), so pre-credential candidates are often denied.
 */
const S4: Scenario = {
  id: "S4",
  name: "Adversarial",
  config: () => ({
    ...BASE,
    name: "S4",
    coachBoost: 0.06,
    withholdUntil: 240,
    judges: [
      honest("sp1", 0.9, { role: "honest spotter", lagDays: 0 }),
      honest("sp2", 0.8, { role: "honest spotter", lagDays: 0 }),
      honest("sp3", 0.7, { role: "honest spotter", lagDays: 0, admin: true }),
      honest("h1", 0.5, { lagDays: 60, admin: true }),
      honest("h2", 0.4, { lagDays: 60, admin: true }),
      {
        ...honest("col1", 0.1),
        role: "colluder (leader)",
        levelNoise: 0.25,
        slopeNoise: 0.25,
        pickZ: 0.8,
        lagDays: 0,
        honesty: 0,
        coaches: true,
        friendsShare: 0.08,
      },
      { ...honest("col2", 0.1), role: "colluder (follower)", follows: "col1", coaches: true },
    ],
    council: { kind: "scored", signal: 0.2, substance: 0.3, credentials: 1.2, threshold: 0.6 },
  }),
  criteria: [
    {
      id: "S4.a",
      claim: "Gamers don't outrank honest spotters",
      threshold: "mean of min logit(spotters) − max logit(colluders) ≥ 0",
      aggregate: "mean",
      measure: (run) =>
        Math.min(...S4_SPOTTERS.map((id) => logitOf(run, id))) -
        Math.max(...S4_GAMERS.map((id) => logitOf(run, id))),
      floor: 0,
      scale: 0.5,
    },
    {
      id: "S4.b",
      claim: "Withheld evidence never creates movement",
      threshold: "worst over settled withheld referrals of −(d − d_on_time) ≥ −1e-9",
      aggregate: "worst",
      measure: (run) => {
        const created = run.referrals
          .map((r) => r.settlement)
          .filter((s) => s !== null && s.dOnTime !== null)
          .map((s) => (s?.d ?? 0) - (s?.dOnTime ?? 0));
        return created.length === 0 ? Number.NaN : -Math.max(...created);
      },
      floor: -1e-9,
      scale: 0.05,
    },
    {
      id: "S4.c",
      claim: "Denied-but-rose judges still gain at settlement",
      threshold: "worst over denied, d > 0 referrals of κ_m(end)·ℓᴹ − ℓᴬ > 0",
      aggregate: "worst",
      measure: (run) => {
        const gains = run.referrals
          .filter(
            (r) => r.admission?.decision === "deny" && r.settlement !== null && r.settlement.d > 0,
          )
          .map((r) => {
            const s = r.settlement as NonNullable<typeof r.settlement>;
            return run.kappaM * s.ell - s.removedA;
          });
        return gains.length === 0 ? Number.NaN : Math.min(...gains);
      },
      floor: 1e-9,
      scale: 0.1,
    },
  ],
};

// --- S5 --------------------------------------------------------------------------

/**
 * S5 worst case. Two honest judges (0.7, 0.5) among six gamers: three
 * sprayers who refer everyone on intake day saying "Not yet" at full
 * strength (one is an admin), a colluding pair, and a consensus-picker. The
 * council follows the visible Referral Signal alone: admit when it exceeds
 * 2.5 μ0-weight full-strength referrals, so three sprayers at μ0 already
 * admit everyone. Evidence in only 15% of months. A tiny cohort of M + 3
 * candidates arriving over 23 months, so the number with both snapshots ends
 * near M.
 */
const S5: Scenario = {
  id: "S5",
  name: "Worst case",
  config: (p) => ({
    ...BASE,
    name: "S5",
    candidates: p.M + 3,
    arrivalDays: 23 * 30,
    pEvidence: 0.15,
    councilNoise: 0,
    decidersPerDecision: 1,
    judges: [
      honest("h1", 0.7, { admin: true }),
      honest("h2", 0.5),
      { ...honest("g1", 0), role: "sprayer", spray: true, honesty: 0, admin: true },
      { ...honest("g2", 0), role: "sprayer", spray: true, honesty: 0 },
      { ...honest("g3", 0), role: "sprayer", spray: true, honesty: 0 },
      {
        ...honest("col1", 0.05),
        role: "colluder (leader)",
        levelNoise: 0.25,
        slopeNoise: 0.25,
        pickZ: 0.5,
        lagDays: 0,
        honesty: 0,
        friendsShare: 0.2,
      },
      { ...honest("col2", 0.05), role: "colluder (follower)", follows: "col1" },
      { ...honest("cp", 0.6), role: "consensus-picker", skill: 0.2, consensus: 0.9 },
    ],
    council: { kind: "scored", signal: 1, substance: 0, credentials: 0, threshold: 2.5 },
  }),
  criteria: [
    {
      id: "S5.a",
      claim: "No weight leaves (0, 1)",
      threshold: "worst min(w, ω, 1 − w, 1 − ω) over every event > 0",
      aggregate: "worst",
      measure: (run) =>
        Math.min(
          run.bounds.minW,
          run.bounds.minOmega,
          1 - run.bounds.maxW,
          1 - run.bounds.maxOmega,
        ),
      floor: 1e-12,
      scale: 0.3,
    },
    {
      id: "S5.b",
      claim: "No single event exceeds the per-event bound",
      threshold: "worst (B − max |Δ logit w| over add and settle events) ≥ 0, B = Lᴬ + κLᴹ + fade",
      aggregate: "worst",
      measure: (run, _w, p) =>
        perEventBound(p) - Math.max(run.maxEventDelta.admission, run.maxEventDelta.settle),
      floor: 0,
      scale: 0.5,
    },
    {
      id: "S5.c",
      claim: "The loop doesn't run away: the highest weight stays near μ0",
      threshold: "worst (0.6 − max final w) ≥ 0",
      aggregate: "worst",
      measure: (run) => 0.6 - Math.max(...run.judges.map((j) => j.w)),
      floor: 0,
      scale: 0.1,
    },
    {
      id: "S5.d",
      claim: "Weights stay near μ0 on average",
      threshold: "mean (0.1 − mean |w − μ0|) ≥ 0",
      aggregate: "mean",
      measure: (run, _w, p) =>
        0.1 - run.judges.reduce((s, j) => s + Math.abs(j.w - p.mu0), 0) / run.judges.length,
      floor: 0,
      scale: 0.05,
    },
    {
      id: "S5.e",
      claim: "Movement stays off below the gate",
      threshold: "worst movement share of any logit while K < M or spread < σ_min = 0",
      aggregate: "worst",
      measure: (run) => -run.gateLeak,
      floor: 0,
      scale: 0.1,
    },
  ],
};

export const SCENARIOS: readonly Scenario[] = [S1, S2, S3, S4, S5];

// --- evaluation -------------------------------------------------------------------

export interface CriterionResult {
  criterion: Criterion;
  metric: number;
  pass: boolean;
  /** (metric − floor) / scale; −Infinity when never exercised. */
  margin: number;
}

export interface ScenarioResult {
  scenario: Scenario;
  results: CriterionResult[];
  runs: { world: World; run: RunResult }[];
}

export type WorldCache = Map<string, World>;

export function evaluateScenario(
  scenario: Scenario,
  p: Params,
  seeds: readonly number[],
  cache: WorldCache = new Map(),
): ScenarioResult {
  const runs = seeds.map((seed) => {
    const config = scenario.config(p);
    const key = `${JSON.stringify(config)}#${seed}`;
    let world = cache.get(key);
    if (!world) {
      world = generateWorld(config, seed);
      cache.set(key, world);
    }
    return { world, run: simulate(world, p) };
  });
  const results = scenario.criteria.map((criterion) => {
    const values = runs
      .map(({ world, run }) => criterion.measure(run, world, p))
      .filter((v) => !Number.isNaN(v));
    const metric =
      values.length === 0
        ? Number.NaN
        : criterion.aggregate === "mean"
          ? values.reduce((s, v) => s + v, 0) / values.length
          : Math.min(...values);
    const pass = !Number.isNaN(metric) && metric >= criterion.floor;
    const margin = Number.isNaN(metric)
      ? Number.NEGATIVE_INFINITY
      : (metric - criterion.floor) / criterion.scale;
    return { criterion, metric, pass, margin };
  });
  return { scenario, results, runs };
}
