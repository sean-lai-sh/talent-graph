/**
 * Club view over the algorithm core. No scoring lives here — this file
 * only serialises club state and calls `compute*` from `src/`.
 *
 * `/` and `/example` start from `generateSeed()` via `initialState()`.
 * `/club` persists domain inputs in Convex and calls the same helpers.
 * Persisted orgs use `emptyState()` / wall clock; example seed keeps EXAMPLE_T_*.
 */

import {
  mostUnderRecognized,
  underRecognitionGaps,
} from "../../../src/analysis/underRecognition.ts";
import { type LoadedSpecs, loadSpecs } from "../../../src/config.ts";
import { DIMENSION_PROMPTS, DIMENSIONS, PRODUCT_LANGUAGE } from "../../../src/domain/constants.ts";
import type {
  Comparison,
  ComparisonOutcome,
  Dimension,
  EvidenceType,
  PersonStatus,
  Referral,
  Scale5,
} from "../../../src/domain/types.ts";
import { validateComparison, validateReferral } from "../../../src/domain/validate.ts";
import {
  computeCapabilityVectors,
  dimensionLabel,
} from "../../../src/inference/capabilityVector.ts";
import { selectComparisons } from "../../../src/inference/comparisonSelection.ts";
import { computeJudgeCalibration, judgeWeightOptions } from "../../../src/judges/reliability.ts";
import {
  computeAllReferralSignals,
  displayReferralSignal,
  type ReferralSignalResult,
} from "../../../src/scoring/referralSignal.ts";
import { referralStrength } from "../../../src/scoring/referralStrength.ts";
import { generateSeed } from "../../../src/seed/generate.ts";
import { PERSONA_IDS } from "../../../src/seed/personas.ts";
import {
  clubToComparison,
  clubToOpportunity,
  clubToOutcome,
  clubToPerson,
  clubToReferral,
  comparisonToClub,
  EXAMPLE_T_END,
  EXAMPLE_T_START,
  evaluationToClub,
  opportunityToClub,
  outcomeToClub,
  personToClub,
  referralToClub,
  reviveState,
} from "./serialize.ts";
import type {
  ClubPerson,
  ClubReferral,
  ClubSnapshot,
  ClubState,
  ClubView,
  DimensionView,
  EngineResult,
  GapRow,
  GraphEdge,
  JudgeView,
  PersonView,
  ProposedView,
  TimelineFrame,
} from "./types.ts";

export { EXAMPLE_T_END, EXAMPLE_T_START } from "./serialize.ts";
export { PRODUCT_LANGUAGE };

/** Display integer, or null when there is no incoming referral (not a score of 0). */
function measuredSignal(result: ReferralSignalResult): number | null {
  if (result.incomingCount < 1) return null;
  return displayReferralSignal(result);
}

export const OWNER_EVALUATOR_ID = "example-admin";

export const PERSONA_NOTES: Readonly<Record<string, string>> = {
  "p-alice": "Strong, and the network already sees it.",
  "p-bram": "Well-connected. Loud is not the same as best.",
  "p-cleo": "Quiet. Almost nobody has heard of her.",
  "p-dev": "One person is certain. Nobody else has looked.",
  "p-ember": "Knows everyone; many lukewarm referrals.",
  "p-fox": "Formidable on hard problems; never observed leading.",
};

const personaSet = new Set<string>(PERSONA_IDS);

