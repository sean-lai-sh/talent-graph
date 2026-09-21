/**
 * Seed-wide golden for the V0/V2 Referral Signal numbers (issue #56, T1).
 *
 * Two surfaces are pinned, both driven off the deterministic seed:
 *   1. `computeAllReferralSignals(generateSeed())` — the raw, unrounded signal
 *      per person, keyed by person id.
 *   2. `computeView(initialState())` — the Club engine's displayed
 *      `v0Signal` / `v2Signal` per person and `referrals[].strength` per
 *      referral id, keyed by id so ordering is never implicit.
 *
 * The fixture stores numbers exactly as `JSON.stringify` writes them (full
 * double precision, no rounding). The comparison is exact — a canonical
 * re-serialization of the fixture, string-compared and deep-compared, never
 * approximate — so a one-ULP change to any number fails here first. Later
 * tickets in #56 assert against this same file.
 *
 * REGENERATE: only when a number is *meant* to change, and never as a reflex.
 *   REGENERATE_REFERRAL_GOLDEN=1 bun test tests/referralGolden.test.ts && bun run format
 * then read the diff line by line before committing it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeView, initialState } from "../apps/club/lib/engine.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "referral-golden.json");

/** Sorted-key object so the fixture's ordering is explicit and stable. */
function byKey<T>(entries: Array<[string, T]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    out[k] = v;
  }
  return out;
}

function buildGolden() {
  const seed = generateSeed();
  const signals = computeAllReferralSignals(seed.people, seed.referrals);
  const state = initialState();
  const view = computeView(state);

  return {
    // Recorded so the golden is reproducible: the engine clock is fixed.
    now: state.now,
    counts: {
      people: seed.people.length,
      referrals: seed.referrals.length,
      viewPeople: view.people.length,
    },
    // computeAllReferralSignals(seed), keyed by person id.
    signals: byKey(
      [...signals.entries()].map(([id, r]) => [
        id,
        {
          signal: r.signal,
          s: r.s,
          incomingCount: r.incomingCount,
          usedCount: r.usedCount,
          firsthandCount: r.firsthandCount,
          strongest: r.strongest,
          evidenceTypes: r.evidenceTypes,
          specVersion: r.specVersion,
        },
      ]),
    ),
    // computeView(initialState()), keyed by person id then referral id.
    view: byKey(
      view.people.map((p) => [
        p.id,
        {
          v0Signal: p.v0Signal,
          v2Signal: p.v2Signal,
          incomingCount: p.incomingCount,
          strongest: p.strongest,
          referralStrength: byKey(p.referrals.map((r) => [r.referralId, r.strength])),
        },
      ]),
    ),
  };
}

/**
 * Canonical form used for the comparison: compact JSON with the keys in the
 * order `buildGolden` emits. `JSON.parse`/`JSON.stringify` round-trips a double
 * exactly, so re-serializing the fixture this way keeps the comparison exact
 * while leaving the committed file free to carry the repo's formatting.
 */
function canonical(golden: unknown): string {
  return JSON.stringify(golden);
}

function pretty(golden: unknown): string {
  return `${JSON.stringify(golden, null, 2)}\n`;
}

describe("referral golden: seed-wide signal numbers are pinned (V0 behaviour)", () => {
  const golden = buildGolden();

  if (process.env.REGENERATE_REFERRAL_GOLDEN === "1") {
    writeFileSync(FIXTURE, pretty(golden), "utf8");
  }

  test("the seed's Referral Signal numbers match tests/fixtures/referral-golden.json exactly", () => {
    const expected = canonical(JSON.parse(readFileSync(FIXTURE, "utf8")));
    expect(canonical(golden)).toBe(expected);
  });

  test("the golden is a deep-equal match too, and covers every seed person", () => {
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const parsed = JSON.parse(canonical(golden));
    expect(parsed).toEqual(expected);
    expect(Object.keys(parsed.signals).length).toBe(parsed.counts.people);
    expect(Object.keys(parsed.view).length).toBe(parsed.counts.viewPeople);
    expect(parsed.now).toBe(expected.now);
  });

  test("missing stays missing: no incoming referrals means null, never 0", () => {
    for (const person of Object.values(golden.view)) {
      if (person.incomingCount === 0) {
        expect(person.v0Signal).toBeNull();
        expect(person.v2Signal).toBeNull();
      }
    }
  });
});
