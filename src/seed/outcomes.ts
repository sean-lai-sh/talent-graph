/**
 * Synthetic longitudinal records for the seed: opportunities and outcomes
 * observed ~200–300 days after the base date, so the V2 judge calibration has
 * something to score in tests and the demo.
 *
 * Outcomes are driven by a hidden "true contribution" per person that the
 * generator derives from the same hidden abilities that drive comparisons,
 * plus an opportunity boost (so the residual correction has work to do) and
 * noise. The hidden values never leave this module.
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

function date(offsetDays: number): Date {
  return new Date(BASE_DATE + offsetDays * DAY);
}

function pad(n: number): string {
  return n.toString().padStart(3, "0");
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
  return { opportunities, outcomes };
}
