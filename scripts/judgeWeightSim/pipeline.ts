/**
 * The university club's real pipeline, semester by semester over 36 months.
 *
 * Each semester about 150 candidates arrive. Inbound (110–130) are mostly
 * sophomores to seniors with fuller evidence, drawn moderately pre-selected
 * (top half); a member refers each and is its advocate. The member looks at
 * two people and refers the one they rate higher, so a skilled member brings
 * better people. Outbound (20–40) are freshmen chosen by the recruiting
 * committee, whose members are never judges: broad ability, thin evidence,
 * near-zero credentials, and some heavy-tailed late risers.
 *
 * Every candidate gets a first call; a "maybe" gets a second. Yes goes on and
 * takes the next open position (on outbound the first yes is the advocate);
 * maybe takes nothing; a hard no ends the candidacy. Variant A scores a hard
 * no as a counter-bet at stake 0.5 with the sign flipped; variant B only
 * records it. Callers move their freshman no-threshold each semester toward
 * whichever of yes and no has paid them better so far, so a free no (B) can
 * pull them toward no. The council admits 12 per semester; the admitted
 * become judges from the next semester, starting at μ0.
 *
 * The engine is causal and deterministic, so each semester's referrals,
 * calls and hard no's are built from the simulated results of the semesters
 * before, and the whole history is re-simulated: earlier semesters replay
 * identically.
 */

import { mulberry32 } from "../../src/seed/prng.ts";
import type { Params } from "./model.ts";
import { spearman } from "./scenarios.ts";
import { latestSettlement, type RunResult, simulate } from "./sim.ts";
import {
  type CandidateSpec,
  drawCandidate,
  type JudgeSpec,
  normalCdf,
  perceiveZ,
  type ReferralIntent,
  type World,
  type WorldConfig,
} from "./world.ts";

export const SEMESTER = 180;
export const SEMESTERS = 6;
const QUOTA = 12;
const COUNCIL_DAY = 150;

export interface Member {
  id: string;
  role: string;
  /** Designed skill at spotting slope; the order the weights should recover. */
  skill: number;
  levelNoise: number;
  slopeNoise: number;
  /** Ranks on visible credentials instead of substance and slope. */
  consensus?: boolean;
  /** Sees a freshman's breakout coming. */
  seesBreakouts?: boolean;
  /** Says yes on every call. */
  yesSayer?: boolean;
  /** Refers friends regardless of quality; the partner always takes the first call and says yes. */
  colludesWith?: string;
  partnerOf?: string;
  admin?: boolean;
  /** Takes outbound (freshman) calls. */
  freshmanTeam?: boolean;
}

export interface PipelineConfig {
  name: string;
  seed: number;
  inboundMode: "spread" | "concentrated";
  hardNo: "scored" | "recorded";
  /** How many people an advocate chooses among before referring one: their discretion. */
  options: number;
}

const honest = (id: string, skill: number, extra: Partial<Member> = {}): Member => ({
  id,
  role: "honest",
  skill,
  levelNoise: 0.02 + 0.2 * (1 - skill),
  slopeNoise: 0.02 + 0.2 * (1 - skill),
  ...extra,
});

/** The founding members: honest judges of spread skill plus the S2–S6 archetypes. */
export const FOUNDERS: readonly Member[] = [
  ...[0.95, 0.9, 0.85, 0.8, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25].map((skill, i) =>
    honest(`m${i + 1}`, skill, {
      admin: i === 1 || i === 4 || i === 8,
      freshmanTeam: i === 2 || i === 7,
    }),
  ),
  honest("twin", 0.75),
  {
    ...honest("cp", 0.75),
    role: "consensus-picker",
    skill: 0.2,
    consensus: true,
    freshmanTeam: true,
  },
  { ...honest("yes", 0.5), role: "yes-sayer", skill: 0.1, yesSayer: true, freshmanTeam: true },
  { ...honest("col1", 0.1), role: "colluder (leader)", colludesWith: "col2" },
  { ...honest("col2", 0.1), role: "colluder (partner)", partnerOf: "col1" },
  {
    ...honest("spot1", 0.85),
    role: "freshman spotter",
    seesBreakouts: true,
    freshmanTeam: true,
  },
  {
    ...honest("spot2", 0.75),
    role: "freshman spotter",
    seesBreakouts: true,
    freshmanTeam: true,
  },
];

