import { describe, expect, test } from "bun:test";
import {
  buildReviewQueue,
  groupReviewQueue,
  REVIEW_BUCKET_COPY,
  REVIEW_BUCKET_ORDER,
  type ReviewBucket,
} from "../src/analysis/reviewQueue.ts";
import { underRecognitionGaps } from "../src/analysis/underRecognition.ts";
import { BANNED_LANGUAGE, DIMENSIONS } from "../src/domain/constants.ts";
import type { Comparison, Person, Referral } from "../src/domain/types.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let seq = 0;

function person(id: string, status: Person["status"] = "candidate"): Person {
  return { id, name: id, status, createdAt: T0, updatedAt: T0 };
}
function referral(from: string, to: string, conviction: 1 | 2 | 3 | 4 | 5 = 4): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: from,
    candidateId: to,
    conviction,
    confidence: conviction,
    relationshipDepth: conviction,
    evidenceType: "firsthand_work",
    evidenceText: "Seen it.",
    createdAt: T0,
    updatedAt: T0,
  };
}
function win(
  winner: string,
  loser: string,
  dimension = DIMENSIONS[0] as Comparison["dimension"],
): Comparison {
  seq++;
  return {
    id: `c-${seq}`,
    evaluatorId: "judge",
    personAId: winner,
    personBId: loser,
    dimension,
    outcome: "a",
    winnerId: winner,
    confidence: null,
    createdAt: new Date(T0.getTime() + seq * 1000),
  };
}

function queueFor(people: Person[], referrals: Referral[], comparisons: Comparison[]) {
  const signals = computeAllReferralSignals(people, referrals);
  const capRun = computeCapabilityVectors(people, comparisons);
  const gaps = underRecognitionGaps(signals, capRun);
  return buildReviewQueue({ people, signals, capRun, gaps });
}

describe("reviewQueue: bucket precedence on fixtures", () => {
  const judges = ["j1", "j2", "j3", "j4"].map((id) => person(id, "member"));

  test("no evidence, no referrals, referred-not-compared", () => {
    const people = [...judges, person("x"), person("y"), person("z"), person("w")];
    const referrals = [referral("j1", "z"), referral("j1", "w"), referral("j2", "w")];
    // y is compared (informative) but never referred; z referred, only skipped.
    const comparisons: Comparison[] = [
      win("y", "j1"),
      win("w", "j2"),
      { ...win("z", "j1"), outcome: "skip", winnerId: null },
    ];
    const q = queueFor(people, referrals, comparisons);
    const by = new Map(q.map((e) => [e.personId, e]));
    expect(by.get("x")?.bucket).toBe("no_evidence");
    expect(by.get("y")?.bucket).toBe("no_referrals");
    expect(by.get("z")?.bucket).toBe("referred_not_compared");
    expect(by.get("z")?.flags).toContain("single_source");
    expect(by.get("w")?.bucket).toBe("needs_more_compares");
    expect(q.some((e) => e.personId === "j1")).toBe(false);
  });

  test("single source beats ready-to-decide only when incoming is exactly one", () => {
    const people = [...judges, person("a"), person("b"), person("c")];
    const referrals = [referral("j1", "a"), referral("j1", "b"), referral("j2", "b")];
    const comparisons: Comparison[] = [];
    for (const [w, l] of [
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
      ["a", "b"],
      ["b", "c"],
      ["a", "c"],
    ] as const) {
      comparisons.push(win(w, l));
    }
    // Gaps are passed empty on purpose: this test isolates the incoming-count rule.
    const signals = computeAllReferralSignals(people, referrals);
    const capRun = computeCapabilityVectors(people, comparisons);
    const q = buildReviewQueue({ people, signals, capRun, gaps: [] });
    const by = new Map(q.map((e) => [e.personId, e]));
    expect(by.get("a")?.bucket).toBe("single_source");
    expect(by.get("a")?.estimatedDimensions).toBeGreaterThan(0);
    expect(by.get("b")?.bucket).toBe("ready_to_decide");
    expect(by.get("c")?.bucket).toBe("no_referrals");
  });

  test("statuses default to candidates only; members appear when asked", () => {
    const people = [person("m", "member"), person("c")];
    const signals = computeAllReferralSignals(people, []);
    const capRun = computeCapabilityVectors(people, []);
    const gaps = underRecognitionGaps(signals, capRun);
    expect(buildReviewQueue({ people, signals, capRun, gaps }).map((e) => e.personId)).toEqual([
      "c",
    ]);
    expect(
      buildReviewQueue({ people, signals, capRun, gaps, statuses: ["member"] }).map(
        (e) => e.personId,
      ),
    ).toEqual(["m"]);
  });

  test("deterministic; grouped output follows REVIEW_BUCKET_ORDER and drops empty buckets", () => {
    const people = [...judges, person("x"), person("y")];
    const a = queueFor(people, [referral("j1", "y")], []);
    const b = queueFor(people, [referral("j1", "y")], []);
    expect(a).toEqual(b);
    const groups = groupReviewQueue(a);
    const seen = groups.map((g) => g.bucket);
    const order = seen.map((bk) => REVIEW_BUCKET_ORDER.indexOf(bk));
    expect([...order].sort((p, q) => p - q)).toEqual(order);
    for (const g of groups) expect(g.entries.length).toBeGreaterThan(0);
  });

  test("copy exists for every bucket and uses no banned language", () => {
    for (const bucket of REVIEW_BUCKET_ORDER) {
      const copy = REVIEW_BUCKET_COPY[bucket as ReviewBucket];
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      for (const phrase of BANNED_LANGUAGE) {
        expect(copy.label.includes(phrase)).toBe(false);
        expect(copy.description.includes(phrase)).toBe(false);
      }
    }
  });
});

