/**
 * The r9 §5 scenarios. Each states its data-generating process, builds a
 * world from a seed, and carries its criteria as explicit, thresholded
 * checks. A criterion's metric is oriented so larger is better and it passes
 * when the metric is at least `floor`; `scale` turns the distance to the floor
 * into a margin comparable across criteria. Some criteria compare against a
 * counterfactual world: the same seed with one thing changed.
 */

import { logit, nearCeiling, type Params, perEventBound } from "./model.ts";
import { BOUND_OF, latestSettlement, type RunResult, simulate } from "./sim.ts";
import { generateWorld, type JudgeArchetype, type World, type WorldConfig } from "./world.ts";

export interface Criterion {
  id: string;
  /** The spec's pass condition, in words. */
  claim: string;
  /** The stated threshold, in words. */
  threshold: string;
  /** "mean" averages the metric over replicates; "worst" takes the minimum. */
  aggregate: "mean" | "worst";
  /** NaN when the replicate never exercised the criterion. `cf` is the counterfactual run, if any. */
  measure: (run: RunResult, world: World, p: Params, cf: RunResult | null) => number;
  floor: number;
  scale: number;
  /**
   * "check": pass/fail with a margin. "binary": pass/fail, never in the margin
   * (an invariant that holds exactly). "report": printed, never pass/fail.
   */
  kind: "check" | "binary" | "report";
}

export interface Scenario {
  id: string;
  name: string;
  /** The data-generating process; only S5's depends on a parameter (M). */
  config: (p: Params) => WorldConfig;
  /** The same world with one thing changed, for criteria that compare against it. */
  counterfactual?: (c: WorldConfig) => WorldConfig;
  /** Parameters this variant fixes on top of the ones being evaluated. */
  params?: Partial<Params>;
  /** False for scenarios that test invariants of the design, not of the parameters. */
  sweep: boolean;
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

/** Smallest slack, over every event kind, between its bound and its largest effect. */
export function boundSlack(run: RunResult, p: Params): number {
  return Math.min(
    ...Object.entries(BOUND_OF).map(([kind, bound]) => {
      const limit = bound === "none" || bound === undefined ? 0 : perEventBound(bound, p);
      return limit - run.maxEventDelta[kind as keyof RunResult["maxEventDelta"]];
    }),
  );
}

export const logitOf = (run: RunResult, id: string): number =>
  run.judges.find((j) => j.id === id)?.logit ?? Number.NaN;

const skillOrder = (run: RunResult, world: World): number =>
  spearman(
    world.judges.map((j) => j.skill),
    world.judges.map((j) => logitOf(run, j.id)),
  );

/** Spearman of weight against skill on the given month's weights. */
const skillOrderAt = (run: RunResult, world: World, month: number): number =>
  spearman(
    world.judges.map((j) => j.skill),
    world.judges.map((j) => run.monthly.get(j.id)?.[month - 1] ?? Number.NaN),
  );

/** Judges whose weight sits near the soft-cap ceiling (tanh(Σ/T) ≥ 0.9). */
export const atCeiling = (run: RunResult, p: Params): number =>
  run.judges.filter((j) => nearCeiling(j.logit, p)).length;

/** Largest difference between two runs in any judge's monthly weight. */
const maxWeightGap = (a: RunResult, b: RunResult): number => {
  let gap = 0;
  for (const [id, ws] of a.monthly) {
    const other = b.monthly.get(id) ?? [];
    ws.forEach((w, i) => {
      gap = Math.max(gap, Math.abs(w - (other[i] ?? Number.NaN)));
    });
  }
  return gap;
};

/**
 * Largest difference between two runs in any referral's stored s0 or movement
 * result d. ℓᴹ is left out: its stake reads ρ from a decision snapshot, which
 * is history and never recomputed.
 */
const maxStoredGap = (a: RunResult, b: RunResult): number => {
  const other = new Map(b.referrals.map((r) => [r.intent.id, r]));
  let gap = 0;
  for (const r of a.referrals) {
    // A referral only one run has follows from a different council decision: history, not a snapshot.
    const o = other.get(r.intent.id);
    if (!o) continue;
    gap = Math.max(
      gap,
      Math.abs((r.factors?.s0?.substance ?? 0) - (o.factors?.s0?.substance ?? 0)),
    );
    r.settlements.forEach((s, k) => {
      const t = o.settlements[k];
      if ((s === null) !== (t === null)) gap = Number.POSITIVE_INFINITY;
      else if (s && t) gap = Math.max(gap, Math.abs(s.d - t.d));
    });
  }
  return gap;
};

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
  arrivalStart: 0,
  pEvidence: 0.6,
  slowShare: 0,
  councilNoise: 0.4,
  decidersPerDecision: 2,
  coachBoost: 0,
  flagRate: 0,
  malice: null,
  extraCommittee: [],
  relations: [],
  withholdUntil: null,
  ood: null,
  preselect: null,
};