export const HONEST_FOUNDERS = FOUNDERS.filter((m) => m.role === "honest").map((m) => m.id);

/** A deterministic stream per key, so nothing depends on the order things are drawn in. */
function streamFor(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return mulberry32(h);
}
function gaussianFor(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const BASE_CHANNEL: Omit<WorldConfig, "name" | "preselect" | "pEvidence" | "ood"> = {
  days: SEMESTERS * SEMESTER,
  candidates: 0,
  arrivalDays: 0,
  arrivalStart: 0,
  slowShare: 0,
  judges: [],
  council: { kind: "scripted", admitRate: 0 },
  councilNoise: 0,
  decidersPerDecision: 2,
  coachBoost: 0,
  flagRate: 0,
  malice: null,
  extraCommittee: [],
  relations: [],
  withholdUntil: null,
};

/** Inbound: moderately pre-selected (top half), fuller evidence. */
const INBOUND: WorldConfig = {
  ...BASE_CHANNEL,
  name: "inbound",
  preselect: 0.5,
  pEvidence: 0.6,
  ood: null,
};
/** Outbound: broad, thin submitted evidence, 20% heavy-tailed late risers (18–36 months). */
const OUTBOUND: WorldConfig = {
  ...BASE_CHANNEL,
  name: "outbound",
  preselect: null,
  pEvidence: 0.6,
  ood: {
    share: 0.2,
    pSubmitted: 0.15,
    breakoutFrom: 540,
    breakoutTo: 1080,
    pDeep: 0,
    realised: true,
  },
};

/** The pool each channel's judges and callers calibrate to. */
const POOLS = {
  inbound: { meanA: 0.6, sdA: 0.09, meanG: 0.05, sdG: 0.07 },
  outbound: { meanA: 0.5, sdA: 0.12, meanG: 0.02, sdG: 0.08 },
};

/** A good freshman, for counting losses at the call stage: a breakout, or slope half a sd above the mean. */
export const goodFreshman = (c: CandidateSpec): boolean => c.breakout !== null || c.g >= 0.06;

interface CallerState {
  /** z below which a freshman gets a hard no; moves with the incentive. */
  freshNo: number;
}

const YES_CUT = 0.8;
const INITIAL_FRESH_NO = -0.5;
const INBOUND_NO = -0.8;
const STEP = 0.25;

export interface CallRecord {
  semester: number;
  candidate: string;
  caller: string;
  channel: "inbound" | "outbound";
  outcome: "yes" | "maybe" | "no";
}

export interface PipelineResult {
  world: World;
  run: RunResult;
  members: Member[];
  calls: CallRecord[];
  /** Each semester's mean freshman no-threshold across callers. */
  freshNoBySemester: number[];
}

/** What a consensus-picker sees: the best credential on record by `day`. */
function credentials(c: CandidateSpec, day: number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const i of c.items)
    if (i.kind === "selection" && i.datedAt <= day) best = Math.max(best, i.value);
  return best;
}