describe("reviewQueue: seed pins", () => {
  const data = generateSeed();
  const signals = computeAllReferralSignals(data.people, data.referrals);
  const capRun = computeCapabilityVectors(data.people, data.comparisons);
  const gaps = underRecognitionGaps(signals, capRun);
  const q = buildReviewQueue({ people: data.people, signals, capRun, gaps });
  const by = new Map(q.map((e) => [e.personId, e]));
  const nameOf = (name: string) => data.people.find((p) => p.name === name)?.id ?? name;

  test("personas land where the MVP prompt says they should", () => {
    expect(by.get("p-cleo")?.bucket).toBe("under_recognized");
    expect(by.get("p-cleo")?.flags).toEqual(["under_recognized", "single_source"]);
    expect(by.get("p-dev")?.bucket).toBe("single_source");
    expect(by.get("p-dev")?.estimatedDimensions).toBe(0);
    expect(by.get("p-alice")?.bucket).toBe("ready_to_decide");
    expect(by.get("p-bram")?.bucket).toBe("ready_to_decide");
    expect(by.get("p-ember")?.bucket).toBe("under_recognized");
    expect(by.get("p-fox")?.bucket).toBe("under_recognized");
    expect(by.get(nameOf("Ife Doyle"))?.bucket).toBe("no_referrals");
  });

  test("members and archived people are not in the queue; under-recognized sorts by gap", () => {
    for (const p of data.people.filter((row) => row.status !== "candidate")) {
      expect(by.has(p.id)).toBe(false);
    }
    const under = q
      .filter((e) => e.bucket === "under_recognized")
      .map((e) => e.largestGap?.gap ?? 0);
    expect(under).toEqual([...under].sort((a, b) => b - a));
    expect(q[0]?.personId).toBe("p-cleo");
  });

  test("zero-incoming buckets never carry a referral count; reasons are non-empty", () => {
    for (const e of q) {
      expect(e.reasons.length).toBeGreaterThanOrEqual(2);
      if (e.bucket === "no_evidence" || e.bucket === "no_referrals") {
        expect(e.incomingCount).toBe(0);
      }
    }
  });
});
