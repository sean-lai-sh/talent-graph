import { describe, expect, test } from "bun:test";
import { runCapabilityVectors, runReferralSignals } from "../src/modelRun.ts";
import { REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import { createPredictionSnapshot } from "../src/models/snapshot.ts";
import { generateSeed } from "../src/seed/generate.ts";

const NOW = new Date("2026-05-01T00:00:00Z");
const data = generateSeed();

describe("createPredictionSnapshot", () => {
  test("freezes the numbers a decision was made on", () => {
    const signals = runReferralSignals(data.people, data.referrals, NOW);
    const caps = runCapabilityVectors(data.people, data.comparisons, NOW);
    const cleo = caps.outputs.vectors.get("p-cleo")?.dimensions.problem_solving;
    const values = {
      referralSignal: signals.outputs.get("p-cleo")?.signal ?? null,
      "problem_solving.percentile": cleo?.state === "estimated" ? cleo.percentile : null,
    };
    const snap = createPredictionSnapshot({
      personId: "p-cleo",
      modelRunIds: [signals.id, caps.id],
      values,
      decision: "invite to interview",
      now: NOW,
    });

    // Re-run with a different spec: the snapshot does not move.
    const later = runReferralSignals(data.people, data.referrals, NOW, {
      spec: {
        ...REFERRAL_SIGNAL_V0_1_0,
        version: "0.2.0",
        weights: { conviction: 0.2, confidence: 0.3, relationshipDepth: 0.5 },
      },
    });
    expect(later.outputs.get("p-cleo")?.signal).not.toBe(values.referralSignal);
    expect(snap.values.referralSignal).toBe(values.referralSignal);
    expect(snap.modelRunIds).toEqual([signals.id, caps.id]);
    expect(snap.decision).toBe("invite to interview");
    expect(snap.createdAt).toBe(NOW);
    expect(snap.id.startsWith("snap:p-cleo:")).toBe(true);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.values)).toBe(true);
  });

  test("copies values so later mutation of the input does not leak in", () => {
    const values: Record<string, number | null> = { x: 1 };
    const snap = createPredictionSnapshot({ personId: "p", modelRunIds: ["r"], values, now: NOW });
    values.x = 99;
    expect(snap.values.x).toBe(1);
    expect(snap.decision).toBeNull();
  });

  test("requires at least one model run id", () => {
    expect(() =>
      createPredictionSnapshot({ personId: "p", modelRunIds: [], values: {}, now: NOW }),
    ).toThrow();
  });
});
