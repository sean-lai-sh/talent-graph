/**
 * Time-sliced judge calibration for the interactive explainer.
 *
 * Replays `computeJudgeCalibration` at successive time steps T so a UI can
 * show Judge Reliability p̂ and Scout Information Gain Ĝ as separate fields.
 * Presentation only: the math lives in `src/judges/` and `src/scoring/`. Does
 * not import `src/inference/` — truth is outcomes, never pairwise estimates.
 * Ĝ is copied from `run.scout` and is never added to reliability.
 *
 * Pure: `now` is never read; the caller passes the window.
 */

import type {
  EvidenceType,
  Opportunity,
  Outcome,
  Person,
  PersonStatus,
  Referral,
} from "../domain/types.ts";
import {
  computeJudgeCalibration,
  type JudgeCalibrationRun,
  judgeWeightOptions,
} from "../judges/reliability.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import type { JudgeReliabilitySpec, ReferralSignalSpec } from "../models/spec.ts";
import {
  computeAllReferralSignals,
  displayReferralSignal,
  type ReferralSignalResult,
} from "../scoring/referralSignal.ts";
import { referralStrength } from "../scoring/referralStrength.ts";

const DAY = 86_400_000;
const BASE_MS = Date.UTC(2026, 0, 1);

export interface TimelinePerson {
  id: string;
  name: string;
  affiliation: string;
  status: PersonStatus;
  isPersona: boolean;
  referred: boolean;
  judged: boolean;
}

export interface TimelineEdge {
  id: string;
  judgeId: string;
  candidateId: string;
  strength: number;
  evidenceType: EvidenceType;
  createdAt: string;
}

export interface TimelineJudgeState {
  id: string;
  reliability: number;
  rawReliability: number | null;
  bias: number;
  evaluatedCount: number;
  meanSquaredError: number | null;
  /** Ĝ_u from `run.scout`. Separate from reliability; never added to p̂. */
  scoutGain: number;
  /** Scout-eligible rows that produced Ĝ_u. 0 means prior (missing slope ≠ 0 ability). */
  scoutEvaluatedCount: number;
}

export interface TimelineSignalState {
  id: string;
  /** Unrounded 100 · S_v under equal judge weights. */
  v0: number;
  /** Unrounded 100 · S_v under the weights at this T. */
  v2: number;
  v0Display: number;
  v2Display: number;
}

export interface TimelineEvent {
  referralId: string;
  judgeId: string;
  candidateId: string;
  prediction: number;
  truth: number;
  error: number;
  signedError: number;
  evaluatedAt: string;
}

export interface TimelineFrame {
  t: string;
  day: number;
  evaluatedReferrals: number;
  judgesWithEvidence: number;
  newlyScored: TimelineEvent[];
  judges: TimelineJudgeState[];
  signals: TimelineSignalState[];
}

export interface JudgeTimeline {
  specVersion: string;
  referralSpecVersion: string;
  /** Copied from the spec. Production 3.0.0 stays false. */
  scoutHook: boolean;
  observationWindowDays: number;
  shrinkage: number;
  learningRate: number;
  errorScale: number;
  priorReliability: number;
  applyBiasCorrection: boolean;
  start: string;
  end: string;
  people: TimelinePerson[];
  edges: TimelineEdge[];
  personas: string[];
  frames: TimelineFrame[];
}