/** S4's stated probability that an exaggerated claim gets a flag proposed (§3.12). */
export const S4_FLAG_RATE = 0.6;

const FAIR_COUNCIL = {
  kind: "scored",
  signal: 0.2,
  substance: 1,
  credentials: 0.3,
  threshold: 1.2,
} as const;

const CREDENTIAL_COUNCIL = {
  kind: "scored",
  signal: 0.2,
  substance: 0.3,
  credentials: 1.2,
  threshold: 0.6,
} as const;

const S1_JUDGES: JudgeArchetype[] = [0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25].map(
  (skill, i) => honest(`j${i + 1}`, skill, { admin: i === 1 || i === 4 || i === 6 }),
);

// --- S1 --------------------------------------------------------------------------

/**
 * S1 best case. 150 candidates arrive over 24 months, A ~ N(0.5, 0.12) and
 * g ~ N(0.02, 0.08) per year; output evidence in 60% of months, submitted
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
  sweep: true,
  criteria: [
    {
      id: "S1.a",
      claim: "True skill order recovered by month 36",
      threshold: "mean Spearman(skill, weight) ≥ 0.7",
      aggregate: "mean",
      measure: (run, world) => skillOrder(run, world),
      floor: 0.7,
      scale: 0.3,
      kind: "check",
    },
    {
      id: "S1.b",
      claim: "Skill order already visible early, from admission (goal 1)",
      threshold: "mean Spearman at month 12 ≥ 0.5",
      aggregate: "mean",
      measure: (run, world) => skillOrderAt(run, world, 12),
      floor: 0.5,
      scale: 0.5,
      kind: "check",
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
  sweep: true,
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
      kind: "check",
    },
    {
      id: "S2.b",
      claim: "The consensus-picker ends below its equal-accuracy twin j3 in every replicate",
      threshold: "worst logit(j3) − logit(cp) > 0",
      aggregate: "worst",
      measure: (run) => logitOf(run, "j3") - logitOf(run, "cp"),
      floor: 1e-9,
      scale: 0.5,
      kind: "check",
    },
  ],
};

// --- S3 --------------------------------------------------------------------------

const S3_HONEST = ["spot", "h1", "h2", "h3"];

/**
 * S3 mixed. An early spotter (skill 0.9, looks on intake day), three ordinary
 * honest judges (0.6, 0.5, 0.4, looking 3–4 months after intake), a
 * consensus-picker (0.2), a sprayer who refers everyone on intake day at full
 * strength saying "Not yet" (skill 0), a noisy judge (0.1, perception noise
 * 0.4), and a one-hit judge (0.05): perception noise 0.4, plus one sure
 * referral of the first candidate, who breaks out by 0.35 seven months after
 * intake. Admins: h1, the consensus-picker and the noisy judge. 30% of
 * candidates' evidence reaches us 3–6 months late.
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
      {
        ...honest("lucky", 0.05),
        role: "one-hit",
        levelNoise: 0.4,
        slopeNoise: 0.4,
        luckyHit: true,
      },
    ],
    council: FAIR_COUNCIL,
  }),
  sweep: true,
  criteria: [
    {
      id: "S3.a",
      claim: "Skill order recovered",
      threshold: "mean Spearman(skill, weight) ≥ 0.6",
      aggregate: "mean",
      measure: (run, world) => skillOrder(run, world),
      floor: 0.6,
      scale: 0.4,
      kind: "check",
    },
    {
      id: "S3.b",
      claim: "The sprayer doesn't gain from first positions: it ends at or below μ0",
      threshold: "mean logit μ0 − logit(spray) ≥ 0",
      aggregate: "mean",
      measure: (run, _w, p) => logit(p.mu0) - logitOf(run, "spray"),
      floor: 0,
      scale: 0.5,
      kind: "check",
    },
    {
      id: "S3.c",
      claim: "The sprayer ends below every honest judge",
      threshold: "mean of min logit(honest) − logit(spray) ≥ 0",
      aggregate: "mean",
      measure: (run) =>
        Math.min(...S3_HONEST.map((id) => logitOf(run, id))) - logitOf(run, "spray"),
      floor: 0,
      scale: 0.5,
      kind: "check",
    },
    {
      id: "S3.d",
      claim: "The one-hit judge ends below the consistent spotter",
      threshold: "mean logit(spot) − logit(lucky) ≥ 0",
      aggregate: "mean",
      measure: (run) => logitOf(run, "spot") - logitOf(run, "lucky"),
      floor: 0,
      scale: 0.5,
      kind: "check",
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
 * candidate they refer is coached: output claims dated after the referral are
 * exaggerated by 0.06, and a flag is proposed on each with probability
 * S4_FLAG_RATE two months after it appears; it takes effect only once a
 * second conflict-free member approves it a month later (§3.12). Their
 * friends withhold their two best pre-intake outputs until 8 months after
 * intake. The council leans on credentials (1.2) over substance (0.3).
 */
