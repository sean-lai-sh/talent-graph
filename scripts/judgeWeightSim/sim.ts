/**
 * Runs one world through the r9 pipeline, one dated event at a time:
 * referrals, council decisions, quarterly fit releases, snapshots and their
 * corrections, admission credit and escrow, V2 accuracy, settlement at 12
 * months (and 24 and 36 for pre-credential referrals), committee flags with
 * two-person approval and reversal, and the quarterly anti-cohort watch.
 * Every weight change happens inside exactly one event, so the per-event
 * bound is measured per event kind, not assumed.
 */

import { mulberry32 } from "../../src/seed/prng.ts";
import {
  type ActiveFlag,
  admissionCredit,
  type BoundedEvent,
  checkpointWindow,
  credentialStake,
  creditCurve,
  type Decision,
  EMPTY_TERMS,
  evalLine,
  type FitPoint,
  fitLine,
  fitNorm,
  isPreCredential,
  type JudgeTerms,
  judgeLabel,
  type Line,
  logitWeight,
  type MovementNorm,
  movementBeyondNormal,
  movementCredit,
  movementScale,
  movementZ,
  type Params,
  rankPositions,
  recognitionStake,
  referralWeight,
  reliance,
  type Snapshot,
  s0Window,
  scoreAccuracy,
  settlementStake,
  stdev,
  takeSnapshot,
  weights,
} from "./model.ts";
import {
  type CandidateSpec,
  type FlagIntent,
  MONTH,
  type ReferralIntent,
  trueLevel,
  type World,
} from "./world.ts";

type EventKind =
  | "refer"
  | "decide"
  | "round"
  | "reverse"
  | "release"
  | "watch"
  | "intake_s12"
  | "factors"
  | "correct"
  | "accuracy"
  | "settle"
  | "resettle"
  | "propose"
  | "approve"
  | "unflag";

/** Same-day events run in this order; every kind is listed once. */
const ORDER: readonly EventKind[] = [
  "refer",
  "decide",
  "round",
  "reverse",
  "propose",
  "approve",
  "unflag",
  "release",
  "watch",
  "intake_s12",
  "factors",
  "correct",
  "accuracy",
  "settle",
  "resettle",
];

/** Which §6 per-event bound each weight-moving event kind answers to; the watch must move nothing. */
export const BOUND_OF: Partial<Record<EventKind, BoundedEvent | "none">> = {
  factors: "admission",
  correct: "correct",
  accuracy: "accuracy",
  settle: "settle",
  resettle: "resettle",
  intake_s12: "ramp",
  approve: "flag",
  unflag: "flag",
  propose: "none",
  watch: "none",
};

interface SimEvent {
  kind: EventKind;
  day: number;
  key: string;
  /** Checkpoint index for settlements; the decision for reversals. */
  horizon?: number;
  decision?: Decision;
}

interface DecisionRecord {
  day: number;
  decision: Decision;
  decidedBy: readonly string[];
  /** S_v and each referrer's part of it, as the council saw them. */
  signal: number;
  parts: ReadonlyMap<string, number>;
}

/** A frozen fit release (§3.6): its points, so a settling candidate can be left out entirely. */
export interface FitVersion {
  version: number;
  releasedAt: number;
  f: FitPoint[];
  /** Movement points per checkpoint: x = s0, y = s_k − s0. */
  e: FitPoint[][];
  /** Starting scores the fits saw: the reference for V2's level truth. */
  starts: number[];
  cache: Map<string, MovementNorm | Line>;
}

export interface Factors {
  s0: Snapshot | null;
  /** The correction time s0 was last read as of. */
  s0AsOf: number;
  fVersion: number;
  gap: number;
  position: number;
  q: number;
  preCredential: boolean;
  recused: boolean;
}

export type AdmissionState = "none" | "applied" | "escrowed" | "settled";

export interface AdmissionResult {
  decision: Decision | null;
  rho: number;
  /** ℓᴬ as computed; whether it counts depends on `state`. */
  ell: number;
  state: AdmissionState;
}

export interface SettlementResult {
  storedAt: number;
  correctedAsOf: number;
  /** z − c: movement beyond normal in spread units, minus the neutral centre; d = g(z − c). */
  z: number;
  d: number;
  /** d had withheld evidence been submitted on time, under the same frozen version. */
  dOnTime: number | null;
  stake: number;
  ell: number;
  version: number;
}

export interface ReferralRecord {
  intent: ReferralIntent;
  afterDecision: boolean;
  factors: Factors | null;
  admission: AdmissionResult | null;
  /** One slot per checkpoint (12, 24, 36 months); the latest filled one is the movement term. */
  settlements: (SettlementResult | null)[];
  corrections: number;
}