function nameOf(state: ClubState, id: string): string {
  return state.people.find((p) => p.id === id)?.name ?? id;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Wall clock for persisted orgs. Example seed keeps EXAMPLE_T_* via initialState(). */
export function wallClockNow(): string {
  return new Date().toISOString();
}

/** Empty persisted-org inputs. Clock is wall time, not EXAMPLE_T_END. */
export function emptyState(now: string = wallClockNow()): ClubState {
  return {
    people: [],
    referrals: [],
    comparisons: [],
    evaluations: [],
    outcomes: [],
    opportunities: [],
    snapshots: [],
    now,
  };
}

export function initialState(): ClubState {
  const data = generateSeed();
  return {
    people: data.people.map(personToClub),
    referrals: data.referrals.map(referralToClub),
    comparisons: data.comparisons.map(comparisonToClub),
    evaluations: data.evaluations.map(evaluationToClub),
    outcomes: data.outcomes.map(outcomeToClub),
    opportunities: data.opportunities.map(opportunityToClub),
    snapshots: [],
    now: EXAMPLE_T_END,
  };
}

export function computeView(input: ClubState, specs: LoadedSpecs = loadSpecs()): ClubView {
  const state = reviveState(input);
  const people = state.people.map(clubToPerson);
  const referrals = state.referrals.map(clubToReferral);
  const comparisons = state.comparisons.map(clubToComparison);
  const outcomes = state.outcomes.map(clubToOutcome);
  const opportunities = state.opportunities.map(clubToOpportunity);
  const now = new Date(state.now);

  const v0 = computeAllReferralSignals(people, referrals, { spec: specs.referral_signal });
  const cap = computeCapabilityVectors(people, comparisons, { spec: specs.bradley_terry });
  const cal = computeJudgeCalibration({
    people,
    referrals,
    outcomes,
    opportunities,
    now,
    spec: specs.judge_reliability,
    referralSpec: specs.referral_signal,
  });
  const v2 = computeAllReferralSignals(people, referrals, {
    spec: specs.referral_signal,
    ...judgeWeightOptions(cal),
  });
  const gaps = underRecognitionGaps(v2, cap);
  const interesting = mostUnderRecognized(gaps, 8);

  const windowMs = specs.judge_reliability.observationWindowDays * 86_400_000;
  const earliestReferral = Math.min(...referrals.map((r) => r.createdAt.getTime()));
  const windowOpen = now.getTime() - earliestReferral >= windowMs;

  const measured = [...v2.values()].filter((r) => r.incomingCount >= 1);
  const personaSignals = measured.filter((r) => personaSet.has(r.personId));
  const otherSignals = measured
    .filter((r) => !personaSet.has(r.personId))
    .sort((a, b) => b.signal - a.signal || (a.personId < b.personId ? -1 : 1))
    .slice(0, 6);
  const topReferral = [...personaSignals, ...otherSignals]
    .sort((a, b) => b.signal - a.signal || (a.personId < b.personId ? -1 : 1))
    .map((r) => ({
      personId: r.personId,
      name: nameOf(state, r.personId),
      status: people.find((p) => p.id === r.personId)?.status ?? "candidate",
      signal: displayReferralSignal(r),
      incomingCount: r.incomingCount,
      firsthandCount: r.firsthandCount,
      persona: personaSet.has(r.personId),
    }));

  const topCapability = DIMENSIONS.flatMap((dimension) =>
    people
      .map((p) => {
        const est = cap.vectors.get(p.id)?.dimensions[dimension];
        if (est?.state !== "estimated") return null;
        return {
          personId: p.id,
          name: p.name,
          dimension,
          dimensionLabel: dimensionLabel(dimension),
          percentile: est.percentile,
          comparisonCount: est.comparisonCount,
          poolSize: est.poolSize,
          poolConfidence: est.poolConfidence,
          persona: personaSet.has(p.id),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
  )
    .sort((a, b) => {
      const rank = (c: typeof a) =>
        c.poolConfidence === "high" ? 2 : c.poolConfidence === "medium" ? 1 : 0;
      return (
        rank(b) - rank(a) || b.percentile - a.percentile || b.comparisonCount - a.comparisonCount
      );
    })
    .slice(0, 10);

  const underRecognized: GapRow[] = interesting.map((g) => ({
    personId: g.personId,
    name: nameOf(state, g.personId),
    dimension: g.dimension,
    dimensionLabel: dimensionLabel(g.dimension),
    gap: g.gap,
    capabilityPercentile: g.capabilityPercentile,
    referralPercentile: g.referralPercentile,
    tag: "exploratory",
  }));

  const personViews: PersonView[] = state.people.map((p) => {
    const s0 = v0.get(p.id);
    const s2 = v2.get(p.id);
    const vector = cap.vectors.get(p.id);
    const ownGaps = gaps.filter((g) => g.personId === p.id);
    const dimensions: DimensionView[] = DIMENSIONS.map((d) => {
      const e = vector?.dimensions[d];
      if (!e) {
        return {
          dimension: d,
          label: dimensionLabel(d),
          prompt: DIMENSION_PROMPTS[d],
          state: "insufficient_evidence",
          percentile: null,
          comparisonCount: 0,
          opponentCount: 0,
          poolSize: null,
          poolConfidence: null,
          reason: "no comparison data",
        };
      }
      if (e.state === "estimated") {
        return {
          dimension: d,
          label: dimensionLabel(d),
          prompt: DIMENSION_PROMPTS[d],
          state: "estimated",
          percentile: e.percentile,
          comparisonCount: e.comparisonCount,
          opponentCount: e.opponentCount,
          poolSize: e.poolSize,
          poolConfidence: e.poolConfidence,
          reason: null,
        };
      }
      return {
        dimension: d,
        label: dimensionLabel(d),
        prompt: DIMENSION_PROMPTS[d],
        state: "insufficient_evidence",
        percentile: null,
        comparisonCount: e.comparisonCount,
        opponentCount: e.opponentCount,
        poolSize: null,
        poolConfidence: null,
        reason: e.reason,
      };
    });
    return {
      id: p.id,
      name: p.name,
      bio: p.bio ?? "",
      affiliation: p.affiliation ?? "",
      status: p.status,
      note: PERSONA_NOTES[p.id] ?? null,
      persona: personaSet.has(p.id),
      v0Signal: s0 ? measuredSignal(s0) : null,
      v2Signal: s2 ? measuredSignal(s2) : null,
      incomingCount: s2?.incomingCount ?? 0,
      firsthandCount: s2?.firsthandCount ?? 0,
      strongest: s2?.strongest ?? null,
      contributing: (s2?.contributing ?? []).map((c) => ({
        referralId: c.referral.id,
        referrerId: c.referral.referrerId,
        referrerName: nameOf(state, c.referral.referrerId),
        strength: c.strength,
        conviction: c.referral.conviction,
        confidence: c.referral.confidence,
        relationshipDepth: c.referral.relationshipDepth,
        evidenceType: c.referral.evidenceType,
        evidenceText: c.referral.evidenceText,
        multiplier: c.breakdown.multiplier,
        reliability: c.judge.reliability,
        bias: c.judge.bias,
      })),
      dimensions,
      gaps: ownGaps.map((g) => ({
        personId: g.personId,
        name: p.name,
        dimension: g.dimension,
        dimensionLabel: dimensionLabel(g.dimension),
        gap: g.gap,
        capabilityPercentile: g.capabilityPercentile,
        referralPercentile: g.referralPercentile,
        tag: "exploratory" as const,
      })),
    };
  });

  const judges: JudgeView[] = toJudgeViews(state, cal);

  const edges: GraphEdge[] = [];
  for (const r of referrals) {
    const scored = v2.get(r.candidateId)?.contributing.find((c) => c.referral.id === r.id);
    edges.push({
      from: r.referrerId,
      to: r.candidateId,
      strength: scored?.breakdown.strength ?? referralStrength(r, specs.referral_signal),
      contributing: scored !== undefined,
    });
  }

  const proposals: ProposedView[] = DIMENSIONS.flatMap((dimension) =>
    selectComparisons(dimension, cap, comparisons, {
      now,
      limit: 4,
      evaluatorId: OWNER_EVALUATOR_ID,
    }),
  )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 1)
    .map((p) => ({
      personAId: p.personAId,
      personBId: p.personBId,
      personAName: nameOf(state, p.personAId),
      personBName: nameOf(state, p.personBId),
      dimension: p.dimension,
      dimensionLabel: dimensionLabel(p.dimension),
      prompt: p.prompt,
      priority: p.priority,
    }));

  return {
    counts: {
      people: state.people.length,
      candidates: state.people.filter((p) => p.status === "candidate").length,
      members: state.people.filter((p) => p.status === "member").length,
      archived: state.people.filter((p) => p.status === "archived").length,
      referrals: state.referrals.length,
      comparisons: state.comparisons.length,
    },
    now: state.now,
    windowOpen,
    observationWindowDays: specs.judge_reliability.observationWindowDays,
    evaluatedReferrals: cal.options.evaluatedReferrals,
    judgesWithEvidence: cal.options.judgesWithEvidence,
    topReferral,
    topCapability,
    underRecognized,
    people: personViews.sort(
      (a, b) => Number(b.persona) - Number(a.persona) || a.name.localeCompare(b.name),
    ),
    judges,
    graph: {
      nodes: state.people.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        persona: personaSet.has(p.id),
        v2Signal: (() => {
          const sig = v2.get(p.id);
          return sig ? measuredSignal(sig) : null;
        })(),
        incomingCount: v2.get(p.id)?.incomingCount ?? 0,
      })),
      edges,
    },
    nextCompare: proposals[0] ?? null,
    snapshots: state.snapshots,
    timeline: liveJudgeTimeline(state, people, referrals, outcomes, opportunities, v0, specs),
  };
}