const s4Config = (): WorldConfig => ({
  ...BASE,
  name: "S4",
  coachBoost: 0.06,
  flagRate: S4_FLAG_RATE,
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
  council: CREDENTIAL_COUNCIL,
});

/** S4.d's counterfactual: every judge answers "Not yet" on every referral. */
const everyoneNotYet = (c: WorldConfig): WorldConfig => ({
  ...c,
  judges: c.judges.map((j) => ({ ...j, honesty: 0 })),
});

const S4: Scenario = {
  id: "S4",
  name: "Adversarial",
  config: s4Config,
  counterfactual: everyoneNotYet,
  sweep: true,
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
      kind: "check",
    },
    {
      id: "S4.b",
      claim: "Withheld evidence never creates movement",
      threshold: "worst over settled withheld referrals of −(d − d_on_time) ≥ −1e-9",
      aggregate: "worst",
      measure: (run) => {
        const created = run.referrals
          .flatMap((r) => r.settlements)
          .filter((s) => s !== null && s.dOnTime !== null)
          .map((s) => (s?.d ?? 0) - (s?.dOnTime ?? 0));
        return created.length === 0 ? Number.NaN : -Math.max(...created);
      },
      floor: -1e-9,
      scale: 0.05,
      kind: "binary",
    },
    {
      id: "S4.c",
      claim: "Denied-but-rose judges still gain at settlement",
      threshold: "worst over denied, latest d > 0 referrals of κ_m(end)·ℓᴹ − applied ℓᴬ > 0",
      aggregate: "worst",
      measure: (run) => {
        const gains = run.referrals
          .filter((r) => r.admission?.decision === "deny" && (latestSettlement(r)?.d ?? 0) > 0)
          .map((r) => {
            const removed = r.factors?.preCredential ? 0 : (r.admission?.ell ?? 0);
            return run.kappaM * (latestSettlement(r)?.ell ?? 0) - removed;
          });
        return gains.length === 0 ? Number.NaN : Math.min(...gains);
      },
      floor: 1e-9,
      scale: 0.1,
      kind: "check",
    },
    {
      id: "S4.d",
      claim: 'Everyone answering "Not yet" gains nothing over honest answers',
      threshold: 'mean over judges of logit(honest) − logit(all "Not yet") ≥ 0',
      aggregate: "mean",
      measure: (run, world, _p, cf) =>
        cf === null
          ? Number.NaN
          : world.judges.reduce((s, j) => s + logitOf(run, j.id) - logitOf(cf, j.id), 0) /
            world.judges.length,
      floor: 0,
      scale: 0.25,
      kind: "check",
    },
    {
      id: "S4.d+",
      claim: 'Largest single-judge gain from everyone answering "Not yet" (reported)',
      threshold: 'max over judges of logit(all "Not yet") − logit(honest)',
      aggregate: "mean",
      measure: (run, world, _p, cf) =>
        cf === null
          ? Number.NaN
          : Math.max(...world.judges.map((j) => logitOf(cf, j.id) - logitOf(run, j.id))),
      floor: 0,
      scale: 1,
      kind: "report",
    },
  ],
};