export type Finding = "rose" | "flat" | "fell";

export interface CheckRecord {
  day: number;
  candidate: string;
  checker: string;
  half: "priority" | "random";
  prediction: Finding;
  finding: Finding;
}

export interface FlagRecord {
  intent: FlagIntent;
  proposer: string | null;
  approver: string | null;
  approvedAt: number | null;
  reversedAt: number | null;
}

export interface RunResult {
  judges: {
    id: string;
    logit: number;
    w: number;
    label: "provisional" | "calibrated";
    referrals: number;
  }[];
  /** w per judge at the end of every month. */
  monthly: Map<string, number[]>;
  referrals: ReferralRecord[];
  bounds: { minW: number; maxW: number; minOmega: number; maxOmega: number };
  /** Largest |Δ logit w| any single event of each kind caused to any judge. */
  maxEventDelta: Record<EventKind, number>;
  /** Largest share of any judge's logit that came from movement while the gate was closed. */
  gateLeak: number;
  gateOpenedDay: number | null;
  K: number;
  kappaM: number;
  versions: FitVersion[];
  flags: FlagRecord[];
  /**
   * Quota rounds: how many of the admitted would change if the council had
   * used the unweighted Referral Signal (every judge at μ0) instead.
   */
  councilDiffs: { day: number; quota: number; differ: number }[];
  /** Every candidate's latest standing decision. */
  decided: Map<string, Decision>;
  watch: {
    checks: CheckRecord[];
    /** Candidates a check found risen: the regret report. */
    regret: string[];
    /** Candidates that were ever eligible, with their referrers. */
    eligible: Map<string, string[]>;
    /** Who each candidate conflicts with: referrers, deciders, and members related to a referrer. */
    conflicts: Map<string, Set<string>>;
  };
}

const decisionOf = (history: DecisionRecord[] | undefined, day: number): DecisionRecord | null => {
  let standing: DecisionRecord | null = null;
  for (const d of history ?? []) if (d.day <= day) standing = d;
  return standing;
};

/** A deterministic stream per key, so no shared random state can change with event order. */
function streamFor(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return mulberry32(h);
}

