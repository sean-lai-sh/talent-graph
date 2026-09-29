/**
 * Ladder placement, shared by the member referral step and (later) Arena.
 * One function turns a placement into weighted comparisons. Callers persist
 * with `loadState` / `saveState` and `addComparison`. There is no second
 * write path.
 *
 * Anchors are whoever `selectComparisons` pairs with the applicant inside
 * the referrer's pool. This file does not change that scoring.
 */

import { loadSpecs } from "../../../src/config.ts";
import { DIMENSION_PROMPTS } from "../../../src/domain/constants.ts";
import type { ComparisonOutcome, Dimension } from "../../../src/domain/types.ts";
import {
  computeCapabilityVectors,
  dimensionLabel,
} from "../../../src/inference/capabilityVector.ts";
import { selectComparisons } from "../../../src/inference/comparisonSelection.ts";
import { addComparison } from "./engine.ts";
import { resolveMemberPersonId } from "./memberIdentity.ts";
import { NOT_LINKED_ERROR, NOT_YOUR_REFERRAL_ERROR } from "./memberReferral.ts";
import { clubToComparison, clubToPerson } from "./serialize.ts";
import type { AddComparisonInput, ClubPerson, ClubState } from "./types.ts";

export const LADDER_MAX_TRAITS = 3;
export const LADDER_MAX_ANCHORS = 5;
export const LADDER_MIN_ANCHORS = 2;

export const SIGN_IN_REQUIRED = "Sign in required.";
export const ANCHOR_NOT_OFFERED = "That person is not an anchor for this trait.";
export const TRAIT_ALREADY_PLACED = "This trait already has a placement.";
export const TRAIT_NOT_OFFERED = "This trait is not open for placement.";
export const LADDER_SKIP_NOTE = "Not enough people to compare yet. Your answers are saved.";

export type LadderAnchor = {
  id: string;
  name: string;
  relation: string;
};

export type LadderTraitView = {
  dimension: Dimension;
  label: string;
  prompt: string;
  anchors: LadderAnchor[];
  estimatedCount: number;
  thinCount: number;
};

export type LadderStepView =
  | { skipped: true; note: string; applicantName: string }
  | {
      skipped: false;
      applicantId: string;
      applicantName: string;
      traits: LadderTraitView[];
    };

export type LadderPlacement = { kind: "order"; order: readonly string[] } | { kind: "cant_place" };

export type LadderSession = { email: string };

export type LadderAccess = {
  session: LadderSession | null;
  /** Person ids this signed-in user has a memberReferrals row for. */
  ownedPersonIds: readonly string[];
  state: ClubState;
  personId: string;
};

export type LadderWrite =
  | { ok: true; state: ClubState }
  | { ok: false; error: string; state: ClubState };

type RankedAnchor = LadderAnchor & { estimated: boolean; theta: number | null };