// --- S4.e ------------------------------------------------------------------------

/**
 * S4.e a malicious committee member. S4's world with two extra committee
 * members, `mal` and `acc`. `mal` proposes a flag lowering by 0.15 the best
 * claim each honest spotter's candidate made in the year after the referral.
 * Three variants: alone (no second approval), with `acc` approving and an
 * honest pair reversing each flag 90 days later, and with `acc` approving and
 * nothing reversed. Each is compared with the same world without `mal`.
 */
const s4Malice = (
  name: string,
  accomplice: string | null,
  reverseAfter: number | null,
): (() => WorldConfig) => {
  return () => ({
    ...s4Config(),
    name,
    extraCommittee: ["acc", "mal"],
    malice: { member: "mal", accomplice, targets: S4_SPOTTERS, amount: 0.15, reverseAfter },
  });
};
const withoutMalice = (c: WorldConfig): WorldConfig => ({ ...c, malice: null });

const S4E_SOLO: Scenario = {
  id: "S4e1",
  name: "Malicious flagger alone",
  config: s4Malice("S4e1", null, null),
  counterfactual: withoutMalice,
  params: { flags: true },
  sweep: false,
  criteria: [
    {
      id: "S4.e1",
      claim: "A single malicious flagger has no effect without a second approval",
      threshold: "worst max |Δw| against the world without them = 0",
      aggregate: "worst",
      measure: (run, _w, _p, cf) => (cf === null ? Number.NaN : -maxWeightGap(run, cf)),
      floor: 0,
      scale: 0.05,
      kind: "binary",
    },
  ],
};

const S4E_REVERSED: Scenario = {
  id: "S4e2",
  name: "Malicious pair, reversed",
  config: s4Malice("S4e2", "acc", 90),
  counterfactual: withoutMalice,
  params: { flags: true },
  sweep: false,
  criteria: [
    {
      id: "S4.e2",
      claim: "An approved-then-reversed flag leaves no trace in snapshots or movement results",
      threshold: "worst max |Δ| in any stored s0 or d = 0",
      aggregate: "worst",
      measure: (run, _w, _p, cf) => (cf === null ? Number.NaN : -maxStoredGap(run, cf)),
      floor: -1e-12,
      scale: 0.05,
      kind: "binary",
    },
    {
      id: "S4.e2w",
      claim: "…nor in any judge's weight",
      threshold: "worst max |Δw| against the world without them = 0",
      aggregate: "worst",
      measure: (run, _w, _p, cf) => (cf === null ? Number.NaN : -maxWeightGap(run, cf)),
      floor: -1e-12,
      scale: 0.05,
      kind: "binary",
    },
  ],
};