export interface TimelineInput {
  people: readonly Person[];
  referrals: readonly Referral[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  start: Date;
  end: Date;
  /** Extra ticks between event dates; default 7. */
  stepDays?: number;
  spec?: JudgeReliabilitySpec;
  referralSpec?: ReferralSignalSpec;
  /** Highlighted people for the explainer; defaults to none. */
  personaIds?: readonly string[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayIndex(d: Date): number {
  return Math.round((d.getTime() - BASE_MS) / DAY);
}

function eventOf(p: JudgeCalibrationRun["predictions"][number]): TimelineEvent {
  return {
    referralId: p.referralId,
    judgeId: p.judgeId,
    candidateId: p.candidateId,
    prediction: p.prediction,
    truth: p.truth,
    error: p.error,
    signedError: p.signedError,
    evaluatedAt: p.evaluatedAt.toISOString(),
  };
}

function enumerateTimes(start: Date, end: Date, stepDays: number, extras: Date[]): Date[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!(endMs >= startMs)) {
    throw new Error("buildJudgeTimeline: end must be on or after start");
  }
  const seen = new Set<number>();
  const out: Date[] = [];
  const add = (ms: number): void => {
    const clamped = Math.min(endMs, Math.max(startMs, ms));
    if (seen.has(clamped)) return;
    seen.add(clamped);
    out.push(new Date(clamped));
  };
  add(startMs);
  add(endMs);
  const step = Math.max(1, stepDays) * DAY;
  for (let ms = startMs + step; ms < endMs; ms += step) add(ms);
  for (const extra of extras) add(extra.getTime());
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

function peopleView(
  people: readonly Person[],
  referrals: readonly Referral[],
  personaIds: readonly string[],
): TimelinePerson[] {
  const persona = new Set<string>(personaIds);
  const judged = new Set<string>();
  const referred = new Set<string>();
  for (const r of referrals) {
    judged.add(r.referrerId);
    referred.add(r.candidateId);
  }
  return [...people]
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    .map((p) => ({
      id: p.id,
      name: p.name,
      affiliation: p.affiliation ?? "",
      status: p.status,
      isPersona: persona.has(p.id),
      referred: referred.has(p.id),
      judged: judged.has(p.id),
    }));
}

function edgeView(
  referrals: readonly Referral[],
  referralSpec: ReferralSignalSpec,
): TimelineEdge[] {
  return [...referrals]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((r) => ({
      id: r.id,
      judgeId: r.referrerId,
      candidateId: r.candidateId,
      strength: referralStrength(r, referralSpec),
      evidenceType: r.evidenceType,
      createdAt: r.createdAt.toISOString(),
    }));
}

function judgeStates(run: JudgeCalibrationRun): TimelineJudgeState[] {
  return [...run.estimates.values()]
    .sort((a, b) => a.judgeId.localeCompare(b.judgeId))
    .map((e) => {
      const scout = run.scout.get(e.judgeId);
      return {
        id: e.judgeId,
        reliability: e.reliability,
        rawReliability: e.rawReliability,
        bias: e.bias,
        evaluatedCount: e.evaluatedCount,
        meanSquaredError: e.meanSquaredError,
        scoutGain: scout?.gain ?? 0,
        scoutEvaluatedCount: scout?.evaluatedCount ?? 0,
      };
    });
}

function signalStates(
  people: readonly Person[],
  v0: ReadonlyMap<string, ReferralSignalResult>,
  v2: ReadonlyMap<string, ReferralSignalResult>,
): TimelineSignalState[] {
  return people.map((p) => {
    const a = v0.get(p.id);
    const b = v2.get(p.id);
    const v0Raw = a?.signal ?? 0;
    const v2Raw = b?.signal ?? 0;
    return {
      id: p.id,
      v0: v0Raw,
      v2: v2Raw,
      v0Display: a ? displayReferralSignal(a) : 0,
      v2Display: b ? displayReferralSignal(b) : 0,
    };
  });
}

/**
 * Walk T from `start` to `end`, scoring the same referrals against outcomes
 * that have become visible. Frames land on a regular step and on every
 * prediction's first eligible instant so a playback does not skip a weight update.
 */
export function buildJudgeTimeline(input: TimelineInput): JudgeTimeline {
  const spec = input.spec ?? CURRENT_SPECS.judge_reliability;
  const referralSpec = input.referralSpec ?? CURRENT_SPECS.referral_signal;
  const stepDays = input.stepDays ?? 7;
  const opportunities = input.opportunities ?? [];

  const v0 = computeAllReferralSignals(input.people, input.referrals, { spec: referralSpec });
  const finalRun = computeJudgeCalibration({
    people: input.people,
    referrals: input.referrals,
    outcomes: input.outcomes,
    opportunities,
    now: input.end,
    spec,
    referralSpec,
  });
  const eventDates = finalRun.predictions.map((p) => p.evaluatedAt);
  const times = enumerateTimes(input.start, input.end, stepDays, eventDates);

  let prevScored = new Set<string>();
  const frames: TimelineFrame[] = [];
  for (const now of times) {
    const run = computeJudgeCalibration({
      people: input.people,
      referrals: input.referrals,
      outcomes: input.outcomes,
      opportunities,
      now,
      spec,
      referralSpec,
    });
    const newlyScored = run.predictions.filter((p) => !prevScored.has(p.referralId)).map(eventOf);
    prevScored = new Set(run.predictions.map((p) => p.referralId));
    const weighted = computeAllReferralSignals(input.people, input.referrals, {
      spec: referralSpec,
      ...judgeWeightOptions(run),
    });
    frames.push({
      t: isoDay(now),
      day: dayIndex(now),
      evaluatedReferrals: run.options.evaluatedReferrals,
      judgesWithEvidence: run.options.judgesWithEvidence,
      newlyScored,
      judges: judgeStates(run),
      signals: signalStates(input.people, v0, weighted),
    });
  }

  return {
    specVersion: spec.version,
    referralSpecVersion: referralSpec.version,
    scoutHook: spec.scoutHook === true,
    observationWindowDays: spec.observationWindowDays,
    shrinkage: spec.shrinkage,
    learningRate: spec.learningRate,
    errorScale: spec.errorScale,
    priorReliability: spec.priorReliability,
    applyBiasCorrection: spec.applyBiasCorrection,
    start: isoDay(input.start),
    end: isoDay(input.end),
    people: peopleView(input.people, input.referrals, input.personaIds ?? []),
    edges: edgeView(input.referrals, referralSpec),
    personas: [...(input.personaIds ?? [])],
    frames,
  };
}

/** Default window used by `bun run demo` and the interactive explainer. */
export const DEMO_TIMELINE_START = new Date("2026-06-01T00:00:00.000Z");
export const DEMO_TIMELINE_END = new Date("2026-12-31T00:00:00.000Z");