export function runPipeline(config: PipelineConfig, p: Params): PipelineResult {
  const key = (k: string) => streamFor(`${config.seed}:${k}`);
  const members: Member[] = [...FOUNDERS];
  const byId = new Map(members.map((m) => [m.id, m]));
  const candidates: CandidateSpec[] = [];
  const intents: ReferralIntent[] = [];
  const rounds: { day: number; quota: number; candidates: string[] }[] = [];
  const noise = new Map<string, number>();
  const deciders = new Map<string, string[]>();
  const calls: CallRecord[] = [];
  const callers = new Map<string, CallerState>();
  const freshNoBySemester: number[] = [];
  let run: RunResult | null = null;
  let world: World | null = null;

  const stateOf = (id: string): CallerState => {
    let s = callers.get(id);
    if (!s) {
      s = { freshNo: INITIAL_FRESH_NO };
      callers.set(id, s);
    }
    return s;
  };

  for (let sem = 0; sem < SEMESTERS; sem++) {
    const start = sem * SEMESTER;
    // Members admitted by now join as judges at μ0.
    const admitted = run
      ? [...run.decided]
          .filter(([, d]) => d === "admit")
          .map(([id]) => id)
          .sort()
      : [];
    for (const id of admitted) {
      if (byId.has(id)) continue;
      const rng = key(`${id}:skill`);
      const skill = 0.2 + 0.75 * rng();
      const m = honest(id, skill, { role: "member" });
      members.push(m);
      byId.set(id, m);
    }
    const active = [...members];

    // Callers adapt their freshman no-threshold to what yes and no have paid them so far.
    if (run) adaptCallers(run, candidates, intents, callers, config.hardNo);
    freshNoBySemester.push(
      callers.size === 0
        ? INITIAL_FRESH_NO
        : [...callers.values()].reduce((s, c) => s + c.freshNo, 0) / callers.size,
    );

    const rngCounts = key(`sem${sem}:counts`);
    const nIn = 110 + Math.floor(rngCounts() * 21);
    const nOut = 20 + Math.floor(rngCounts() * 21);
    const roundCandidates: string[] = [];
    const activity = new Map(active.map((m) => [m.id, key(`${m.id}:activity`)()]));
    const ranked = [...active].sort(
      (a, b) => (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0),
    );
    const topCount = Math.max(1, Math.round(0.2 * ranked.length));

    const pickAdvocate = (rng: () => number): Member => {
      if (config.inboundMode === "concentrated" && rng() < 0.6) {
        return ranked[Math.floor(rng() * topCount)] as Member;
      }
      const pool = config.inboundMode === "concentrated" ? ranked.slice(topCount) : ranked;
      return (pool.length ? pool : ranked)[
        Math.floor(rng() * (pool.length || ranked.length))
      ] as Member;
    };

    const callOutcome = (
      m: Member,
      c: CandidateSpec,
      channel: "inbound" | "outbound",
      tag: string,
    ): CallRecord["outcome"] => {
      if (m.yesSayer) return "yes";
      const rng = key(`${tag}:${m.id}:${c.id}`);
      const foresight =
        m.seesBreakouts && c.breakout && c.breakout.day <= c.intakeDay + 3 * 365
          ? c.breakout.jump
          : 0;
      const z = perceiveZ(
        c,
        m.levelNoise,
        m.slopeNoise,
        POOLS[channel],
        () => gaussianFor(rng),
        foresight,
      );
      const no = channel === "outbound" ? stateOf(m.id).freshNo : INBOUND_NO;
      if (z >= Math.max(YES_CUT, no)) return "yes";
      if (z < no) return "no";
      return "maybe";
    };

    const interview = (
      c: CandidateSpec,
      channel: "inbound" | "outbound",
      exclude: string[],
      first: Member | null,
    ) => {
      const pool = (channel === "outbound" ? active.filter((m) => m.freshmanTeam) : active).filter(
        (m) => !exclude.includes(m.id),
      );
      const rng = key(`calls:${c.id}`);
      const pick = () => pool[Math.floor(rng() * pool.length)] as Member;
      const one = first ?? pick();
      let outcome = callOutcome(one, c, channel, "call1");
      const record = (m: Member, o: CallRecord["outcome"], day: number) => {
        calls.push({ semester: sem, candidate: c.id, caller: m.id, channel, outcome: o });
        if (o === "yes") {
          intents.push(intent(m.id, c, day, channel));
        } else if (o === "no" && config.hardNo === "scored") {
          intents.push({ ...intent(m.id, c, day, channel), id: `${m.id}!${c.id}`, stance: "no" });
        }
      };
      record(one, outcome, c.intakeDay + 20);
      if (outcome === "maybe") {
        let two = pick();
        for (let i = 0; i < 5 && two.id === one.id; i++) two = pick();
        if (two.id !== one.id) {
          outcome = callOutcome(two, c, channel, "call2");
          record(two, outcome, c.intakeDay + 40);
        }
      }
      return outcome !== "no";
    };

    const intent = (
      judge: string,
      c: CandidateSpec,
      day: number,
      channel: "inbound" | "outbound",
    ): ReferralIntent => {
      const m = byId.get(judge) as Member;
      const rng = key(`strength:${judge}:${c.id}`);
      const z = perceiveZ(c, m.levelNoise, m.slopeNoise, POOLS[channel], () => gaussianFor(rng));
      return {
        id: `${judge}>${c.id}`,
        judge,
        candidate: c.id,
        day,
        strength: m.yesSayer || m.partnerOf ? 1 : Math.min(1, Math.max(0.05, normalCdf(z))),
        answer: "not_sure",
      };
    };

    for (let j = 0; j < nIn; j++) {
      const rng = key(`sem${sem}:in${j}`);
      const advocate = pickAdvocate(rng);
      const intake = start + Math.floor(rng() * 60);
      const year = 2 + Math.floor(rng() * 3);
      const options = Array.from({ length: config.options }, (_, k) => k).map((k) =>
        drawCandidate(
          key(`sem${sem}:in${j}:opt${k}`),
          INBOUND,
          `s${sem}i${j}`,
          intake,
          year,
          "inbound",
        ),
      );
      // The advocate refers the better of two people they know; a colluder refers a friend.
      const seen = options.map((c, k) => {
        if (advocate.consensus) return credentials(c, intake);
        const r = key(`see:${advocate.id}:${sem}:${j}:${k}`);
        return perceiveZ(c, advocate.levelNoise, advocate.slopeNoise, POOLS.inbound, () =>
          gaussianFor(r),
        );
      });
      let best = 0;
      for (let k = 1; k < seen.length; k++)
        if ((seen[k] as number) > (seen[best] as number)) best = k;
      const chosen = advocate.colludesWith
        ? (options[Math.floor(rng() * options.length)] as CandidateSpec)
        : (options[best] as CandidateSpec);
      candidates.push(chosen);
      intents.push(intent(advocate.id, chosen, intake, "inbound"));
      noise.set(chosen.id, 0.4 * gaussianFor(key(`noise:${chosen.id}`)));
      const partner = advocate.colludesWith ? (byId.get(advocate.colludesWith) ?? null) : null;
      if (interview(chosen, "inbound", [advocate.id], partner)) roundCandidates.push(chosen.id);
    }
    for (let j = 0; j < nOut; j++) {
      const rng = key(`sem${sem}:out${j}`);
      const intake = start + Math.floor(rng() * 60);
      const c = drawCandidate(
        key(`sem${sem}:out${j}:c`),
        OUTBOUND,
        `s${sem}o${j}`,
        intake,
        1,
        "outbound",
      );
      candidates.push(c);
      noise.set(c.id, 0.4 * gaussianFor(key(`noise:${c.id}`)));
      if (interview(c, "outbound", [], null)) roundCandidates.push(c.id);
    }
    const admins = active.filter((m) => m.admin).map((m) => m.id);
    for (const id of roundCandidates) {
      const rng = key(`deciders:${id}`);
      const pool = [...admins];
      const chosen: string[] = [];
      while (chosen.length < Math.min(2, admins.length)) {
        chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] as string);
      }
      deciders.set(id, chosen.sort());
    }
    rounds.push({ day: start + COUNCIL_DAY, quota: QUOTA, candidates: roundCandidates });

    world = {
      name: config.name,
      days: (sem + 1) * SEMESTER,
      judges: members.map(
        (m): JudgeSpec => ({ id: m.id, role: m.role, skill: m.skill, admin: m.admin ?? false }),
      ),
      candidates: [...candidates],
      intents: [...intents].sort((x, y) => x.day - y.day || (x.id < y.id ? -1 : 1)),
      council: {
        kind: "quota",
        signal: 0.3,
        substance: 1,
        credentials: 0.3,
        noise,
        rounds: rounds.map((r) => ({ ...r, candidates: [...r.candidates] })),
      },
      decisionLag: 30,
      deciders,
      reversals: [],
      committee: new Map(),
      relations: [],
      flags: [],
      population: { meanA: 0.5, sdA: 0.12, meanG: 0.02 },
    };
    run = simulate(world, p);
  }
  return {
    world: world as World,
    run: run as RunResult,
    members,
    calls,
    freshNoBySemester,
  };
}

