/**
 * Runs one world through the r7 pipeline, one dated event at a time:
 * referrals, council decisions, snapshots, admission credit, V2 accuracy,
 * settlement. Every weight change happens inside exactly one event, so the
 * per-event bound is measured, not assumed.
 */

import {
  admissionCredit,
  type Decision,
  EMPTY_TERMS,
  type FitPoint,
  fitLineLeaveOneOut,
  type JudgeTerms,
  judgeLabel,
  logitWeight,
  movementBeyondNormal,
  movementCredit,
  movementScale,
  type Params,
  rankPositions,
  referralWeight,
  reliance,
  type Snapshot,
  s0Window,
  s12Window,
  scoreAccuracy,
  settlementStake,
  takeSnapshot,
  weights,
} from "./model.ts";
import { type CandidateSpec, MONTH, type ReferralIntent, type World } from "./world.ts";

type EventKind =
  | "refer"
  | "decide"
  | "reverse"
  | "intake_s0"
  | "intake_s12"
  | "admission"
  | "accuracy"
  | "settle";

/** Same-day events run in this order; every kind is listed once. */
const ORDER: readonly EventKind[] = [
  "refer",
  "decide",
  "reverse",
  "intake_s0",
  "intake_s12",
  "admission",
  "accuracy",
  "settle",
];

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

export interface AdmissionResult {
  decision: Decision | null;
  recused: boolean;
  position: number | null;
  q: number;
  rho: number;
  /** ℓᴬ as stored; 0 when unscored, recused or without a starting snapshot. */
  ell: number;
}

export interface SettlementResult {
  storedAt: number;
  d: number;
  /** d had the candidate's withheld evidence arrived on time, under the same frozen e. */
  dOnTime: number | null;
  stake: number;
  ell: number;
  eVersion: number;
  s12Hash: string;
  /** κ_m on the settlement day, and ℓᴬ the settlement removed. */
  kappaM: number;
  removedA: number;
}

export interface ReferralRecord {
  intent: ReferralIntent;
  s0: Snapshot | null;
  gap: number | null;
  admission: AdmissionResult | null;
  settlement: SettlementResult | null;
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
  /** κ_m on the last day. */
  kappaM: number;
}

const decisionOf = (history: DecisionRecord[] | undefined, day: number): DecisionRecord | null => {
  let standing: DecisionRecord | null = null;
  for (const d of history ?? []) if (d.day <= day) standing = d;
  return standing;
};

function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

