import { describe, expect, test } from "bun:test";
import type { Person, Referral } from "../src/domain/types.ts";
import {
  buildReferralGraph,
  filterGraph,
  inDegree,
  neighbourhood,
  outDegree,
  referredBy,
  referrersOf,
  toEdgeList,
} from "../src/graph/referralGraph.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";

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

// a → b → c → d, a → c, e isolated
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

describe("referral graph", () => {
  test("degrees", () => {
    expect(outDegree(g, "a")).toBe(2);
    expect(inDegree(g, "a")).toBe(0);
    expect(inDegree(g, "c")).toBe(2);
    expect(outDegree(g, "e")).toBe(0);
    expect(inDegree(g, "missing")).toBe(0);
  });

  test("referrersOf / referredBy", () => {
    expect(referrersOf(g, "c").map((p) => p.id)).toEqual(["b", "a"]);
    expect(referredBy(g, "a").map((p) => p.id)).toEqual(["b", "c"]);
  });

  test("neighbourhood depth 1 vs 2", () => {
    const n1 = neighbourhood(g, "a", 1);
    expect(n1.people.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(n1.referrals.map((r) => r.id).sort()).toEqual(["a->b", "a->c", "b->c"]);

    const n2 = neighbourhood(g, "a", 2);
    expect(n2.people.map((p) => p.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(n2.referrals).toHaveLength(4);

    expect(neighbourhood(g, "e").people.map((p) => p.id)).toEqual(["e"]);
    expect(neighbourhood(g, "nope")).toEqual({ people: [], referrals: [] });
  });

  test("filter by status keeps only matching nodes and their edges", () => {
    const f = filterGraph(g, { status: ["candidate"] });
    expect([...f.nodes.keys()].sort()).toEqual(["b", "c", "d"]);
    expect(inDegree(f, "b")).toBe(0); // a was dropped
    expect(inDegree(f, "c")).toBe(1);
  });

  test("filter by evidence type and affiliation", () => {
    const f = filterGraph(g, { evidenceTypes: ["firsthand_work"] });
    expect(
      toEdgeList(f)
        .map((e) => `${e.source}->${e.target}`)
        .sort(),
    ).toEqual(["a->b", "a->c"]);

    const x = filterGraph(g, { affiliation: "X" });
    expect([...x.nodes.keys()].sort()).toEqual(["a", "b"]);
  });

  test("filter by minSignal uses supplied signals and refuses to compute them", () => {
    const signals = computeAllReferralSignals(people, referrals);
    const f = filterGraph(g, { minSignal: 60, signals });
    for (const id of f.nodes.keys()) {
      expect((signals.get(id)?.signal ?? 0) >= 60).toBe(true);
    }
    expect(() => filterGraph(g, { minSignal: 10 })).toThrow(/signals/);
  });

  test("edge weights equal referralStrength", () => {
    const edges = toEdgeList(g);
    expect(edges).toHaveLength(4);
    for (const e of edges) {
      const r = referrals.find((x) => x.referrerId === e.source && x.candidateId === e.target);
      expect(e.weight).toBe(referralStrength(r as Referral));
    }
  });

  test("referrals with unknown endpoints are dropped", () => {
    const h = buildReferralGraph(people, [...referrals, referral("ghost", "a")]);
    expect(inDegree(h, "a")).toBe(0);
  });
});
