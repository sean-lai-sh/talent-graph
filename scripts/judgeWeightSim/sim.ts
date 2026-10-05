/**
 * Runs one world through the r8 pipeline, one dated event at a time:
 * referrals, council decisions, fit releases, snapshots and their
 * corrections, admission credit and escrow, V2 accuracy, 12- and 24-month
 * settlement, and the quarterly anti-cohort watch. Every weight change
 * happens inside exactly one event, so the per-event bound is measured per
 * event kind, not assumed.
 */

import { mulberry32 } from "../../src/seed/prng.ts";
import {
  admissionCredit,
  type BoundedEvent,
  checkpointWindow,
  credentialStake,
  type Decision,
  EMPTY_TERMS,
  evalLine,
  type FitPoint,
  fitLine,
  fitNorm,
  isContrarian,
  type JudgeTerms,
  judgeLabel,
  type Line,
  logitWeight,
  type MovementNorm,
  movementBeyondNormal,
  movementCredit,
  movementScale,
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
import { type CandidateSpec, MONTH, type ReferralIntent, trueLevel, type World } from "./world.ts";

type EventKind =
  | "refer"
  | "decide"
  | "reverse"
  | "release"
  | "watch"
  | "intake_s12"
  | "factors"
  | "correct"
  | "accuracy"
  | "settle12"
  | "settle24";

/** Same-day events run in this order; every kind is listed once. */
const ORDER: readonly EventKind[] = [
  "refer",
  "decide",
  "reverse",
  "release",
  "watch",
  "intake_s12",
  "factors",
  "correct",
  "accuracy",
  "settle12",
  "settle24",
];

/** Which §6 per-event bound each weight-moving event kind answers to. */
export const BOUND_OF: Partial<Record<EventKind, BoundedEvent>> = {
  factors: "admission",
  correct: "correct",
  accuracy: "accuracy",
  settle12: "settle12",
  settle24: "settle24",
  intake_s12: "ramp",
  watch: "release",
};

interface SimEvent {
  kind: EventKind;
  day: number;
  key: string;
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

/** A frozen fit release (§3.6): every stored result records the one it used. */
export interface FitVersion {
  version: number;
  releasedAt: number;
  f: Line;
  e12: MovementNorm;
  e24: MovementNorm;
  /** Starting scores the fits saw: the reference for V2's level truth. */
  starts: number[];
}

export interface Factors {
  s0: Snapshot | null;
  fVersion: number;
  gap: number;
  position: number;
  q: number;
  contrarian: boolean;
  recused: boolean;
}

export type EscrowState = "none" | "applied" | "escrowed" | "released" | "settled";

export interface AdmissionResult {
  decision: Decision | null;
  rho: number;
  /** ℓᴬ as computed; whether it counts depends on `state`. */
  ell: number;
  /** "none": unscored. "applied": counts now. "escrowed": held. "released": cleared by the watch. */
  state: EscrowState;
}

export interface SettlementResult {
  storedAt: number;
  d: number;
  /** d had withheld evidence been submitted on time, under the same frozen version. */
  dOnTime: number | null;
  stake: number;
  ell: number;
  version: number;
  /** κ_m on the settlement day. */
  kappaM: number;
}

export interface ReferralRecord {
  intent: ReferralIntent;
  afterDecision: boolean;
  factors: Factors | null;
  admission: AdmissionResult | null;
  settle12: SettlementResult | null;
  settle24: SettlementResult | null;
  corrections: number;
}

export type Finding = "rose" | "flat" | "fell";

export interface CheckRecord {
  day: number;
  candidate: string;
  checker: string;
  prediction: Finding;
  finding: Finding;
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
  watch: {
    checks: CheckRecord[];
    /** The regret report: denied or stalled candidates a check found risen. */
    regret: string[];
    /** Each candidate's decidedBy and referrers, for the recusal check. */
    recusedFrom: Map<string, Set<string>>;
  };
}

const decisionOf = (history: DecisionRecord[] | undefined, day: number): DecisionRecord | null => {
  let standing: DecisionRecord | null = null;
  for (const d of history ?? []) if (d.day <= day) standing = d;
  return standing;
};

/** Deterministic per-check noise: no shared random stream, so check order can't change it. */
function checkNoise(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  const rng = mulberry32(h);
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
  const startsAtK: number[] = [];
  let K = 0;
  let spread = 0;
  let gateOpenedDay: number | null = null;
  const watchState = new Map<string, { since: number; flats: number; done: boolean }>();
  const checks: CheckRecord[] = [];
  const regret: string[] = [];
  const recusedFrom = new Map<string, Set<string>>();
  const committee = [...world.committee.keys()].sort();
  let rotation = 0;

  const queue = new Map<number, SimEvent[]>();
  const schedule = (e: SimEvent): void => {
    if (e.day >= world.days) return;
    const list = queue.get(e.day);
    if (list) list.push(e);
    else queue.set(e.day, [e]);
  };
  for (const c of world.candidates) {
    schedule({ kind: "intake_s12", day: c.intakeDay + p.horizon12 + p.S, key: c.id });
  }
  for (const r of world.intents) schedule({ kind: "refer", day: r.day, key: r.id });
  for (const r of world.reversals) {
    schedule({ kind: "reverse", day: r.day, key: r.candidate, decision: r.decision });
  }
  for (let day = p.quarter; day < world.days; day += p.quarter) {
    schedule({ kind: "release", day, key: "fits" });
    schedule({ kind: "watch", day, key: "watch" });
  }
  const intentsById = new Map(world.intents.map((r) => [r.id, r]));

  const kappaM = (): number => movementScale(K, spread, p);
  const termsOf = (judge: string): JudgeTerms => terms.get(judge) as JudgeTerms;
  const logitOf = (judge: string): number => logitWeight(termsOf(judge), kappaM(), p);
  const bump = (judge: string): void => {
    signals.set(judge, (signals.get(judge) ?? 0) + 1);
  };
  const EMPTY_VERSION: FitVersion = {
    version: 0,
    releasedAt: 0,
    f: { a: 0, b: 0 },
    e12: fitNorm([], p),
    e24: fitNorm([], p),
    starts: [],
  };
  const latest = (day: number): FitVersion => {
    for (let i = versions.length - 1; i >= 0; i--) {
      if ((versions[i] as FitVersion).releasedAt < day) return versions[i] as FitVersion;
    }
    return EMPTY_VERSION;
  };
  const versionById = (id: number): FitVersion => versions[id - 1] ?? EMPTY_VERSION;
  const visible = (c: CandidateSpec, day: number, scope: "standard" | "all" = "standard") =>
    takeSnapshot(c.items, { evidenceCutoff: day, asOf: day, scope }, p);

  /** A referral's current terms: applied admission credit and its latest movement result. */
  const contribution = (r: ReferralRecord): { a: number; m: number } => ({
    a: r.admission?.state === "applied" ? r.admission.ell : 0,
    m: r.settle24?.ell ?? r.settle12?.ell ?? 0,
  });
  /** Mutate a referral and move its judge's sums by exactly the change in its terms. */
  const update = (r: ReferralRecord, change: () => void): void => {
    const before = contribution(r);
    change();
    const after = contribution(r);
    const t = termsOf(r.intent.judge);
    t.sumA += after.a - before.a;
    t.sumM += after.m - before.m;
  };

  function settle(r: ReferralRecord, horizon: number, day: number): SettlementResult | null {
    const f = r.factors;
    const admission = r.admission;
    if (!f?.s0 || !admission) return null;
    const c = candidates.get(r.intent.candidate) as CandidateSpec;
    const t = r.intent.day;
    const prior = horizon === p.horizon12 ? r.settle12 : r.settle24;
    const version = prior ? versionById(prior.version) : latest(day);
    const norm = horizon === p.horizon12 ? version.e12 : version.e24;
    const sk = takeSnapshot(c.items, checkpointWindow(t, horizon, p, day), p).substance;
    const d = movementBeyondNormal(f.s0.substance, sk, norm, p.h);
    let dOnTime: number | null = null;
    if (c.onTimeItems) {
      const s0 = takeSnapshot(c.onTimeItems, s0Window(t, p), p).substance;
      const skOnTime = takeSnapshot(c.onTimeItems, checkpointWindow(t, horizon, p), p).substance;
      dOnTime = movementBeyondNormal(s0, skOnTime, norm, p.h);
    }
    const admitted = admission.decision === "admit" && !f.recused;
    const stake = f.recused ? 1 : settlementStake(admitted, admission.rho, p);
    return {
      storedAt: prior?.storedAt ?? day,
      d,
      dOnTime,
      stake,
      ell: movementCredit(f.q, stake, d, p),
      version: version.version,
      kappaM: prior?.kappaM ?? kappaM(),
    };
  }

  /** §3.2–§3.3 factors and admission credit, from s0 as of `asOf` and a fixed f version. */
  function fixFactors(r: ReferralRecord, asOf: number, fVersion: FitVersion): void {
    const { judge, candidate, day } = r.intent;
    const c = candidates.get(candidate) as CandidateSpec;
    const hasIntake = c.intakeDay <= day + p.G + p.S;
    const s0 = hasIntake ? takeSnapshot(c.items, s0Window(day, p, asOf), p) : null;
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
          eligible: x === r || !recusedOf(x),
        })),
    );
    const position = positions.get(r.intent.id) ?? 1;
    const gap = s0 ? s0.substance - evalLine(fVersion.f, s0.selection) : 0;
    const q = referralWeight(position, gap, r.intent.answer, p);
    const contrarian = isContrarian(r.intent.answer, gap, p);
    r.factors = { s0, fVersion: fVersion.version, gap, position, q, contrarian, recused };

    const scored = standing !== null && !recused && !r.afterDecision && s0 !== null;
    if (!scored) {
      r.admission = { decision: standing?.decision ?? null, rho: 0, ell: 0, state: "none" };
      return;
    }
    const part = standing.parts.get(judge) ?? 0;
    const rho = reliance(standing.decision, standing.signal, standing.signal - part);
    const ell = admissionCredit(q, standing.decision, rho, p);
    const previous = r.admission?.state;
    const held = standing.decision === "deny" && contrarian;
    const state: EscrowState =
      previous === "settled" || previous === "released" ? previous : held ? "escrowed" : "applied";
    r.admission = { decision: standing.decision, rho, ell, state };
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
        settle12: null,
        settle24: null,
        corrections: 0,
      };
      referrals.set(intent.id, record);
      const list = byCandidate.get(intent.candidate);
      if (list) list.push(record);
      else byCandidate.set(intent.candidate, [record]);
      const from = recusedFrom.get(intent.candidate) ?? new Set<string>();
      from.add(intent.judge);
      recusedFrom.set(intent.candidate, from);
      if (!decisions.has(intent.candidate) && !pendingDecision.has(intent.candidate)) {
        pendingDecision.add(intent.candidate);
        schedule({ kind: "decide", day: e.day + world.decisionLag, key: intent.candidate });
      }
      schedule({ kind: "factors", day: e.day + Math.max(p.D, p.G + p.S), key: intent.id });
      schedule({ kind: "accuracy", day: e.day + p.observationWindow, key: intent.id });
      schedule({ kind: "settle12", day: e.day + p.horizon12 + p.S, key: intent.id });
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
      const from = recusedFrom.get(e.key) ?? new Set<string>();
      for (const id of decidedBy) from.add(id);
      recusedFrom.set(e.key, from);
    },

    reverse(e) {
      const history = decisions.get(e.key);
      const last = history?.at(-1);
      if (!history || !last || !e.decision) return;
      history.push({ ...last, day: e.day, decision: e.decision });
    },

    release(e) {
      const f: FitPoint[] = [];
      const e12: FitPoint[] = [];
      const e24: FitPoint[] = [];
      for (const c of world.candidates) {
        if (c.intakeDay + p.G + p.S > e.day) continue;
        const s0 = takeSnapshot(c.items, s0Window(c.intakeDay, p, e.day), p);
        f.push({ x: s0.selection, y: s0.substance });
        for (const [horizon, points] of [
          [p.horizon12, e12],
          [p.horizon24, e24],
        ] as const) {
          if (c.intakeDay + horizon + p.S > e.day) continue;
          const sk = takeSnapshot(c.items, checkpointWindow(c.intakeDay, horizon, p, e.day), p);
          points.push({ x: s0.substance, y: sk.substance - s0.substance });
        }
      }
      versions.push({
        version: versions.length + 1,
        releasedAt: e.day,
        f: fitLine(f),
        e12: fitNorm(e12, p),
        e24: fitNorm(e24, p),
        starts: f.map((pt) => pt.y),
      });
    },

    watch(e) {
      for (const [candidate, list] of byCandidate) {
        if (watchState.has(candidate)) continue;
        const standing = decisionOf(decisions.get(candidate), e.day);
        if (standing?.decision === "admit") continue;
        const backed = list.some(
          (r) =>
            r.factors?.contrarian ||
            (r.factors?.position === 1 &&
              judgeLabel(signals.get(r.intent.judge) ?? 0, p) === "calibrated"),
        );
        if (backed) watchState.set(candidate, { since: e.day, flats: 0, done: false });
      }
      const priority = (candidate: string): number =>
        (byCandidate.get(candidate) ?? []).reduce((sum, r) => {
          if (!r.factors) return sum;
          const omega = weights(logitOf(r.intent.judge), p).omega;
          return (
            sum + omega * recognitionStake(r.intent.answer, p) * credentialStake(r.factors.gap, p)
          );
        }, 0);
      const active = [...watchState.entries()]
        .filter(([candidate, s]) => {
          if (s.done) return false;
          if (e.day - s.since > p.watchMaxDays) s.done = true;
          return !s.done && decisionOf(decisions.get(candidate), e.day)?.decision !== "admit";
        })
        .map(([candidate]) => ({ candidate, priority: priority(candidate) }))
        .sort((x, y) => y.priority - x.priority || (x.candidate < y.candidate ? -1 : 1));
      const version = latest(e.day + 1);
      let used = 0;
      for (const { candidate } of active) {
        if (used >= p.B) break;
        const recused = recusedFrom.get(candidate) ?? new Set<string>();
        let checker: string | null = null;
        for (let i = 0; i < committee.length; i++) {
          const member = committee[(rotation + i) % committee.length] as string;
          if (!recused.has(member)) {
            checker = member;
            rotation = (rotation + i + 1) % committee.length;
            break;
          }
        }
        if (checker === null) continue;
        used++;
        const c = candidates.get(candidate) as CandidateSpec;
        const years = (e.day - c.intakeDay) / 365;
        const seen =
          trueLevel(c, e.day) -
          trueLevel(c, c.intakeDay) -
          world.population.meanG * years +
          (world.committee.get(checker) ?? 0) * checkNoise(`${candidate}@${e.day}`);
        const prediction: Finding = seen > 0.05 ? "rose" : seen < -0.05 ? "fell" : "flat";
        const start = (byCandidate.get(candidate) ?? []).find((r) => r.factors?.s0)?.factors?.s0;
        const z = start
          ? (visible(c, e.day, "all").substance -
              start.substance -
              evalLine(version.e12.line, start.substance) -
              version.e12.median) /
            version.e12.spread
          : 0;
        const finding: Finding = z > p.watchRiseZ ? "rose" : z < -p.watchRiseZ ? "fell" : "flat";
        checks.push({ day: e.day, candidate, checker, prediction, finding });
        const state = watchState.get(candidate) as { since: number; flats: number; done: boolean };
        if (finding === "rose") {
          state.done = true;
          regret.push(candidate);
          for (const r of byCandidate.get(candidate) ?? []) {
            if (r.admission?.state !== "escrowed") continue;
            update(r, () => {
              if (r.admission) r.admission.state = "released";
            });
          }
        } else {
          state.flats = finding === "flat" ? state.flats + 1 : 0;
          if (state.flats >= p.watchFlatExit) state.done = true;
        }
      }
    },

    intake_s12(e) {
      const c = candidates.get(e.key) as CandidateSpec;
      startsAtK.push(takeSnapshot(c.items, s0Window(c.intakeDay, p, e.day), p).substance);
      K = startsAtK.length;
      spread = stdev(startsAtK);
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
      if (r.factors?.contrarian) {
        schedule({ kind: "settle24", day: t + p.horizon24 + p.S, key: r.intent.id });
      }
    },

    correct(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      if (!r.factors) return;
      const fVersion = versionById(r.factors.fVersion);
      update(r, () => {
        fixFactors(r, e.day, fVersion);
        if (r.settle12) r.settle12 = settle(r, p.horizon12, e.day);
        if (r.settle24) r.settle24 = settle(r, p.horizon24, e.day);
      });
      r.corrections++;
    },

    accuracy(e) {
      const record = referrals.get(e.key) as ReferralRecord;
      const c = candidates.get(record.intent.candidate) as CandidateSpec;
      const starts = latest(e.day + 1).starts;
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

    settle12(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      const result = settle(r, p.horizon12, e.day);
      if (!result) return;
      update(r, () => {
        r.settle12 = result;
        if (r.admission && (r.admission.state === "applied" || r.admission.state === "escrowed")) {
          r.admission.state = "settled";
        }
      });
      termsOf(r.intent.judge).nSettled++;
      bump(r.intent.judge);
    },

    settle24(e) {
      const r = referrals.get(e.key) as ReferralRecord;
      if (!r.settle12 || !r.factors?.contrarian) return;
      const result = settle(r, p.horizon24, e.day);
      if (!result) return;
      update(r, () => {
        r.settle24 = result;
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
    watch: { checks, regret, recusedFrom },
  };
}