function monthlySteps(startIso: string, endIso: string): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const steps: string[] = [];
  const seen = new Set<string>();
  const push = (iso: string) => {
    if (seen.has(iso)) return;
    seen.add(iso);
    steps.push(iso);
  };
  push(start.toISOString());
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getTime() >= start.getTime()) push(cursor.toISOString());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  push(end.toISOString());
  return steps;
}

/** First of each month from EXAMPLE_T_START through EXAMPLE_T_END, plus the end T. */
export function exampleTimeSteps(): string[] {
  return monthlySteps(EXAMPLE_T_START, EXAMPLE_T_END);
}

/** Seed personas keep the public example calendar; Convex orgs do not. */
export function usesExampleCalendar(state: ClubState): boolean {
  return state.people.some((p) => personaSet.has(p.id));
}

function eventTimes(state: ClubState): number[] {
  const raw: Array<string | null | undefined> = [
    state.now,
    ...state.people.flatMap((p) => [p.createdAt, p.updatedAt]),
    ...state.referrals.flatMap((r) => [r.createdAt, r.updatedAt]),
    ...state.comparisons.map((c) => c.createdAt),
    ...state.evaluations.flatMap((e) => [e.createdAt, e.updatedAt]),
    ...state.outcomes.flatMap((o) => [o.observedAt, o.createdAt]),
    ...state.opportunities.flatMap((o) => [o.startedAt, o.endedAt, o.createdAt]),
    ...state.snapshots.map((s) => s.createdAt),
  ];
  return raw
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time));
}