const S4E_PAIR: Scenario = {
  id: "S4e3",
  name: "Malicious pair, unreversed",
  config: s4Malice("S4e3", "acc", null),
  counterfactual: withoutMalice,
  params: { flags: true },
  sweep: false,
  criteria: [
    {
      id: "S4.e3",
      claim: "Effect of an unreversed malicious pair on the targeted spotters (reported)",
      threshold: "mean logit change of the three targeted spotters",
      aggregate: "mean",
      measure: (run, _w, _p, cf) =>
        cf === null
          ? Number.NaN
          : S4_SPOTTERS.reduce((s, id) => s + logitOf(run, id) - logitOf(cf, id), 0) /
            S4_SPOTTERS.length,
      floor: 0,
      scale: 1,
      kind: "report",
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
  sweep: true,
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
      kind: "binary",
    },
    {
      id: "S5.b",
      claim: "No single event exceeds its per-event bound",
      threshold: "worst over every event kind of (bound(kind) − max |Δ logit w|) ≥ 0",
      aggregate: "worst",
      measure: (run, _w, p) => boundSlack(run, p),
      floor: 0,
      scale: 0.5,
      kind: "binary",
    },
    {
      id: "S5.c",
      claim: "The loop doesn't run away: the highest weight stays near μ0",
      threshold: "worst (0.6 − max final w) ≥ 0",
      aggregate: "worst",
      measure: (run) => 0.6 - Math.max(...run.judges.map((j) => j.w)),
      floor: 0,
      scale: 0.1,
      kind: "check",
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
      kind: "check",
    },
    {
      id: "S5.e",
      claim: "Movement stays off below the gate",
      threshold: "worst movement share of any logit while K < M or spread < σ_min = 0",
      aggregate: "worst",
      measure: (run) => -run.gateLeak,
      floor: 0,
      scale: 0.1,
      kind: "binary",
    },
  ],
};

// --- S6 --------------------------------------------------------------------------

const S6_BACKERS = ["ood1", "ood2"];
const S6_CONSENSUS = ["cp1", "cp2"];

const S6_JUDGES: JudgeArchetype[] = [
  honest("ood1", 0.8, { role: "out-of-distribution backer", lagDays: 0, seesBreakouts: true }),
  honest("ood2", 0.7, {
    role: "out-of-distribution backer",
    lagDays: 0,
    seesBreakouts: true,
    admin: true,
  }),
  honest("h1", 0.6, { admin: true }),
  honest("h2", 0.5),
  { ...honest("cp1", 0.6), role: "consensus-picker", skill: 0.2, consensus: 0.9, admin: true },
  { ...honest("cp2", 0.6), role: "consensus-picker", skill: 0.2, consensus: 0.9 },
];

/**
 * S6 out of distribution. 150 candidates arrive over the first 12 months;
 * 15% are out of distribution: credentials 0.2 below their level that never
 * catch up, almost no submitted evidence (5% of months), and a heavy-tailed
 * breakout (0.08 + 0.06·Pareto(1.5), capped at 0.6) 18–36 months after
 * intake. After the breakout, 40% of their new evidence is found only by a
 * committee check; the rest is public and reaches the standard check. Two
 * judges have firsthand knowledge and see a breakout coming within three
 * years (0.8, 0.7); two honest judges (0.6, 0.5); two consensus-pickers
 * (0.2). Admins: h1, cp1, ood2. The council leans on credentials.
 */
const S6: Scenario = {
  id: "S6",
  name: "Out of distribution",
  config: () => ({
    ...BASE,
    name: "S6",
    arrivalDays: 12 * 30,
    ood: {
      share: 0.15,
      pSubmitted: 0.05,
      breakoutFrom: 540,
      breakoutTo: 1080,
      pDeep: 0.4,
      realised: true,
    },
    judges: S6_JUDGES,
    council: CREDENTIAL_COUNCIL,
  }),
  sweep: true,
  criteria: [
    {
      id: "S6.a",
      claim: "Judges who back out-of-distribution candidates end above consensus-pickers",
      threshold: "mean of min logit(backers) − max logit(consensus-pickers) ≥ 0",
      aggregate: "mean",
      measure: (run) =>
        Math.min(...S6_BACKERS.map((id) => logitOf(run, id))) -
        Math.max(...S6_CONSENSUS.map((id) => logitOf(run, id))),
      floor: 0,
      scale: 0.5,
      kind: "check",
    },
    {
      id: "S6.b",
      claim: "Backers' lowest monthly weight relative to μ0 (informational in r10)",
      threshold: "worst monthly min w(backers) − μ0",
      aggregate: "worst",
      measure: (run, _w, p) =>
        Math.min(...S6_BACKERS.flatMap((id) => run.monthly.get(id) ?? [])) - p.mu0,
      floor: -0.02,
      scale: 0.05,
      kind: "report",
    },
  ],
};