/**
 * Each caller compares what their freshman yes's and no's have paid so far
 * (admission credit plus the latest movement result, per call) and moves
 * their no-threshold a step toward the better one. Under variant B a no
 * always pays exactly 0.
 */
function adaptCallers(
  run: RunResult,
  candidates: CandidateSpec[],
  _intents: ReferralIntent[],
  callers: Map<string, CallerState>,
  hardNo: PipelineConfig["hardNo"],
): void {
  const freshman = new Set(candidates.filter((c) => c.channel === "outbound").map((c) => c.id));
  const paid = new Map<string, { yes: number[]; no: number[] }>();
  for (const r of run.referrals) {
    if (!freshman.has(r.intent.candidate)) continue;
    const s = latestSettlement(r);
    const admission = r.admission && r.admission.state !== "none" ? r.admission.ell : 0;
    const value = (r.intent.stance === "no" ? 0 : admission) + (s?.ell ?? 0);
    if (r.intent.stance !== "no" && !r.admission) continue;
    const entry = paid.get(r.intent.judge) ?? { yes: [], no: [] };
    (r.intent.stance === "no" ? entry.no : entry.yes).push(value);
    paid.set(r.intent.judge, entry);
  }
  for (const [id, entry] of paid) {
    const state = callers.get(id);
    if (!state || entry.yes.length < 2) continue;
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const yes = mean(entry.yes);
    const no = hardNo === "recorded" || entry.no.length === 0 ? 0 : mean(entry.no);
    if (yes < no - 0.01) state.freshNo = Math.min(1, state.freshNo + STEP);
    else if (yes > no + 0.01) state.freshNo = Math.max(-1.5, state.freshNo - STEP);
  }
}

