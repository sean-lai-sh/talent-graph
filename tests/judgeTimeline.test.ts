import { describe, expect, test } from "bun:test";
import {
  buildJudgeTimeline,
  DEMO_TIMELINE_END,
  DEMO_TIMELINE_START,
} from "../src/analysis/judgeTimeline.ts";
import { BANNED_LANGUAGE } from "../src/domain/constants.ts";
import { computeJudgeCalibration, judgeWeightOptions } from "../src/judges/reliability.ts";
import { computeAllReferralSignals, displayReferralSignal } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";
import { PERSONA_IDS } from "../src/seed/personas.ts";

const data = generateSeed();
const timeline = buildJudgeTimeline({
  people: data.people,
  referrals: data.referrals,
  outcomes: data.outcomes,
  opportunities: data.opportunities,
  start: DEMO_TIMELINE_START,
  end: DEMO_TIMELINE_END,
  personaIds: PERSONA_IDS,
});

describe("buildJudgeTimeline", () => {
  test("first frame has no scored referrals and V2 equals V0", () => {
    const first = timeline.frames[0];
    expect(first).toBeDefined();
    expect(first?.t).toBe("2026-06-01");
    expect(first?.evaluatedReferrals).toBe(0);
    expect(first?.judgesWithEvidence).toBe(0);
    expect(first?.newlyScored).toEqual([]);
    for (const j of first?.judges ?? []) {
      expect(j.reliability).toBe(1);
      expect(j.evaluatedCount).toBe(0);
      expect(j.rawReliability).toBeNull();
    }
    for (const s of first?.signals ?? []) {
      expect(s.v2).toBe(s.v0);
      expect(s.v2Display).toBe(s.v0Display);
    }
  });

  test("last frame matches a direct calibration at T = 2026-12-31", () => {
    const last = timeline.frames[timeline.frames.length - 1];
    expect(last?.t).toBe("2026-12-31");
    const run = computeJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: DEMO_TIMELINE_END,
    });
    const v0 = computeAllReferralSignals(data.people, data.referrals);
    const v2 = computeAllReferralSignals(data.people, data.referrals, judgeWeightOptions(run));
    expect(last?.evaluatedReferrals).toBe(run.options.evaluatedReferrals);
    expect(last?.judgesWithEvidence).toBe(run.options.judgesWithEvidence);
    expect(last?.evaluatedReferrals).toBe(27);
    for (const id of PERSONA_IDS) {
      const signal = last?.signals.find((s) => s.id === id);
      const a = v0.get(id);
      const b = v2.get(id);
      expect(signal).toBeDefined();
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (!signal || !a || !b) continue;
      expect(signal.v0Display).toBe(displayReferralSignal(a));
      expect(signal.v2Display).toBe(displayReferralSignal(b));
    }
    const bram = last?.signals.find((s) => s.id === "p-bram");
    expect(bram?.v0Display).toBe(77);
    // V2 display moved 62 → 64: Phase E3 reshapes Cleo/Bram residuals (low-then-compound
    // vs high-flat) so the residual labels — and therefore p̂ of shared referrers —
    // shift. evaluatedReferrals stays 27; V0 is unchanged (forecastKind is not in R_uv).
    expect(bram?.v2Display).toBe(64);
  });

  test("evaluated referral count is non-decreasing and hits every scoring instant", () => {
    let prev = 0;
    const seen = new Set<string>();
    for (const frame of timeline.frames) {
      expect(frame.evaluatedReferrals).toBeGreaterThanOrEqual(prev);
      prev = frame.evaluatedReferrals;
      for (const event of frame.newlyScored) {
        expect(seen.has(event.referralId)).toBe(false);
        seen.add(event.referralId);
        expect(event.evaluatedAt.slice(0, 10) <= frame.t).toBe(true);
      }
    }
    expect(seen.size).toBe(prev);
    expect(prev).toBeGreaterThan(0);
  });

  test("marks the six personas and keeps the graph of referrals", () => {
    expect(timeline.personas).toEqual([...PERSONA_IDS]);
    expect(timeline.edges).toHaveLength(data.referrals.length);
    expect(timeline.people).toHaveLength(data.people.length);
    const flagged = timeline.people.filter((p) => p.isPersona).map((p) => p.id);
    expect(flagged.sort()).toEqual([...PERSONA_IDS].sort());
    expect(timeline.observationWindowDays).toBe(180);
    expect(timeline.priorReliability).toBe(1);
  });

  test("uses no banned language in the serialised payload", () => {
    const text = JSON.stringify(timeline);
    for (const phrase of BANNED_LANGUAGE) {
      expect(text.includes(phrase)).toBe(false);
    }
  });
});