export function simulate(world: World, p: Params): RunResult {
  const terms = new Map<string, JudgeTerms>(world.judges.map((j) => [j.id, { ...EMPTY_TERMS }]));
  const signals = new Map<string, number>(world.judges.map((j) => [j.id, 0]));
  const candidates = new Map<string, CandidateSpec>(world.candidates.map((c) => [c.id, c]));
  const referrals = new Map<string, ReferralRecord>();
  const byCandidate = new Map<string, ReferralRecord[]>();
  const decisions = new Map<string, DecisionRecord[]>();
  const pendingDecision = new Set<string>();
  const fPoints: FitPoint[] = [];
  const ePoints: FitPoint[] = [];
  const intakeS0 = new Map<string, Snapshot>();
  let K = 0;
  let spread = 0;
  let gateOpenedDay: number | null = null;

  const queue = new Map<number, SimEvent[]>();
  const schedule = (e: SimEvent): void => {
    if (e.day >= world.days) return;
    const list = queue.get(e.day);
    if (list) list.push(e);
    else queue.set(e.day, [e]);
  };
  for (const c of world.candidates) {
    schedule({ kind: "intake_s0", day: c.intakeDay + p.G + p.S, key: c.id });
    schedule({ kind: "intake_s12", day: c.intakeDay + p.horizon + p.S, key: c.id });
  }
  for (const r of world.intents) schedule({ kind: "refer", day: r.day, key: r.id });
  for (const r of world.reversals) {
    schedule({ kind: "reverse", day: r.day, key: r.candidate, decision: r.decision });
  }
  const intentsById = new Map(world.intents.map((r) => [r.id, r]));

  const kappaM = (): number => movementScale(K, spread, p);
  const termsOf = (judge: string): JudgeTerms => terms.get(judge) as JudgeTerms;
  const logitOf = (judge: string): number => logitWeight(termsOf(judge), kappaM(), p);
  const bump = (judge: string): void => {
    signals.set(judge, (signals.get(judge) ?? 0) + 1);
  };

  const currentSubstance = (c: CandidateSpec, day: number): number | null =>
    takeSnapshot(c.items, { evidenceCutoff: day, ingestionCutoff: day }, p).substance;

  const handlers: Record<EventKind, (e: SimEvent) => void> = {
    refer(e) {
      const intent = intentsById.get(e.key) as ReferralIntent;
      if (decisionOf(decisions.get(intent.candidate), e.day)?.decision === "admit") return;
      const record: ReferralRecord = {
        intent,
        s0: null,
        gap: null,
        admission: null,
        settlement: null,
      };
      referrals.set(intent.id, record);
      const list = byCandidate.get(intent.candidate);
      if (list) list.push(record);
      else byCandidate.set(intent.candidate, [record]);
      if (!decisions.has(intent.candidate) && !pendingDecision.has(intent.candidate)) {
        pendingDecision.add(intent.candidate);
        schedule({ kind: "decide", day: e.day + world.decisionLag, key: intent.candidate });
      }
      schedule({ kind: "admission", day: e.day + Math.max(p.D, p.G + p.S), key: intent.id });
      schedule({ kind: "accuracy", day: e.day + p.observationWindow, key: intent.id });
      schedule({ kind: "settle", day: e.day + p.horizon + p.S, key: intent.id });
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
        const seen = currentSubstance(c, e.day);
        const sel = takeSnapshot(c.items, { evidenceCutoff: e.day, ingestionCutoff: e.day }, p);
        const score =
          world.council.signal * (signal / p.mu0 ** p.gamma) +
          world.council.substance * (seen === null ? -1 : z(seen)) +
          world.council.credentials * z(sel.selection) +
          (world.council.noise.get(e.key) ?? 0);
        decision = score > world.council.threshold ? "admit" : "deny";
      }
      decisions.set(e.key, [
        {
          day: e.day,
          decision,
          decidedBy: world.deciders.get(e.key) ?? [],
          signal,
          parts,
        },
      ]);
    },

    reverse(e) {
      const history = decisions.get(e.key);
      const last = history?.at(-1);
      if (!history || !last || !e.decision) return;
      history.push({ ...last, day: e.day, decision: e.decision });
    },

    intake_s0(e) {
      const c = candidates.get(e.key) as CandidateSpec;
      const snap = takeSnapshot(c.items, s0Window(c.intakeDay, p), p);
      intakeS0.set(c.id, snap);
      if (snap.substance === null) return;
      fPoints.push({ id: c.id, x: snap.selection, y: snap.substance });
    },

    intake_s12(e) {
      const c = candidates.get(e.key) as CandidateSpec;
      const s0 = intakeS0.get(c.id)?.substance ?? null;
      const s12 = takeSnapshot(c.items, s12Window(c.intakeDay, p), p).substance;
      if (s0 === null || s12 === null) return;
      ePoints.push({ id: c.id, x: s0, y: s12 - s0 });
      K = ePoints.length;
      spread = sd(ePoints.map((pt) => pt.x));
      if (gateOpenedDay === null && kappaM() > 0) gateOpenedDay = e.day;
    },

    admission(e) {
      const record = referrals.get(e.key) as ReferralRecord;
      const { judge, candidate, day } = record.intent;
      const c = candidates.get(candidate) as CandidateSpec;
      // s0's cutoffs are fixed, so taking it now stores the value it had at t + G + S.
      record.s0 = takeSnapshot(c.items, s0Window(day, p), p);
      const standingOf = (r: ReferralRecord) =>
        decisionOf(decisions.get(candidate), r.intent.day + p.D);
      const recusedOf = (r: ReferralRecord) =>
        standingOf(r)?.decidedBy.includes(r.intent.judge) ?? false;
      const standing = standingOf(record);
      const recused = recusedOf(record);
      const peers = (byCandidate.get(candidate) ?? []).filter((r) => r.intent.day <= day);
      // Recused referrals take no position from anyone else; a recused
      // referral's own stake uses the position it would hold among the rest.
      const positions = rankPositions(
        peers.map((r) => ({
          id: r.intent.id,
          judge: r.intent.judge,
          day: r.intent.day,
          eligible: r === record || !recusedOf(r),
        })),
      );
      const position = positions.get(record.intent.id) ?? null;
      if (record.s0.substance !== null) {
        const f = fitLineLeaveOneOut(fPoints, candidate);
        record.gap = record.s0.substance - (f.a + f.b * record.s0.selection);
      }
      const q =
        record.gap === null ? 0 : referralWeight(position, record.gap, record.intent.answer, p);
      const signal = standing?.signal ?? 0;
      const part = standing?.parts.get(judge) ?? 0;
      const rho = reliance(signal, signal - part);
      const scored = standing !== null && !recused && record.s0.substance !== null;
      const ell = scored ? admissionCredit(q, standing.decision, rho, p) : 0;
      record.admission = { decision: standing?.decision ?? null, recused, position, q, rho, ell };
      termsOf(judge).sumA += ell;
      if (scored) bump(judge);
    },

    accuracy(e) {
      const record = referrals.get(e.key) as ReferralRecord;
      const c = candidates.get(record.intent.candidate) as CandidateSpec;
      const seen = currentSubstance(c, e.day);
      if (seen === null || fPoints.length === 0) return;
      // Level-only truth: the percentile of today's substance among stored starting scores.
      const below = fPoints.filter((pt) => pt.y < seen).length;
      const ties = fPoints.filter((pt) => pt.y === seen).length;
      const truth = (below + ties / 2) / fPoints.length;
      const t = termsOf(record.intent.judge);
      t.accuracy = scoreAccuracy(t.accuracy, record.intent.strength, truth, p);
      bump(record.intent.judge);
    },

    settle(e) {
      const record = referrals.get(e.key) as ReferralRecord;
      const admission = record.admission;
      const s0 = record.s0?.substance ?? null;
      if (!admission || s0 === null) return;
      const c = candidates.get(record.intent.candidate) as CandidateSpec;
      const window = s12Window(record.intent.day, p);
      const s12 = takeSnapshot(c.items, window, p);
      if (s12.substance === null) return;
      const e12 = fitLineLeaveOneOut(ePoints, c.id);
      const d = movementBeyondNormal(s0, s12.substance, e12, p.h);
      let dOnTime: number | null = null;
      if (c.onTimeItems) {
        const t = record.intent.day;
        const s0OnTime = takeSnapshot(c.onTimeItems, s0Window(t, p), p).substance;
        const s12OnTime = takeSnapshot(c.onTimeItems, window, p).substance;
        if (s0OnTime !== null && s12OnTime !== null) {
          dOnTime = movementBeyondNormal(s0OnTime, s12OnTime, e12, p.h);
        }
      }
      const admitted = admission.decision === "admit" && !admission.recused;
      const stake = admission.recused ? 1 : settlementStake(admitted, admission.rho, p);
      const ell = movementCredit(admission.q, stake, d, p);
      const t = termsOf(record.intent.judge);
      t.sumA -= admission.ell;
      t.sumM += ell;
      t.nSettled++;
      bump(record.intent.judge);
      record.settlement = {
        storedAt: e.day,
        d,
        dOnTime,
        stake,
        ell,
        eVersion: e12.version,
        s12Hash: s12.hash,
        kappaM: kappaM(),
        removedA: admission.ell,
      };
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
  };
}