function referredOn(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function relationLine(person: ClubPerson): string {
  const role = person.status === "member" ? "Member" : "Applicant";
  return `${role} - you referred - ${referredOn(person.createdAt)}`;
}

function traitDimensions(state: ClubState): Dimension[] {
  const dimensions: Dimension[] = [];
  for (const dimension of state.config.requiredDimensions) {
    if (dimensions.includes(dimension)) continue;
    dimensions.push(dimension);
    if (dimensions.length === LADDER_MAX_TRAITS) break;
  }
  return dimensions;
}

function referredPool(state: ClubState, referrerId: string, applicantId: string): string[] {
  const others: string[] = [];
  for (const referral of state.referrals) {
    if (referral.referrerId !== referrerId) continue;
    const id = referral.candidateId;
    if (id === applicantId || id === referrerId || others.includes(id)) continue;
    others.push(id);
  }
  return [applicantId, ...others];
}

function capabilityOf(state: ClubState) {
  return computeCapabilityVectors(
    state.people.map(clubToPerson),
    state.comparisons.map(clubToComparison),
    { spec: loadSpecs().bradley_terry },
  );
}

function partnerOf(
  proposal: { personAId: string; personBId: string },
  applicantId: string,
): string | null {
  if (proposal.personAId === applicantId) return proposal.personBId;
  if (proposal.personBId === applicantId) return proposal.personAId;
  return null;
}

/** Traits the referrer can place, strongest anchors first. Fewer than two anchors drops the trait. */
export function ladderTraits(
  state: ClubState,
  referrerId: string,
  applicantId: string,
): LadderTraitView[] {
  const people = new Map(state.people.map((person) => [person.id, person]));
  const pool = referredPool(state, referrerId, applicantId);
  const run = capabilityOf(state);
  const comparisons = state.comparisons.map(clubToComparison);
  const now = new Date(state.now);
  const traits: LadderTraitView[] = [];

  for (const dimension of traitDimensions(state)) {
    const proposals = selectComparisons(dimension, run, comparisons, {
      evaluatorId: referrerId,
      candidatePool: pool,
      now,
      limit: Math.max(pool.length * pool.length, 1),
    });
    const anchorIds: string[] = [];
    for (const proposal of proposals) {
      const partner = partnerOf(proposal, applicantId);
      if (!partner || anchorIds.includes(partner) || !people.has(partner)) continue;
      anchorIds.push(partner);
      if (anchorIds.length === LADDER_MAX_ANCHORS) break;
    }
    if (anchorIds.length < LADDER_MIN_ANCHORS) continue;

    const ranked: RankedAnchor[] = [];
    for (const id of anchorIds) {
      const person = people.get(id);
      if (!person) continue;
      const estimate = run.vectors.get(id)?.dimensions[dimension];
      const estimated = estimate?.state === "estimated";
      ranked.push({
        id,
        name: person.name,
        relation: relationLine(person),
        estimated,
        theta: estimate?.state === "estimated" ? estimate.theta : null,
      });
    }
    ranked.sort((a, b) => {
      if (a.estimated !== b.estimated) return a.estimated ? -1 : 1;
      if (a.theta !== null && b.theta !== null && a.theta !== b.theta) return b.theta - a.theta;
      return a.name.localeCompare(b.name);
    });

    traits.push({
      dimension,
      label: dimensionLabel(dimension),
      prompt: DIMENSION_PROMPTS[dimension],
      anchors: ranked.map(({ id, name, relation }) => ({ id, name, relation })),
      estimatedCount: ranked.filter((anchor) => anchor.estimated).length,
      thinCount: ranked.filter((anchor) => !anchor.estimated).length,
    });
  }
  return traits;
}

export function ladderWeight(anchorCount: number): number {
  return 1 / anchorCount;
}

function traitPlaced(
  state: ClubState,
  evaluatorId: string,
  applicantId: string,
  dimension: Dimension,
): boolean {
  return state.comparisons.some(
    (row) =>
      row.dimension === dimension &&
      row.evaluatorId === evaluatorId &&
      (row.personAId === applicantId || row.personBId === applicantId),
  );
}

/**
 * One comparison per offered anchor. The applicant is always person A.
 * Above an anchor is outcome "a". Below is "b". Can't place is
 * insufficient_observation. Weight is 1/N on every row.
 */
export function placementComparisons(input: {
  applicantId: string;
  evaluatorId: string;
  dimension: Dimension;
  anchorIds: readonly string[];
  placement: LadderPlacement;
}): { ok: true; rows: AddComparisonInput[] } | { ok: false; error: string } {
  const anchorIds = input.anchorIds;
  const weight = ladderWeight(anchorIds.length);
  if (input.placement.kind === "cant_place") {
    return {
      ok: true,
      rows: anchorIds.map((anchorId) => ({
        personAId: input.applicantId,
        personBId: anchorId,
        dimension: input.dimension,
        outcome: "insufficient_observation" as ComparisonOutcome,
        confidence: null,
        weight,
        evaluatorId: input.evaluatorId,
      })),
    };
  }

  const order = input.placement.order;
  const offered = new Set(anchorIds);
  const seen = new Set<string>();
  const anchorsInOrder: string[] = [];
  let applicantSeen = false;
  for (const id of order) {
    if (seen.has(id)) return { ok: false, error: ANCHOR_NOT_OFFERED };
    seen.add(id);
    if (id === input.applicantId) {
      applicantSeen = true;
      continue;
    }
    if (!offered.has(id)) return { ok: false, error: ANCHOR_NOT_OFFERED };
    anchorsInOrder.push(id);
  }
  if (!applicantSeen || anchorsInOrder.length !== offered.size) {
    return { ok: false, error: ANCHOR_NOT_OFFERED };
  }

  const index = new Map(order.map((id, position) => [id, position]));
  const applicantAt = index.get(input.applicantId);
  if (applicantAt === undefined) return { ok: false, error: ANCHOR_NOT_OFFERED };
  return {
    ok: true,
    rows: anchorIds.map((anchorId) => {
      const anchorAt = index.get(anchorId);
      const outcome: ComparisonOutcome =
        anchorAt !== undefined && applicantAt < anchorAt ? "a" : "b";
      return {
        personAId: input.applicantId,
        personBId: anchorId,
        dimension: input.dimension,
        outcome,
        confidence: null,
        weight,
        evaluatorId: input.evaluatorId,
      };
    }),
  };
}

function gate(
  input: LadderAccess,
): { ok: false; error: string } | { ok: true; referrerId: string; applicantName: string } {
  if (!input.session) return { ok: false, error: SIGN_IN_REQUIRED };
  if (!input.ownedPersonIds.includes(input.personId)) {
    return { ok: false, error: NOT_YOUR_REFERRAL_ERROR };
  }
  const link = resolveMemberPersonId(input.state, input.session.email);
  if (link.status !== "linked") return { ok: false, error: NOT_LINKED_ERROR };
  const applicant = input.state.people.find((person) => person.id === input.personId);
  if (!applicant) return { ok: false, error: NOT_YOUR_REFERRAL_ERROR };
  return { ok: true, referrerId: link.personId, applicantName: applicant.name };
}

export function openComparisonStep(
  input: LadderAccess,
): { ok: false; error: string } | { ok: true; view: LadderStepView } {
  const opened = gate(input);
  if (!opened.ok) return opened;
  const traits = ladderTraits(input.state, opened.referrerId, input.personId);
  if (traits.length === 0) {
    return {
      ok: true,
      view: { skipped: true, note: LADDER_SKIP_NOTE, applicantName: opened.applicantName },
    };
  }
  return {
    ok: true,
    view: {
      skipped: false,
      applicantId: input.personId,
      applicantName: opened.applicantName,
      traits,
    },
  };
}

/**
 * Recomputes the offered anchors, rejects anything that was not offered,
 * and rejects a second placement on the same trait. Writes through
 * `addComparison` only. The caller saves the returned state.
 */
export function commitLadderPlacement(
  input: LadderAccess & { dimension: Dimension; placement: LadderPlacement },
): LadderWrite {
  const opened = gate(input);
  if (!opened.ok) return { ok: false, error: opened.error, state: input.state };
  const traits = ladderTraits(input.state, opened.referrerId, input.personId);
  const trait = traits.find((row) => row.dimension === input.dimension);
  if (!trait) return { ok: false, error: TRAIT_NOT_OFFERED, state: input.state };
  if (traitPlaced(input.state, opened.referrerId, input.personId, input.dimension)) {
    return { ok: false, error: TRAIT_ALREADY_PLACED, state: input.state };
  }
  const built = placementComparisons({
    applicantId: input.personId,
    evaluatorId: opened.referrerId,
    dimension: input.dimension,
    anchorIds: trait.anchors.map((anchor) => anchor.id),
    placement: input.placement,
  });
  if (!built.ok) return { ok: false, error: built.error, state: input.state };

  let next = input.state;
  for (const row of built.rows) {
    const result = addComparison(next, row);
    if (result.error !== undefined) {
      return { ok: false, error: result.error, state: input.state };
    }
    next = result.state;
  }
  return { ok: true, state: next };
}
