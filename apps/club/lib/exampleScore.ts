/**
 * Scores the public `/demo` fixture. Server and tests only.
 * The client renders `exampleBoard()`; it does not import this module.
 */

import {
  EXAMPLE_COMPARISONS,
  EXAMPLE_PEOPLE,
  EXAMPLE_REFERRALS,
} from "../fixtures/example-data.ts";
import { computeView, EXAMPLE_REQUIRED_DIMENSIONS, EXAMPLE_T_END } from "./engine.ts";
import type { ClubState, EngineResult } from "./types.ts";

/** Fixture rows as club inputs. No computed signal is attached here. */
export function exampleInputs(): ClubState {
  return {
    people: EXAMPLE_PEOPLE.map((person) => ({ ...person })),
    referrals: EXAMPLE_REFERRALS.map((referral) => ({ ...referral })),
    calls: [],
    comparisons: EXAMPLE_COMPARISONS.map((comparison) => ({ ...comparison })),
    evaluations: [],
    outcomes: [],
    opportunities: [],
    snapshots: [],
    feedbackRequests: [],
    config: { requiredDimensions: [...EXAMPLE_REQUIRED_DIMENSIONS] },
    now: EXAMPLE_T_END,
  };
}

/** One pass of the real scoring engine over `exampleInputs()`. */
export function exampleBoard(): EngineResult {
  const state = exampleInputs();
  return { state, view: computeView(state) };
}