/** Monthly ticks from earliest org event through `state.now`. */
export function orgTimeSteps(state: ClubState): string[] {
  const times = eventTimes(state);
  const end = times.length > 0 ? Math.max(...times) : Date.parse(state.now);
  const start = times.length > 0 ? Math.min(...times) : end;
  return monthlySteps(new Date(start).toISOString(), new Date(end).toISOString());
}

function timeStepsFor(state: ClubState): string[] {
  return usesExampleCalendar(state) ? exampleTimeSteps() : orgTimeSteps(state);
}

function toJudgeViews(
  state: ClubState,
  cal: ReturnType<typeof computeJudgeCalibration>,
): JudgeView[] {
  return [...cal.estimates.values()]
    .filter((e) => e.evaluatedCount > 0)
    .sort((a, b) => b.reliability - a.reliability || (a.judgeId < b.judgeId ? -1 : 1))
    .map((e) => ({
      judgeId: e.judgeId,
      name: nameOf(state, e.judgeId),
      reliability: e.reliability,
      bias: e.bias,
      meanSquaredError: e.meanSquaredError,
      evaluatedCount: e.evaluatedCount,
    }));
}

/** Monthly frames: computeJudgeCalibration on the in-memory club at each T. */
function liveJudgeTimeline(
  state: ClubState,
  people: ReturnType<typeof clubToPerson>[],
  referrals: ReturnType<typeof clubToReferral>[],
  outcomes: ReturnType<typeof clubToOutcome>[],
  opportunities: ReturnType<typeof clubToOpportunity>[],
  v0: ReturnType<typeof computeAllReferralSignals>,
  specs: LoadedSpecs,
): TimelineFrame[] {
  const windowMs = specs.judge_reliability.observationWindowDays * 86_400_000;
  const earliestReferral = Math.min(...referrals.map((r) => r.createdAt.getTime()));
  const personaIds = state.people.filter((p) => personaSet.has(p.id));
  const tracked =
    personaIds.length > 0 ? personaIds : state.people.filter((p) => p.status !== "archived");

  return timeStepsFor(state).map((isoNow) => {
    const now = new Date(isoNow);
    const cal = computeJudgeCalibration({
      people,
      referrals,
      outcomes,
      opportunities,
      now,
      spec: specs.judge_reliability,
      referralSpec: specs.referral_signal,
    });
    const v2 = computeAllReferralSignals(people, referrals, {
      spec: specs.referral_signal,
      ...judgeWeightOptions(cal),
    });
    return {
      now: isoNow,
      evaluatedReferrals: cal.options.evaluatedReferrals,
      judgesWithEvidence: cal.options.judgesWithEvidence,
      windowOpen: now.getTime() - earliestReferral >= windowMs,
      judges: toJudgeViews(state, cal),
      personas: tracked.map((p) => {
        const s0 = v0.get(p.id);
        const s2 = v2.get(p.id);
        return {
          id: p.id,
          name: p.name,
          v0: s0 ? measuredSignal(s0) : null,
          v2: s2 ? measuredSignal(s2) : null,
        };
      }),
    };
  });
}

export function loadClub(): EngineResult {
  const state = initialState();
  return { state, view: computeView(state) };
}

export function resetClub(): EngineResult {
  return loadClub();
}

export function setNow(state: ClubState, now: string): EngineResult {
  const next = reviveState(state);
  next.now = now;
  return { state: next, view: computeView(next) };
}

