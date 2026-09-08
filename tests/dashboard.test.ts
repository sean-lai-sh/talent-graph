import { describe, expect, test } from "bun:test";
import { buildDashboard, formatDashboard, personReport } from "../src/analysis/dashboard.ts";
import { underRecognitionGaps } from "../src/analysis/underRecognition.ts";
import { BANNED_LANGUAGE } from "../src/domain/constants.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";
import { PERSONA_IDS } from "../src/seed/personas.ts";

const data = generateSeed();
const signals = computeAllReferralSignals(data.people, data.referrals);
const capRun = computeCapabilityVectors(data.people, data.comparisons);
const gaps = underRecognitionGaps(signals, capRun);
const summary = buildDashboard(data, signals, capRun, gaps);

describe("buildDashboard", () => {
  test("counts match the dataset", () => {
    expect(summary.people).toBe(data.people.length);
    expect(summary.candidates + summary.members + summary.archived).toBe(data.people.length);
    expect(summary.referrals).toBe(data.referrals.length);
    expect(summary.comparisons).toBe(data.comparisons.length);
    expect(summary.evaluations).toBe(data.evaluations.length);
    expect(summary.recentReferrals).toHaveLength(10);
    for (let i = 1; i < summary.recentReferrals.length; i++) {
      expect(
        (summary.recentReferrals[i - 1]?.createdAt.getTime() ?? 0) >=
          (summary.recentReferrals[i]?.createdAt.getTime() ?? 0),
      ).toBe(true);
    }
  });

  test("topCapability contains only estimated entries, sorted desc", () => {
    expect(summary.topCapability.length).toBeGreaterThan(0);
    expect(summary.topCapability.length).toBeLessThanOrEqual(10);
    for (const c of summary.topCapability) {
      const e = capRun.vectors.get(c.personId)?.dimensions[c.dimension];
      expect(e?.state).toBe("estimated");
    }
    for (let i = 1; i < summary.topCapability.length; i++) {
      expect(
        (summary.topCapability[i - 1]?.percentile ?? 0) >=
          (summary.topCapability[i]?.percentile ?? 0),
      ).toBe(true);
    }
  });

  test("topReferralSignal excludes people with no referrals", () => {
    for (const r of summary.topReferralSignal) expect(r.incomingCount).toBeGreaterThan(0);
    // Dev's single 5/5/5 firsthand referral is a perfect S_v: the top of the
    // Referral Signal list is exactly the persona that V1 cannot estimate.
    const top3 = summary.topReferralSignal.slice(0, 3).map((r) => r.personId);
    expect(top3).toContain("p-dev");
    expect(top3).toContain("p-alice");
  });

  test("Cleo appears in underRecognized", () => {
    expect(summary.underRecognized.some((u) => u.personId === "p-cleo")).toBe(true);
    expect(summary.underRecognized.length).toBeLessThanOrEqual(10);
  });
});

describe("personReport", () => {
  test("contains the approved headings and never banned language", () => {
    for (const id of PERSONA_IDS) {
      const text = personReport(id, data, signals, capRun, gaps);
      expect(text).toContain("Referral Signal");
      expect(text).toContain("Relative Capability Estimate");
      for (const banned of BANNED_LANGUAGE) expect(text).not.toContain(banned);
    }
    const dash = formatDashboard(summary, data.people);
    for (const banned of BANNED_LANGUAGE) expect(dash).not.toContain(banned);
  });

  test("Fox's generativity line says Insufficient Evidence; problem solving is estimated", () => {
    const text = personReport("p-fox", data, signals, capRun, gaps);
    const gen = text.split("\n").find((l) => l.startsWith("Generativity"));
    const ps = text.split("\n").find((l) => l.startsWith("Problem solving"));
    expect(gen).toContain("Insufficient Evidence");
    expect(ps).toMatch(/\d+(st|nd|rd|th) percentile/);
  });

  test("Cleo's report flags the interesting signal; Bram's does not", () => {
    expect(personReport("p-cleo", data, signals, capRun, gaps)).toContain("Interesting signal");
    expect(personReport("p-bram", data, signals, capRun, gaps)).not.toContain("Interesting signal");
  });

  test("Dev: one strong referral, everything else insufficient", () => {
    const text = personReport("p-dev", data, signals, capRun, gaps);
    expect(text).toContain("1 incoming referral ·");
    expect(text.match(/Insufficient Evidence/g)?.length).toBe(7);
  });

  test("unknown person degrades gracefully", () => {
    const text = personReport("nobody", data, signals, capRun, gaps);
    expect(text).toContain("nobody");
    expect(text).toContain("(no referral data)");
  });
});
