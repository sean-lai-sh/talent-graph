/**
 * Synthetic longitudinal records for the seed: opportunities and outcomes
 * observed ~200–300 days after the base date, so the V2 judge calibration has
 * something to score in tests and the demo.
 *
 * Outcomes are driven by a hidden "true contribution" per person that the
 * generator derives from the same hidden abilities that drive comparisons,
 * plus an opportunity boost (so the residual correction has work to do) and
 * noise. The hidden values never leave this module.
 *
 * After the random draw, `overlaySlopedPersonas` reshapes Cleo and Bram so
 * the documented demo window has a rising residual (Cleo) and a high, flat
 * residual (Bram). Presentation only — nothing here writes into scoring.
 */

import type { Opportunity, Outcome, Person } from "../domain/types.ts";
import { gaussian, int, mulberry32, pick, type Rng } from "./prng.ts";

export interface SeedOutcomeOptions {
  seed?: number;
  /** People who get at least one outcome (default: everyone). */
  people: readonly Person[];
  /**
   * Hidden contribution per person in roughly [−2, 3]; the generator adds
   * opportunity boosts and noise. Callers inside the seed derive this from the
   * hidden abilities; tests may pass anything.
   */
  contribution: ReadonlyMap<string, number>;
  /** Fraction of people who receive an opportunity (default 0.4). */
  opportunityRate?: number;
  /** Fraction of people with an outcome (default 0.7). */
  outcomeRate?: number;
}

export interface SeedLongitudinal {
  opportunities: Opportunity[];
  outcomes: Outcome[];
}

const BASE_DATE = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;
const OPPORTUNITY_KINDS = ["fellowship", "grant", "introduction", "residency"];
const OUTCOME_KINDS = ["shipped_project", "peer_impact"];

/**
 * Demo window for sloped seed personas. t0 (day 200) is when early outcomes
 * exist; background rows are pinned there so the cohort is already rankable.
 * t1 is t0 + 90 days, inside the seed observation span (~200–300 days).
 * Callers should pass these as increasing times to `residualSlope` /
 * `contributionTrajectory`.
 */
export const SEED_TRAJECTORY_T0 = new Date(BASE_DATE + 200 * DAY);
export const SEED_TRAJECTORY_T1 = new Date(BASE_DATE + 290 * DAY);

/** |ΔR*| at or below this is "flat" for the high-intercept persona (Bram). */
export const SEED_FLAT_SLOPE_TOLERANCE = 0.05;

const CLEO_ID = "p-cleo";
const BRAM_ID = "p-bram";
/** Quiet-start kind, shared with Bram so t0 is rankable. */
const EARLY_KIND = "shipped_project";
/** Cleo's later compounding is a different kind so Bram keeps the top rank. */
const COMPOUND_KIND = "peer_impact";
/** Below the random shipped_project floor so Cleo's t0 residual is low. */
const CLEO_EARLY_VALUE = -3;
/** High later peer_impact so Cleo's mean residual rises (compounds). */
const CLEO_LATE_VALUE = 6;
/** High intercept; stays the top shipped_project value across the window. */
const BRAM_VALUE = 2;

function date(offsetDays: number): Date {
  return new Date(BASE_DATE + offsetDays * DAY);
}

function pad(n: number): string {
  return n.toString().padStart(3, "0");
}

