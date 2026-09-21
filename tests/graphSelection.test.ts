/**
 * `selectBySignal` — score-based sub-graph selection (#56 T3).
 *
 * Was `filterGraph(g, { minSignal, signals })` in `src/graph/`. It moved to
 * `src/analysis/` so the graph module stays zero-dependency, and `signals`
 * became a required parameter, which retires the runtime throw.
 */

import { describe, expect, test } from "bun:test";
import { selectBySignal } from "../src/analysis/graphSelection.ts";
import type { Person, Referral } from "../src/domain/types.ts";
import { buildReferralGraph } from "../src/graph/referralGraph.ts";
import {
  computeAllReferralSignals,
  type ReferralSignalResult,
} from "../src/scoring/referralSignal.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");

function person(id: string, overrides: Partial<Person> = {}): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0, ...overrides };
}

function referral(from: string, to: string, overrides: Partial<Referral> = {}): Referral {
  return {
    id: `${from}->${to}`,
    referrerId: from,
    candidateId: to,
    conviction: 4,
    confidence: 3,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "Saw it happen.",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

// Same 5-node fixture as tests/graph.test.ts: a → b → c → d, a → c, e isolated.
const people = [
  person("a", { status: "member", affiliation: "X" }),
  person("b", { affiliation: "X" }),
  person("c", { affiliation: "Y" }),
  person("d"),
  person("e", { status: "archived" }),
];
const referrals = [
  referral("a", "b"),
  referral("b", "c", { evidenceType: "reputation" }),
  referral("c", "d", { evidenceType: "artifact" }),
  referral("a", "c", { conviction: 5 }),
];
const g = buildReferralGraph(people, referrals);

describe("selectBySignal", () => {
  test("keeps only people whose supplied signal clears the threshold", () => {
    const signals = computeAllReferralSignals(people, referrals);
    const f = selectBySignal(g, signals, 60);
    expect(f.nodes.size).toBeGreaterThan(0);
    for (const id of f.nodes.keys()) {
      const s = signals.get(id) as ReferralSignalResult;
      expect(s.signal >= 60).toBe(true);
    }
    // Everyone below the threshold really is gone.
    for (const [id, s] of signals) {
      if (s.signal < 60) expect(f.nodes.has(id)).toBe(false);
    }
  });

  test("edges survive only when both endpoints do, in input order", () => {
    const signals = computeAllReferralSignals(people, referrals);
    const f = selectBySignal(g, signals, 0);
    const edgeIds = [...f.out.values()].flat().map((r) => r.id);
    const kept = referrals.filter((r) => f.nodes.has(r.referrerId) && f.nodes.has(r.candidateId));
    expect(edgeIds.sort()).toEqual(kept.map((r) => r.id).sort());
    for (const list of f.out.values()) {
      const order = list.map((r) => referrals.findIndex((x) => x.id === r.id));
      expect(order).toEqual([...order].sort((x, y) => x - y));
    }
  });

  test("a person with no signal is excluded, never treated as a signal of 0", () => {
    const signals = new Map<string, ReferralSignalResult>();
    const withSignal = computeAllReferralSignals(people, referrals).get(
      "c",
    ) as ReferralSignalResult;
    signals.set("c", withSignal);
    const f = selectBySignal(g, signals, 0);
    // Threshold 0 admits every score there is, yet only the scored person is in.
    expect([...f.nodes.keys()]).toEqual(["c"]);
  });

  test("signals are a required argument, so there is nothing left to throw", () => {
    const signals = computeAllReferralSignals(people, referrals);
    expect(() => selectBySignal(g, signals, 10)).not.toThrow();
  });
});