export function addPerson(
  state: ClubState,
  input: {
    name: string;
    bio?: string;
    affiliation?: string;
    status?: PersonStatus;
  },
): EngineResult {
  const next = reviveState(state);
  const name = input.name.trim();
  if (!name) return { state: next, view: computeView(next), error: "name required" };
  const person: ClubPerson = {
    id: nextId("p"),
    name,
    status: input.status ?? "candidate",
    createdAt: next.now,
    updatedAt: next.now,
  };
  if (input.bio !== undefined && input.bio.trim() !== "") person.bio = input.bio.trim();
  if (input.affiliation !== undefined && input.affiliation.trim() !== "") {
    person.affiliation = input.affiliation.trim();
  }
  next.people.push(person);
  return { state: next, view: computeView(next) };
}

export function setStatus(state: ClubState, personId: string, status: PersonStatus): EngineResult {
  const next = reviveState(state);
  const person = next.people.find((p) => p.id === personId);
  if (!person) return { state: next, view: computeView(next), error: "unknown person" };
  person.status = status;
  person.updatedAt = next.now;
  const view = computeView(next);
  const dossier = view.people.find((p) => p.id === personId);
  const snapshot: ClubSnapshot = {
    id: `snap:${personId}:${status}:${next.now}`,
    personId,
    personName: person.name,
    decision: status,
    values: {
      referralSignal: dossier?.v2Signal ?? null,
      incomingCount: dossier?.incomingCount ?? 0,
    },
    createdAt: next.now,
  };
  next.snapshots = [snapshot, ...next.snapshots].slice(0, 20);
  return { state: next, view: computeView(next) };
}

export function addReferral(
  state: ClubState,
  input: {
    referrerId: string;
    candidateId: string;
    conviction: Scale5;
    confidence: Scale5;
    relationshipDepth: Scale5;
    evidenceType: EvidenceType;
    evidenceText: string;
  },
): EngineResult {
  const next = reviveState(state);
  const referral: Referral = {
    id: nextId("ref"),
    referrerId: input.referrerId,
    candidateId: input.candidateId,
    conviction: input.conviction,
    confidence: input.confidence,
    relationshipDepth: input.relationshipDepth,
    evidenceType: input.evidenceType,
    evidenceText: input.evidenceText,
    createdAt: new Date(next.now),
    updatedAt: new Date(next.now),
  };
  const check = validateReferral(referral, next.referrals.map(clubToReferral));
  if (!check.ok) return { state: next, view: computeView(next), error: check.errors.join("; ") };
  next.referrals.push(referralToClub(referral));
  return { state: next, view: computeView(next) };
}

export function meddleReferral(
  state: ClubState,
  referralId: string,
  patch: { conviction: Scale5; confidence: Scale5; relationshipDepth: Scale5 },
): EngineResult {
  const next = reviveState(state);
  const row = next.referrals.find((r) => r.id === referralId);
  if (!row) return { state: next, view: computeView(next), error: "unknown referral" };
  // Keep updatedAt === createdAt so V2 still treats this as the original
  // frozen prediction — the slider is a counterfactual, not an edit.
  const trial: ClubReferral = { ...row, ...patch };
  const check = validateReferral(
    clubToReferral(trial),
    next.referrals.filter((r) => r.id !== referralId).map(clubToReferral),
  );
  if (!check.ok) return { state: next, view: computeView(next), error: check.errors.join("; ") };
  row.conviction = patch.conviction;
  row.confidence = patch.confidence;
  row.relationshipDepth = patch.relationshipDepth;
  return { state: next, view: computeView(next) };
}

export function addComparison(
  state: ClubState,
  input: {
    personAId: string;
    personBId: string;
    dimension: Dimension;
    outcome: ComparisonOutcome;
  },
): EngineResult {
  const next = reviveState(state);
  const winnerId =
    input.outcome === "a" ? input.personAId : input.outcome === "b" ? input.personBId : null;
  const comparison: Comparison = {
    id: nextId("cmp"),
    evaluatorId: OWNER_EVALUATOR_ID,
    personAId: input.personAId,
    personBId: input.personBId,
    dimension: input.dimension,
    outcome: input.outcome,
    winnerId,
    confidence: 4,
    createdAt: new Date(next.now),
  };
  const check = validateComparison(comparison);
  if (!check.ok) return { state: next, view: computeView(next), error: check.errors.join("; ") };
  next.comparisons.push(comparisonToClub(comparison));
  return { state: next, view: computeView(next) };
}