function nextSerial(items: readonly { id: string }[], prefix: string): number {
  let max = 0;
  for (const item of items) {
    const match = /^(\d+)$/.exec(item.id.slice(prefix.length));
    if (item.id.startsWith(prefix) && match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function pushOutcome(
  outcomes: Outcome[],
  personId: string,
  kind: string,
  value: number,
  offsetDays: number,
): void {
  const n = nextSerial(outcomes, "out-");
  outcomes.push({
    id: `out-${pad(n)}`,
    personId,
    opportunityId: null,
    kind,
    value,
    observedAt: date(offsetDays),
    createdAt: date(offsetDays),
  });
}

/**
 * The demo window should change for one reason: Cleo's later compounding.
 * Everything else is pinned at t0 so Bram's intercept stays high and flat
 * (`|ΔR*| ≤ SEED_FLAT_SLOPE_TOLERANCE`) as the cohort is already complete.
 * Does not add people — extra labels would inflate V2 evaluated-referral counts.
 */
function anchorBackgroundOutcomesAtT0(outcomes: Outcome[]): void {
  const t0 = SEED_TRAJECTORY_T0.getTime();
  const t1 = SEED_TRAJECTORY_T1.getTime();
  for (const row of outcomes) {
    const isCleoCompound =
      row.personId === CLEO_ID && row.kind === COMPOUND_KIND && row.observedAt.getTime() === t1;
    if (isCleoCompound) continue;
    if (row.observedAt.getTime() > t0) {
      row.observedAt = date(200);
      row.createdAt = date(200);
    }
  }
}

/**
 * Cleo: low residual at t0, compounds via a later high `peer_impact`.
 * Bram: high intercept, flat slope (|ΔR*| ≤ `SEED_FLAT_SLOPE_TOLERANCE`).
 * Cleo's seeded opportunities are dropped so she is not in Bram's
 * opportunity bucket — otherwise her rise moves his E[R|O] by ~0.05.
 */
function overlaySlopedPersonas(
  people: readonly Person[],
  opportunities: Opportunity[],
  outcomes: Outcome[],
): void {
  const ids = new Set(people.map((p) => p.id));
  if (!ids.has(CLEO_ID) && !ids.has(BRAM_ID)) return;

  for (let i = outcomes.length - 1; i >= 0; i--) {
    const row = outcomes[i];
    if (row && (row.personId === CLEO_ID || row.personId === BRAM_ID)) outcomes.splice(i, 1);
  }
  for (let i = opportunities.length - 1; i >= 0; i--) {
    if (opportunities[i]?.personId === CLEO_ID) opportunities.splice(i, 1);
  }

  if (ids.has(CLEO_ID)) {
    pushOutcome(outcomes, CLEO_ID, EARLY_KIND, CLEO_EARLY_VALUE, 200);
    pushOutcome(outcomes, CLEO_ID, COMPOUND_KIND, CLEO_LATE_VALUE, 290);
  }
  if (ids.has(BRAM_ID)) {
    pushOutcome(outcomes, BRAM_ID, EARLY_KIND, BRAM_VALUE, 200);
  }
  anchorBackgroundOutcomesAtT0(outcomes);
}

export function generateLongitudinal(opts: SeedOutcomeOptions): SeedLongitudinal {
  const rng: Rng = mulberry32((opts.seed ?? 42) ^ 0x5eed);
  const opportunityRate = opts.opportunityRate ?? 0.4;
  const outcomeRate = opts.outcomeRate ?? 0.7;
  const opportunities: Opportunity[] = [];
  const outcomes: Outcome[] = [];
  let no = 0;
  let nr = 0;

  for (const person of opts.people) {
    const base = opts.contribution.get(person.id) ?? 0;
    let boost = 0;
    if (rng() < opportunityRate) {
      const count = rng() < 0.3 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        no++;
        const started = int(rng, 60, 150);
        opportunities.push({
          id: `opp-${pad(no)}`,
          personId: person.id,
          kind: pick(rng, OPPORTUNITY_KINDS),
          description: "Seeded opportunity.",
          startedAt: date(started),
          endedAt: rng() < 0.5 ? null : date(started + int(rng, 30, 120)),
          createdAt: date(started),
        });
        boost += 0.6;
      }
    }
    if (rng() < outcomeRate) {
      nr++;
      const observed = int(rng, 200, 300);
      // Contribution plus the lift the opportunity itself gave, plus noise.
      const value = base + boost + gaussian(rng) * 0.5;
      outcomes.push({
        id: `out-${pad(nr)}`,
        personId: person.id,
        opportunityId: null,
        kind: pick(rng, OUTCOME_KINDS),
        value: Math.round(value * 100) / 100,
        observedAt: date(observed),
        createdAt: date(observed),
      });
    }
  }
  overlaySlopedPersonas(opts.people, opportunities, outcomes);
  return { opportunities, outcomes };
}