/**
 * S6 late breakouts, tested separately. A historical cohort of 260 candidates
 * joined over the 40 months before the judges did, so 36-month fits exist; 40
 * more arrive in the club's first six months and are the only ones referred.
 * 30% are out of distribution, as in S6, but every breakout lands 25–36 months
 * after intake. The run lasts 44 months so their 36-month settlements land.
 * The counterfactual keeps the breakouts latent (the backers still foresee
 * them and refer the same people) but out of every claim.
 */
const S6L: Scenario = {
  id: "S6L",
  name: "Late breakouts",
  config: () => ({
    ...BASE,
    name: "S6L",
    days: 44 * 30,
    candidates: 300,
    arrivalStart: -1200,
    arrivalDays: 1380,
    ood: {
      share: 0.3,
      pSubmitted: 0.05,
      breakoutFrom: 750,
      breakoutTo: 1080,
      pDeep: 0.4,
      realised: true,
    },
    judges: S6_JUDGES,
    council: CREDENTIAL_COUNCIL,
  }),
  counterfactual: (c) => ({
    ...c,
    ood: c.ood ? { ...c.ood, realised: false } : null,
  }),
  sweep: true,
  criteria: [
    {
      id: "S6.d",
      claim: "Breakouts in months 25–36 improve their backers' weights on their own",
      threshold: "mean of min over backers of logit(with) − logit(without) > 0",
      aggregate: "mean",
      measure: (run, _w, _p, cf) =>
        cf === null
          ? Number.NaN
          : Math.min(...S6_BACKERS.map((id) => logitOf(run, id) - logitOf(cf, id))),
      floor: 1e-9,
      scale: 0.25,
      kind: "check",
    },
  ],
};

/** The r10 default report: S4.e and the watch are deferred. */
export const SCENARIOS: readonly Scenario[] = [S1, S2, S3, S4, S5, S6, S6L];

/** Deferred in r10, kept runnable with their switches on: committee flags (S4.e) and the watch. */
export const DEFERRED: readonly Scenario[] = [
  S4E_SOLO,
  S4E_REVERSED,
  S4E_PAIR,
  {
    ...S6,
    id: "S6w",
    name: "Out of distribution, watch on",
    params: { watch: true },
    sweep: false,
  },
];

// --- invite-only variants (r10) ---------------------------------------------------

/** The invite-only pool's share of the population: the top quarter on level plus a year of slope. */
export const PRESELECT_SHARE = 0.25;

/**
 * The same scenario drawn from a pre-selected pool: every candidate comes
 * from the top PRESELECT_SHARE of the population on level plus one year of
 * slope, and judges and council calibrate to that pool, so the system ranks
 * strong people against each other.
 */
export function preselected(s: Scenario): Scenario {
  return {
    ...s,
    id: `${s.id}p`,
    name: `${s.name}, pre-selected`,
    config: (p) => ({ ...s.config(p), preselect: PRESELECT_SHARE }),
  };
}

export interface SmallClub {
  candidates: number;
  judges: number;
}

/** Realistic small clubs: candidates arriving evenly over 36 months, honest judges of spread skill. */
export const SMALL_CLUBS: readonly SmallClub[] = [
  { candidates: 30, judges: 5 },
  { candidates: 60, judges: 10 },
  { candidates: 120, judges: 15 },
];

/**
 * A small club: `judges` honest judges with skill spread evenly from 0.95 to
 * 0.25 (every third one an admin, two admins deciding each case), a fair
 * council, and `candidates` people arriving evenly over the 36 months.
 */
export function smallClubConfig(club: SmallClub, preselect: number | null): WorldConfig {
  const skills = Array.from(
    { length: club.judges },
    (_, i) => 0.95 - (0.7 * i) / Math.max(1, club.judges - 1),
  );
  return {
    ...BASE,
    name: `club${club.candidates}x${club.judges}`,
    candidates: club.candidates,
    arrivalDays: 36 * 30,
    judges: skills.map((skill, i) => honest(`j${i + 1}`, skill, { admin: i % 3 === 1 })),
    council: FAIR_COUNCIL,
    preselect,
  };
}