function gaussianFor(key: string): number {
  const rng = streamFor(key);
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function simulate(world: World, p: Params): RunResult {
  const terms = new Map<string, JudgeTerms>(world.judges.map((j) => [j.id, { ...EMPTY_TERMS }]));
  const signals = new Map<string, number>(world.judges.map((j) => [j.id, 0]));
  const candidates = new Map<string, CandidateSpec>(world.candidates.map((c) => [c.id, c]));
  const referrals = new Map<string, ReferralRecord>();
  const byCandidate = new Map<string, ReferralRecord[]>();
  const decisions = new Map<string, DecisionRecord[]>();
  const pendingDecision = new Set<string>();
  const versions: FitVersion[] = [];
  /** Candidates counted in K, with the starting score each had when it entered. */
  const settledAtK: { id: string; day: number; s0: number }[] = [];
  let K = 0;
  let spread = 0;
  let gateOpenedDay: number | null = null;
  const book = new Map<string, ActiveFlag[]>();
  const flagRecords = new Map<string, FlagRecord>();
  const watchSince = new Map<string, number>();
  const watchDone = new Set<string>();
  const checks: CheckRecord[] = [];
  const regret: string[] = [];
  const eligibleEver = new Map<string, string[]>();
  const conflicts = new Map<string, Set<string>>();
  const committee = [...world.committee.keys()].sort();
  let rotation = 0;

  const queue = new Map<number, SimEvent[]>();
  const schedule = (e: SimEvent): void => {
    if (e.day >= world.days) return;
    const list = queue.get(e.day);
    if (list) list.push(e);
    else queue.set(e.day, [e]);
  };
  const H12 = p.horizons[0] as number;
  for (const c of world.candidates) {
    // A historical cohort's intake snapshots already exist on day 0.
    schedule({ kind: "intake_s12", day: Math.max(0, c.intakeDay + H12 + p.S), key: c.id });
  }
  for (const r of world.intents) schedule({ kind: "refer", day: r.day, key: r.id });
  if (world.council.kind === "quota") {
    world.council.rounds.forEach((round, i) => {
      schedule({ kind: "round", day: round.day, key: String(i) });
    });
  }
  for (const r of world.reversals) {
    schedule({ kind: "reverse", day: r.day, key: r.candidate, decision: r.decision });
  }
  if (p.flags) {
    for (const f of world.flags) schedule({ kind: "propose", day: f.proposedAt, key: f.id });
  }
  for (let day = p.quarter; day < world.days; day += p.quarter) {
    schedule({ kind: "release", day, key: "fits" });
    if (p.watch) schedule({ kind: "watch", day, key: "watch" });
  }
  const intentsById = new Map(world.intents.map((r) => [r.id, r]));
  const flagsById = new Map(world.flags.map((f) => [f.id, f]));

  const kappaM = (): number => movementScale(K, spread, p);
  const yearOf = (id: string): number => candidates.get(id)?.year ?? 3;
  const channelOf = (id: string) => candidates.get(id)?.channel ?? "inbound";
  /** Each channel's council record so far, for the centred admission credit. */
  const channelStats = new Map<string, { decided: number; admitted: number }>();
  const recordDecision = (candidate: string, decision: Decision) => {
    const stats = channelStats.get(channelOf(candidate)) ?? { decided: 0, admitted: 0 };
    stats.decided++;
    if (decision === "admit") stats.admitted++;
    channelStats.set(channelOf(candidate), stats);
  };
  /** The channel's admit rate, shrunk toward the club's 12-of-150 target with ten pseudo-decisions. */
  const baseRate = (candidate: string): number | null => {
    if (!p.centredAdmission) return null;
    const stats = channelStats.get(channelOf(candidate)) ?? { decided: 0, admitted: 0 };
    return (stats.admitted + 0.08 * 10) / (stats.decided + 10);
  };
  const councilDiffs: RunResult["councilDiffs"] = [];
  const termsOf = (judge: string): JudgeTerms => terms.get(judge) as JudgeTerms;
  const logitOf = (judge: string): number => logitWeight(termsOf(judge), kappaM(), p);
  const bump = (judge: string): void => {
    signals.set(judge, (signals.get(judge) ?? 0) + 1);
  };
  const latest = (day: number): FitVersion | null => {
    for (let i = versions.length - 1; i >= 0; i--) {
      if ((versions[i] as FitVersion).releasedAt < day) return versions[i] as FitVersion;
    }
    return null;
  };
  const versionById = (id: number): FitVersion | null => versions[id - 1] ?? null;
  const snapshot = (c: CandidateSpec, w: Parameters<typeof takeSnapshot>[1]) =>
    takeSnapshot(c.items, w, p, book);
  const visible = (c: CandidateSpec, day: number, scope: "standard" | "all" = "standard") =>
    snapshot(c, { evidenceCutoff: day, asOf: day, scope });
  const intakeS0 = (c: CandidateSpec, asOf: number) => snapshot(c, s0Window(c.intakeDay, p, asOf));

  /** §3.6: fits exclude the settling candidate entirely, including its intake pair. */
  function normFor(v: FitVersion | null, horizon: number, leaveOut: string): MovementNorm {
    if (!v) return fitNorm([], p);
    const key = `e${horizon}:${leaveOut}`;
    const hit = v.cache.get(key);
    if (hit) return hit as MovementNorm;
    const norm = fitNorm(
      (v.e[horizon] ?? []).filter((pt) => pt.id !== leaveOut),
      p,
    );
    v.cache.set(key, norm);
    return norm;
  }
  function fFor(v: FitVersion | null, leaveOut: string): Line {
    if (!v) return { a: 0, b: 0, c: 0 };
    const key = `f:${leaveOut}`;
    const hit = v.cache.get(key);
    if (hit) return hit as Line;
    const line = fitLine(
      v.f.filter((pt) => pt.id !== leaveOut),
      p.yearInFits,
    );
    v.cache.set(key, line);
    return line;
  }

  function buildVersion(version: number, day: number): FitVersion {
    const f: FitPoint[] = [];
    const e: FitPoint[][] = p.horizons.map(() => []);
    for (const c of world.candidates) {
      if (c.intakeDay + p.G + p.S > day) continue;
      const s0 = intakeS0(c, day);
      const year = c.year ?? 3;
      f.push({ id: c.id, x: s0.selection, y: s0.substance, year });
      p.horizons.forEach((horizon, k) => {
        if (c.intakeDay + horizon + p.S > day) return;
        const sk = snapshot(c, checkpointWindow(c.intakeDay, horizon, p, day));
        e[k]?.push({ id: c.id, x: s0.substance, y: sk.substance - s0.substance, year });
      });
    }
    return { version, releasedAt: day, f, e, starts: f.map((pt) => pt.y), cache: new Map() };
  }

  /** After a flag reversal, re-read every counted starting score without the erased flag. */
  function recomputeSpread(): void {
    for (const entry of settledAtK) {
      entry.s0 = intakeS0(candidates.get(entry.id) as CandidateSpec, entry.day).substance;
    }
    spread = stdev(settledAtK.map((entry) => entry.s0));
  }

  /** A referral's current terms: applied admission credit and its latest movement result. */
  const contribution = (r: ReferralRecord): { a: number; m: number } => {
    let m = 0;
    for (const s of r.settlements) if (s) m = s.ell;
    return { a: r.admission?.state === "applied" ? r.admission.ell : 0, m };
  };
  /** Mutate a referral and move its judge's sums by exactly the change in its terms. */
  const update = (r: ReferralRecord, change: () => void): void => {
    const before = contribution(r);
    change();
    const after = contribution(r);
    const t = termsOf(r.intent.judge);
    t.sumA += after.a - before.a;
    t.sumM += after.m - before.m;
  };

  function settle(
    r: ReferralRecord,
    k: number,
    version: FitVersion | null,
    storedAt: number,
    correctedAsOf: number,
  ): SettlementResult | null {
    const f = r.factors;
    const admission = r.admission;
    if (!f?.s0 || !admission) return null;
    const c = candidates.get(r.intent.candidate) as CandidateSpec;
    const t = r.intent.day;
    const horizon = p.horizons[k] as number;
    const norm = normFor(version, k, c.id);
    const sk = snapshot(c, checkpointWindow(t, horizon, p, correctedAsOf)).substance;
    const year = yearOf(c.id);
    const z = movementZ(f.s0.substance, sk, norm, year) - norm.centre;
    const d = creditCurve(z, p);
    let dOnTime: number | null = null;
    if (c.onTimeItems) {
      const s0 = takeSnapshot(c.onTimeItems, s0Window(t, p), p, book).substance;
      const skOnTime = takeSnapshot(c.onTimeItems, checkpointWindow(t, horizon, p), p, book);
      dOnTime = movementBeyondNormal(s0, skOnTime.substance, norm, p, year);
    }
    const admitted = admission.decision === "admit" && !f.recused;
    // A hard no is a counter-bet at stake 0.5: it pays when the candidate falls.
    const stake =
      r.intent.stance === "no" ? -0.5 : f.recused ? 1 : settlementStake(admitted, admission.rho, p);
    return {
      storedAt,
      correctedAsOf,
      z,
      d,
      dOnTime,
      stake,
      ell: movementCredit(f.q, stake, d, p),
      version: version?.version ?? 0,
    };
  }

  /** §3.2–§3.3 factors and admission credit, from s0 as of `asOf` and a fixed f version. */
  function fixFactors(r: ReferralRecord, asOf: number, fVersion: FitVersion | null): void {
    const { judge, candidate, day } = r.intent;
    const c = candidates.get(candidate) as CandidateSpec;
    const hasIntake = c.intakeDay <= day + p.G + p.S;
    const s0 = hasIntake ? snapshot(c, s0Window(day, p, asOf)) : null;
    const standingOf = (x: ReferralRecord) =>
      decisionOf(decisions.get(candidate), x.intent.day + p.D);
    const recusedOf = (x: ReferralRecord) =>
      standingOf(x)?.decidedBy.includes(x.intent.judge) ?? false;
    const standing = standingOf(r);
    const recused = recusedOf(r);
    // Recused referrals take no position from anyone else; a recused
    // referral's own stake uses the position it would hold among the rest.
    const positions = rankPositions(
      (byCandidate.get(candidate) ?? [])
        .filter((x) => x.intent.day <= day)
        .map((x) => ({
          id: x.intent.id,
          judge: x.intent.judge,
          day: x.intent.day,
          eligible: x === r || (!recusedOf(x) && x.intent.stance !== "no"),
        })),
    );
    const position = positions.get(r.intent.id) ?? 1;
    const gap = s0
      ? s0.substance - evalLine(fFor(fVersion, candidate), s0.selection, yearOf(candidate))
      : 0;
    // A hard no takes no position: its stake is the gap and answer factors alone.
    const q =
      r.intent.stance === "no"
        ? referralWeight(1, gap, r.intent.answer, p)
        : referralWeight(position, gap, r.intent.answer, p);
    const preCredential = isPreCredential(gap, p);
    r.factors = {
      s0,
      s0AsOf: asOf,
      fVersion: fVersion?.version ?? 0,
      gap,
      position,
      q,
      preCredential,
      recused,
    };

    const scored =
      standing !== null && !recused && !r.afterDecision && s0 !== null && r.intent.stance !== "no";
    if (!scored) {
      r.admission = { decision: standing?.decision ?? null, rho: 0, ell: 0, state: "none" };
      return;
    }
    const part = standing.parts.get(judge) ?? 0;
    const rho = reliance(standing.decision, standing.signal, standing.signal - part);
    const ell = admissionCredit(q, standing.decision, rho, p, baseRate(candidate));
    const settled = r.settlements.some((s) => s !== null);
    const held = standing.decision === "deny" && preCredential;
    r.admission = {
      decision: standing.decision,
      rho,
      ell,
      state: settled ? "settled" : held ? "escrowed" : "applied",
    };
  }

  const scheduledLater = new Set<string>();
  /** Pre-credential referrals settle again at 24 and 36 months; scheduled whenever the status appears. */
  function scheduleLater(r: ReferralRecord, now: number): void {
    if (!r.factors?.preCredential) return;
    p.horizons.forEach((horizon, k) => {
      if (k === 0 || r.settlements[k] !== null || scheduledLater.has(`${r.intent.id}#${k}`)) return;
      scheduledLater.add(`${r.intent.id}#${k}`);
      const day = Math.max(r.intent.day + horizon + p.S, now);
      schedule({ kind: "resettle", day, key: r.intent.id, horizon: k });
    });
  }

  /** A logged correction: re-read s0 and re-settle under each result's own stored version. */
  function correct(r: ReferralRecord, asOf: number, settleAsOf: (s: SettlementResult) => number) {
    if (!r.factors) return;
    const fVersion = versionById(r.factors.fVersion);
    update(r, () => {
      fixFactors(r, asOf, fVersion);
      r.settlements = r.settlements.map((s, k) =>
        s ? settle(r, k, versionById(s.version), s.storedAt, settleAsOf(s)) : null,
      );
    });
  }

  function conflicted(member: string, candidate: string): boolean {
    if (conflicts.get(candidate)?.has(member)) return true;
    const referrers = (byCandidate.get(candidate) ?? []).map((r) => r.intent.judge);
    return world.relations.some(
      ([a, b]) =>
        (a === member && referrers.includes(b)) || (b === member && referrers.includes(a)),
    );
  }
  /** The next conflict-free committee member on the rotation, other than `not`. */
  function nextMember(candidate: string, not: string | null): string | null {
    for (let i = 0; i < committee.length; i++) {
      const member = committee[(rotation + i) % committee.length] as string;
      if (member !== not && !conflicted(member, candidate)) {
        rotation = (rotation + i + 1) % committee.length;
        return member;
      }
    }
    return null;
  }

  const handlers: Record<EventKind, (e: SimEvent) => void> = {
    refer(e) {
      const intent = intentsById.get(e.key) as ReferralIntent;
      const standing = decisionOf(decisions.get(intent.candidate), e.day);
      if (standing?.decision === "admit") return;
      const record: ReferralRecord = {
        intent,
        afterDecision: standing !== null,
        factors: null,
        admission: null,
        settlements: p.horizons.map(() => null),
        corrections: 0,
      };
      referrals.set(intent.id, record);
      const list = byCandidate.get(intent.candidate);
      if (list) list.push(record);
      else byCandidate.set(intent.candidate, [record]);
      const from = conflicts.get(intent.candidate) ?? new Set<string>();
      from.add(intent.judge);
      conflicts.set(intent.candidate, from);
      const quota = world.council.kind === "quota";
      if (!quota && !decisions.has(intent.candidate) && !pendingDecision.has(intent.candidate)) {
        pendingDecision.add(intent.candidate);
        schedule({ kind: "decide", day: e.day + world.decisionLag, key: intent.candidate });
      }
      schedule({ kind: "factors", day: e.day + Math.max(p.D, p.G + p.S), key: intent.id });
      schedule({ kind: "accuracy", day: e.day + p.observationWindow, key: intent.id });
      schedule({ kind: "settle", day: e.day + H12 + p.S, key: intent.id, horizon: 0 });
    },

    decide(e) {
      pendingDecision.delete(e.key);
      const parts = new Map<string, number>();
      let signal = 0;
      for (const r of byCandidate.get(e.key) ?? []) {
        if (r.intent.day > e.day) continue;
        const part = weights(logitOf(r.intent.judge), p).omega * r.intent.strength;
        parts.set(r.intent.judge, (parts.get(r.intent.judge) ?? 0) + part);
        signal += part;
      }
      let decision: Decision;
      if (world.council.kind === "quota") return;
      if (world.council.kind === "scripted") {
        decision = world.council.decisions.get(e.key) ?? "deny";
      } else {
        const c = candidates.get(e.key) as CandidateSpec;
        const z = (x: number) => (x - world.population.meanA) / world.population.sdA;
        const seen = visible(c, e.day);
        const score =
          world.council.signal * (signal / p.mu0 ** p.gamma) +
          world.council.substance * z(seen.substance) +
          world.council.credentials * z(seen.selection) +
          (world.council.noise.get(e.key) ?? 0);
        decision = score > world.council.threshold ? "admit" : "deny";
      }
      const decidedBy = world.deciders.get(e.key) ?? [];
      decisions.set(e.key, [{ day: e.day, decision, decidedBy, signal, parts }]);
      recordDecision(e.key, decision);
      const from = conflicts.get(e.key) ?? new Set<string>();
      for (const id of decidedBy) from.add(id);
      conflicts.set(e.key, from);
    },

    round(e) {
      // A quota council ranks every candidate in the round and admits the top
      // `quota`; it also ranks them on the unweighted signal, for comparison.
      const council = world.council;
      if (council.kind !== "quota") return;
      const round = council.rounds[Number(e.key)];
      if (!round) return;
      const z = (x: number) => (x - world.population.meanA) / world.population.sdA;
      const unweighted = p.mu0 ** p.gamma;
      const scored = round.candidates.map((candidate) => {
        const parts = new Map<string, number>();
        let signal = 0;
        let flat = 0;
        for (const r of byCandidate.get(candidate) ?? []) {
          if (r.intent.day > e.day || r.intent.stance === "no") continue;
          const part = weights(logitOf(r.intent.judge), p).omega * r.intent.strength;
          parts.set(r.intent.judge, (parts.get(r.intent.judge) ?? 0) + part);
          signal += part;
          flat += unweighted * r.intent.strength;
        }
        const seen = visible(candidates.get(candidate) as CandidateSpec, e.day);
        const base =
          council.substance * z(seen.substance) +
          council.credentials * z(seen.selection) +
          (council.noise.get(candidate) ?? 0);
        return {
          candidate,
          parts,
          signal,
          score: council.signal * (signal / unweighted) + base,
          flatScore: council.signal * (flat / unweighted) + base,
        };
      });
      const top = (key: "score" | "flatScore") =>
        new Set(
          [...scored]
            .sort((a, b) => b[key] - a[key] || (a.candidate < b.candidate ? -1 : 1))
            .slice(0, round.quota)
            .map((x) => x.candidate),
        );
      const admitted = top("score");
      const admittedFlat = top("flatScore");
      councilDiffs.push({
        day: e.day,
        quota: round.quota,
        differ: [...admitted].filter((c) => !admittedFlat.has(c)).length,
      });
      for (const x of scored) {
        const decision: Decision = admitted.has(x.candidate) ? "admit" : "deny";
        const decidedBy = world.deciders.get(x.candidate) ?? [];
        decisions.set(x.candidate, [
          { day: e.day, decision, decidedBy, signal: x.signal, parts: x.parts },
        ]);
        recordDecision(x.candidate, decision);
        const from = conflicts.get(x.candidate) ?? new Set<string>();
        for (const id of decidedBy) from.add(id);
        conflicts.set(x.candidate, from);
      }
    },

    reverse(e) {
      const history = decisions.get(e.key);
      const last = history?.at(-1);
      if (!history || !last || !e.decision) return;
      history.push({ ...last, day: e.day, decision: e.decision });
    },

    propose(e) {
      const intent = flagsById.get(e.key) as FlagIntent;
      const proposer = intent.honest ? nextMember(intent.candidate, null) : intent.proposer;
      const record: FlagRecord = {
        intent,
        proposer,
        approver: null,
        approvedAt: null,
        reversedAt: null,
      };
      flagRecords.set(intent.id, record);
      if (proposer === null) return;
      // Two-person approval: an honest flag needs a second conflict-free member;
      // a malicious one is confirmed only by its accomplice, who must also be conflict-free.
      const approver = intent.honest
        ? nextMember(intent.candidate, proposer)
        : intent.accomplice !== null && !conflicted(intent.accomplice, intent.candidate)
          ? intent.accomplice
          : null;
      if (approver === null) return;
      record.approver = approver;
      schedule({ kind: "approve", day: e.day + MONTH, key: intent.id });
    },

    approve(e) {
      const record = flagRecords.get(e.key) as FlagRecord;
      record.approvedAt = e.day;
      const active = { id: record.intent.id, amount: record.intent.amount, approvedAt: e.day };
      book.set(record.intent.item, [...(book.get(record.intent.item) ?? []), active]);
      if (record.intent.reverseAfter !== null) {
        schedule({ kind: "unflag", day: e.day + record.intent.reverseAfter, key: e.key });
      }
    },

    unflag(e) {
      // A logged correction (§3.12): erase the flag from history, rebuild every
      // fit released since it took effect, and recompute every snapshot and
      // settlement that could have read it.
      const record = flagRecords.get(e.key) as FlagRecord;
      record.reversedAt = e.day;
      const remaining = (book.get(record.intent.item) ?? []).filter(
        (f) => f.id !== record.intent.id,
      );
      if (remaining.length > 0) book.set(record.intent.item, remaining);
      else book.delete(record.intent.item);
      for (let i = 0; i < versions.length; i++) {
        const v = versions[i] as FitVersion;
        if (v.releasedAt >= (record.approvedAt ?? 0))
          versions[i] = buildVersion(v.version, v.releasedAt);
      }
      recomputeSpread();
      for (const r of referrals.values()) {
        if (!r.factors) continue;
        correct(r, r.factors.s0AsOf, (s) => s.correctedAsOf);
      }
    },

    release(e) {
      versions.push(buildVersion(versions.length + 1, e.day));
    },

    watch(e) {
      const eligible: string[] = [];
      for (const [candidate, list] of byCandidate) {
        if (watchDone.has(candidate)) continue;
        if (decisionOf(decisions.get(candidate), e.day)?.decision === "admit") continue;
        const since = watchSince.get(candidate) ?? e.day;
        watchSince.set(candidate, since);
        if (e.day - since > p.watchMaxDays) {
          watchDone.add(candidate);
          continue;
        }
        eligible.push(candidate);
        eligibleEver.set(candidate, [...new Set(list.map((r) => r.intent.judge))]);
      }
      // Prioritised half by bet size Σ b·c (no judge weight); random half uniform.
      const betSize = (candidate: string): number =>
        (byCandidate.get(candidate) ?? []).reduce(
          (sum, r) =>
            sum + recognitionStake(r.intent.answer, p) * credentialStake(r.factors?.gap ?? 0, p),
          0,
        );
      const prioritised = [...eligible].sort((x, y) => betSize(y) - betSize(x) || (x < y ? -1 : 1));
      const rng = streamFor(`watch@${e.day}`);
      const random = [...eligible];
      for (let i = random.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [random[i], random[j]] = [random[j] as string, random[i] as string];
      }
      const perJudge = new Map<string, number>();
      const checked = new Set<string>();
      const version = latest(e.day + 1);
      const run = (order: string[], half: CheckRecord["half"], budget: number) => {
        let used = 0;
        for (const candidate of order) {
          if (used >= budget) break;
          if (checked.has(candidate)) continue;
          const referrers = eligibleEver.get(candidate) ?? [];
          if (referrers.some((j) => (perJudge.get(j) ?? 0) >= p.C)) continue;
          const checker = nextMember(candidate, null);
          if (checker === null) continue;
          used++;
          checked.add(candidate);
          for (const j of referrers) perJudge.set(j, (perJudge.get(j) ?? 0) + 1);
          const c = candidates.get(candidate) as CandidateSpec;
          const years = (e.day - c.intakeDay) / 365;
          const seen =
            trueLevel(c, e.day) -
            trueLevel(c, c.intakeDay) -
            world.population.meanG * years +
            (world.committee.get(checker) ?? 0) * gaussianFor(`${candidate}@${e.day}`);
          const prediction: Finding = seen > 0.05 ? "rose" : seen < -0.05 ? "fell" : "flat";
          // "Rose": above normal movement for the time elapsed since intake.
          const s0 = intakeS0(c, e.day).substance;
          const norm = normFor(version, 0, "");
          const z =
            (visible(c, e.day, "all").substance -
              s0 -
              evalLine(norm.line, s0, c.year ?? 3) * years) /
            norm.spread;
          const finding: Finding = z > p.watchRiseZ ? "rose" : z < -p.watchRiseZ ? "fell" : "flat";
          checks.push({ day: e.day, candidate, checker, half, prediction, finding });
          if (finding === "rose") {
            watchDone.add(candidate);
            regret.push(candidate);
          }
        }
      };
      // The random half is drawn first, from every eligible candidate, so it is an
      // unbiased baseline; the prioritised half then takes the highest bets left.
      const randomBudget = Math.floor(p.B / 2);
      run(random, "random", randomBudget);
      run(prioritised, "priority", p.B - randomBudget);
    },

    intake_s12(e) {
      const c = candidates.get(e.key) as CandidateSpec;
      settledAtK.push({ id: e.key, day: e.day, s0: intakeS0(c, e.day).substance });
      K = settledAtK.length;
      spread = stdev(settledAtK.map((entry) => entry.s0));
      if (gateOpenedDay === null && kappaM() > 0) gateOpenedDay = e.day;
    },

    factors(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      update(r, () => fixFactors(r, e.day, latest(e.day)));
      if (r.admission?.state !== "none") bump(r.intent.judge);
      const c = candidates.get(r.intent.candidate) as CandidateSpec;
      const t = r.intent.day;
      const late = new Set<number>();
      for (const item of c.items) {
        if (item.channel === "deep" || item.datedAt > t + p.G) continue;
        if (item.availableAt > t + p.G + p.S) late.add(item.availableAt);
      }
      for (const day of [...late].sort((x, y) => x - y)) {
        schedule({ kind: "correct", day: Math.max(day, e.day), key: r.intent.id });
      }
      scheduleLater(r, e.day);
    },

    correct(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      correct(r, e.day, () => e.day);
      r.corrections++;
      scheduleLater(r, e.day);
    },

    accuracy(e) {
      const record = referrals.get(e.key) as ReferralRecord;
      if (record.intent.stance === "no") return;
      const c = candidates.get(record.intent.candidate) as CandidateSpec;
      const starts = latest(e.day + 1)?.starts ?? [];
      if (starts.length === 0) return;
      // Level-only truth: the percentile of today's substance among the fits' starting scores.
      const seen = visible(c, e.day).substance;
      const below = starts.filter((s) => s < seen).length;
      const ties = starts.filter((s) => s === seen).length;
      const truth = (below + ties / 2) / starts.length;
      const t = termsOf(record.intent.judge);
      t.accuracy = scoreAccuracy(t.accuracy, record.intent.strength, truth, p);
      bump(record.intent.judge);
    },

    settle(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      const result = settle(r, 0, latest(e.day), e.day, e.day);
      if (!result) return;
      update(r, () => {
        r.settlements[0] = result;
        if (r.admission && r.admission.state !== "none") r.admission.state = "settled";
      });
      termsOf(r.intent.judge).nSettled++;
      bump(r.intent.judge);
    },

    resettle(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      const k = e.horizon ?? 1;
      if (!r.settlements[0] || !r.factors?.preCredential) return;
      const result = settle(r, k, latest(e.day), e.day, e.day);
      if (!result) return;
      update(r, () => {
        r.settlements[k] = result;
      });
    },
  };

  const judgeIds = world.judges.map((j) => j.id);
  const monthly = new Map<string, number[]>(judgeIds.map((id) => [id, []]));
  const maxEventDelta = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<EventKind, number>;
  const bounds = { minW: 1, maxW: 0, minOmega: 1, maxOmega: 0 };
  let gateLeak = 0;
  const observe = (): number[] =>
    judgeIds.map((id) => {
      const l = logitOf(id);
      const { w, omega } = weights(l, p);
      bounds.minW = Math.min(bounds.minW, w);
      bounds.maxW = Math.max(bounds.maxW, w);
      bounds.minOmega = Math.min(bounds.minOmega, omega);
      bounds.maxOmega = Math.max(bounds.maxOmega, omega);
      if (kappaM() === 0) {
        const withoutMovement = logitWeight({ ...termsOf(id), sumM: 0 }, 0, p);
        gateLeak = Math.max(gateLeak, Math.abs(l - withoutMovement));
      }
      return l;
    });

  let before = observe();
  for (let day = 0; day < world.days; day++) {
    const events = queue.get(day) ?? [];
    events.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
    for (const e of events) {
      handlers[e.kind](e);
      const after = observe();
      for (let i = 0; i < after.length; i++) {
        const delta = Math.abs((after[i] as number) - (before[i] as number));
        maxEventDelta[e.kind] = Math.max(maxEventDelta[e.kind], delta);
      }
      before = after;
    }
    if (day % MONTH === MONTH - 1) {
      for (const id of judgeIds) monthly.get(id)?.push(weights(logitOf(id), p).w);
    }
  }

  const all = [...referrals.values()];
  return {
    judges: judgeIds.map((id) => {
      const l = logitOf(id);
      return {
        id,
        logit: l,
        w: weights(l, p).w,
        label: judgeLabel(signals.get(id) ?? 0, p),
        referrals: all.filter((r) => r.intent.judge === id).length,
      };
    }),
    monthly,
    referrals: all,
    bounds,
    maxEventDelta,
    gateLeak,
    gateOpenedDay,
    K,
    kappaM: kappaM(),
    versions,
    flags: [...flagRecords.values()],
    councilDiffs,
    decided: new Map(
      [...decisions].map(([id, history]) => [id, (history.at(-1) as DecisionRecord).decision]),
    ),
    watch: { checks, regret, eligible: eligibleEver, conflicts },
  };
}

/** The latest filled settlement of a referral, if any. */
export const latestSettlement = (r: ReferralRecord): SettlementResult | null =>
  r.settlements.reduce<SettlementResult | null>((last, s) => s ?? last, null);