// --- the pipeline's adaptation of S1–S6 ------------------------------------------------

const logitOf = (run: RunResult, id: string): number =>
  run.judges.find((j) => j.id === id)?.logit ?? Number.NaN;

const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
};

/** Spearman of the honest founders' skill against their weight at a month (36 = final). */
export function founderOrder(run: RunResult, month: number): number {
  const founders = FOUNDERS.filter((f) => HONEST_FOUNDERS.includes(f.id));
  return spearman(
    founders.map((f) => f.skill),
    founders.map((f) => run.monthly.get(f.id)?.[month - 1] ?? Number.NaN),
  );
}

export interface PipelineCriterion {
  id: string;
  claim: string;
  threshold: string;
  aggregate: "mean" | "worst";
  measure: (r: PipelineResult, p: Params) => number;
  floor: number;
  scale: number;
  kind: "check" | "binary" | "report";
}

export const PIPELINE_CRITERIA: readonly PipelineCriterion[] = [
  {
    id: "P1.a",
    claim: "Honest founders' skill order recovered by month 36",
    threshold: "mean Spearman ≥ 0.7",
    aggregate: "mean",
    measure: (r) => founderOrder(r.run, 36),
    floor: 0.7,
    scale: 0.3,
    kind: "check",
  },
  {
    id: "P1.b",
    claim: "…and visible by month 12",
    threshold: "mean Spearman ≥ 0.5",
    aggregate: "mean",
    measure: (r) => founderOrder(r.run, 12),
    floor: 0.5,
    scale: 0.5,
    kind: "check",
  },
  {
    id: "P2",
    claim: "The consensus-picker ends below its equal-accuracy twin",
    threshold: "mean logit(twin) − logit(cp) ≥ 0",
    aggregate: "mean",
    measure: (r) => logitOf(r.run, "twin") - logitOf(r.run, "cp"),
    floor: 0,
    scale: 0.5,
    kind: "check",
  },
  {
    id: "P3",
    claim: "The yes-sayer ends at or below μ0 and below the median honest founder",
    threshold: "mean of min(logit μ0, median honest) − logit(yes) ≥ 0",
    aggregate: "mean",
    measure: (r, p) =>
      Math.min(
        Math.log(p.mu0 / (1 - p.mu0)),
        median(HONEST_FOUNDERS.map((id) => logitOf(r.run, id))),
      ) - logitOf(r.run, "yes"),
    floor: 0,
    scale: 0.5,
    kind: "check",
  },
  {
    id: "P4",
    claim: "The colluding pair ends below the median honest founder",
    threshold: "mean median honest − max(col1, col2) ≥ 0",
    aggregate: "mean",
    measure: (r) =>
      median(HONEST_FOUNDERS.map((id) => logitOf(r.run, id))) -
      Math.max(logitOf(r.run, "col1"), logitOf(r.run, "col2")),
    floor: 0,
    scale: 0.5,
    kind: "check",
  },
  {
    id: "P5.a",
    claim: "Weights stay strictly inside (0, 1)",
    threshold: "worst min(w, 1 − w) > 0",
    aggregate: "worst",
    measure: (r) => Math.min(r.run.bounds.minW, 1 - r.run.bounds.maxW),
    floor: 1e-12,
    scale: 0.3,
    kind: "binary",
  },
  {
    id: "P5.b",
    claim: "Movement stays off below the gate",
    threshold: "worst movement share while the gate is shut = 0",
    aggregate: "worst",
    measure: (r) => -r.run.gateLeak,
    floor: 0,
    scale: 0.1,
    kind: "binary",
  },
  {
    id: "P6.a",
    claim: "Freshman spotters end above the consensus-picker",
    threshold: "mean min logit(spot1, spot2) − logit(cp) ≥ 0",
    aggregate: "mean",
    measure: (r) =>
      Math.min(logitOf(r.run, "spot1"), logitOf(r.run, "spot2")) - logitOf(r.run, "cp"),
    floor: 0,
    scale: 0.5,
    kind: "check",
  },
  {
    id: "P6.b",
    claim: "Freshman spotters' lowest monthly weight relative to μ0 (informational)",
    threshold: "worst monthly min w(spotters) − μ0",
    aggregate: "worst",
    measure: (r, p) =>
      Math.min(...["spot1", "spot2"].flatMap((id) => r.run.monthly.get(id) ?? [])) - p.mu0,
    floor: 0,
    scale: 0.05,
    kind: "report",
  },
];

export interface PipelineCriterionResult {
  criterion: PipelineCriterion;
  metric: number;
  pass: boolean;
  margin: number;
}

export function evaluatePipeline(
  config: Omit<PipelineConfig, "seed">,
  p: Params,
  seeds: readonly number[],
): { results: PipelineCriterionResult[]; runs: PipelineResult[] } {
  const runs = seeds.map((seed) => runPipeline({ ...config, seed }, p));
  const results = PIPELINE_CRITERIA.map((criterion) => {
    const values = runs.map((r) => criterion.measure(r, p)).filter((v) => !Number.isNaN(v));
    const metric =
      values.length === 0
        ? Number.NaN
        : criterion.aggregate === "mean"
          ? values.reduce((s, v) => s + v, 0) / values.length
          : Math.min(...values);
    const pass =
      criterion.kind === "report" || (!Number.isNaN(metric) && metric >= criterion.floor);
    return { criterion, metric, pass, margin: (metric - criterion.floor) / criterion.scale };
  });
  return { results, runs };
}