export { skillOrder, skillOrderAt };

// --- the watch as a learning tool (§3.11) ------------------------------------------

export interface WatchMetrics {
  checks: number;
  found: number;
  /** Misses found per check, prioritised half ÷ random half; NaN when the random half found none. */
  lift: number;
  checksPerMiss: number;
  /** Share of each judge's ever-eligible candidates checked at least once, by final-weight half. */
  coverageTop: number;
  coverageBottom: number;
}

/** Pooled over replicates: lift and checks per miss need counts, not per-run ratios. */
export function watchMetrics(runs: readonly RunResult[]): WatchMetrics {
  let checksP = 0;
  let foundP = 0;
  let checksR = 0;
  let foundR = 0;
  const top: number[] = [];
  const bottom: number[] = [];
  for (const run of runs) {
    for (const c of run.watch.checks) {
      const rose = c.finding === "rose" ? 1 : 0;
      if (c.half === "priority") {
        checksP++;
        foundP += rose;
      } else {
        checksR++;
        foundR += rose;
      }
    }
    const checked = new Set(run.watch.checks.map((c) => c.candidate));
    const coverage = new Map<string, { eligible: number; checked: number }>();
    for (const [candidate, referrers] of run.watch.eligible) {
      for (const j of referrers) {
        const entry = coverage.get(j) ?? { eligible: 0, checked: 0 };
        entry.eligible++;
        if (checked.has(candidate)) entry.checked++;
        coverage.set(j, entry);
      }
    }
    const ranked = [...run.judges].sort((a, b) => b.logit - a.logit);
    ranked.forEach((j, i) => {
      const entry = coverage.get(j.id);
      if (!entry || entry.eligible === 0) return;
      (i < ranked.length / 2 ? top : bottom).push(entry.checked / entry.eligible);
    });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
  const found = foundP + foundR;
  return {
    checks: checksP + checksR,
    found,
    lift: foundR === 0 || checksP === 0 ? Number.NaN : foundP / checksP / (foundR / checksR),
    checksPerMiss: found === 0 ? Number.NaN : (checksP + checksR) / found,
    coverageTop: mean(top),
    coverageBottom: mean(bottom),
  };
}

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

function cachedWorld(config: WorldConfig, seed: number, cache: WorldCache): World {
  const key = `${JSON.stringify(config)}#${seed}`;
  let world = cache.get(key);
  if (!world) {
    world = generateWorld(config, seed);
    cache.set(key, world);
  }
  return world;
}

export function evaluateScenario(
  scenario: Scenario,
  p: Params,
  seeds: readonly number[],
  cache: WorldCache = new Map(),
): ScenarioResult {
  const params = { ...p, ...scenario.params };
  const runs = seeds.map((seed) => {
    const config = scenario.config(params);
    const world = cachedWorld(config, seed, cache);
    const cf = scenario.counterfactual
      ? simulate(cachedWorld(scenario.counterfactual(config), seed, cache), params)
      : null;
    return { world, run: simulate(world, params), cf };
  });
  const results = scenario.criteria.map((criterion) => {
    const values = runs
      .map(({ world, run, cf }) => criterion.measure(run, world, params, cf))
      .filter((v) => !Number.isNaN(v));
    const metric =
      values.length === 0
        ? Number.NaN
        : criterion.aggregate === "mean"
          ? values.reduce((s, v) => s + v, 0) / values.length
          : Math.min(...values);
    const pass =
      criterion.kind === "report" || (!Number.isNaN(metric) && metric >= criterion.floor);
    const margin = Number.isNaN(metric)
      ? Number.NEGATIVE_INFINITY
      : (metric - criterion.floor) / criterion.scale;
    return { criterion, metric, pass, margin };
  });
  return { scenario, results, runs: runs.map(({ world, run }) => ({ world, run })) };
}
