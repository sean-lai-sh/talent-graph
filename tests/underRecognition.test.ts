import { describe, expect, test } from "bun:test";
import {
  mostOverRecognized,
  mostUnderRecognized,
  underRecognitionGaps,
} from "../src/analysis/underRecognition.ts";
import type { Comparison, Person, Referral } from "../src/domain/types.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let n = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function referral(to: string, conviction: 1 | 2 | 3 | 4 | 5): Referral {
  n++;
  return {
    id: `r-${n}`,
    referrerId: `ref-${n}`,
    candidateId: to,
    conviction,
    confidence: conviction,
    relationshipDepth: conviction,
    evidenceType: "firsthand_work",
    evidenceText: "seen",
    createdAt: T0,
    updatedAt: T0,
  };
}

function win(w: string, l: string): Comparison {
  n++;
  return {
    id: `c-${n}`,
    evaluatorId: "judge",
    personAId: w,
    personBId: l,
    dimension: "problem_solving",
    outcome: "a",
    winnerId: w,
    confidence: null,
    createdAt: T0,
  };
}

// Fixture: C (Cleo-shape) wins everything but has a weak referral; B
// (Bram-shape) has a strong referral but loses; Z has no referral at all;
// Q has referrals but only one comparison.
const ids = ["B", "C", "M", "Z", "Q"];
const people = ids.map(person);
const referrals = [referral("B", 5), referral("C", 1), referral("M", 3), referral("Q", 4)];
const comparisons = [
  ...Array.from({ length: 4 }, () => win("C", "B")),
  ...Array.from({ length: 4 }, () => win("C", "M")),
  ...Array.from({ length: 4 }, () => win("M", "B")),
  ...Array.from({ length: 4 }, () => win("C", "Z")),
  ...Array.from({ length: 4 }, () => win("Z", "B")),
  win("Q", "B"),
];
const signals = computeAllReferralSignals(people, referrals);
const capRun = computeCapabilityVectors(people, comparisons);
const gaps = underRecognitionGaps(signals, capRun);

describe("underRecognitionGaps", () => {
  test("Candidate-C shape ⇒ large positive gap; B shape ⇒ negative", () => {
    const c = gaps.find((g) => g.personId === "C");
    const b = gaps.find((g) => g.personId === "B");
    expect(c?.gap).toBeGreaterThan(50);
    expect(c?.capabilityPercentile).toBe(100);
    expect(c?.referralPercentile).toBe(0);
    expect(b?.gap).toBeLessThan(-50);
    expect(c?.tag).toBe("exploratory");
    expect(c?.note).toContain("Exploratory diagnostic");
    expect(c?.dimension).toBe("problem_solving");
  });

  test("zero referrals ⇒ no entry, not +100", () => {
    expect(capRun.vectors.get("Z")?.dimensions.problem_solving.state).toBe("estimated");
    expect(gaps.some((g) => g.personId === "Z")).toBe(false);
  });

  test("insufficient evidence on a dimension ⇒ no entry for that dimension", () => {
    expect(capRun.vectors.get("Q")?.dimensions.problem_solving.state).toBe("insufficient_evidence");
    expect(gaps.some((g) => g.personId === "Q")).toBe(false);
    // and no other dimension has any comparisons at all
    expect(gaps.every((g) => g.dimension === "problem_solving")).toBe(true);
  });

  test("minComparisons option filters further", () => {
    expect(underRecognitionGaps(signals, capRun, { minComparisons: 9 })).toHaveLength(2);
  });

  test("most under / over recognised ordering and limit", () => {
    expect(mostUnderRecognized(gaps, 1)[0]?.personId).toBe("C");
    expect(mostOverRecognized(gaps, 1)[0]?.personId).toBe("B");
    expect(mostUnderRecognized(gaps, 2)).toHaveLength(2);
  });

  test("seed: Cleo is among the most under-recognised on problem_solving", () => {
    const data = generateSeed();
    const s = computeAllReferralSignals(data.people, data.referrals);
    const cr = computeCapabilityVectors(data.people, data.comparisons);
    const g = underRecognitionGaps(s, cr);
    const top = mostUnderRecognized(g, 5);
    expect(top.some((x) => x.personId === "p-cleo" && x.dimension === "problem_solving")).toBe(
      true,
    );
    expect(g.every((x) => x.tag === "exploratory")).toBe(true);
  });
});
