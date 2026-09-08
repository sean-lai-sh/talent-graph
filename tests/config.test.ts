import { describe, expect, test } from "bun:test";
import {
  bradleyTerrySpecFromConfig,
  DEFAULT_CONFIG,
  loadConfig,
  loadSpecs,
  referralSignalSpecFromConfig,
} from "../src/config.ts";
import { CURRENT_SPECS } from "../src/models/registry.ts";
import { validateSpec } from "../src/models/spec.ts";

describe("loadConfig", () => {
  test("defaults mirror the current specs", () => {
    expect(loadConfig({}, { warn: () => {} })).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({
      btRegularization: 0.1,
      btMaxIterations: 500,
      btTolerance: 1e-6,
      minComparisons: 3,
      minOpponents: 2,
      topKReferrals: 5,
    });
  });

  test("env overrides are parsed", () => {
    const cfg = loadConfig(
      {
        TG_BT_REGULARIZATION: "0.25",
        TG_BT_MAX_ITERATIONS: "100",
        TG_BT_TOLERANCE: "1e-4",
        TG_MIN_COMPARISONS: "4",
        TG_MIN_OPPONENTS: "3",
        TG_TOP_K_REFERRALS: "3",
      },
      { warn: () => {} },
    );
    expect(cfg).toEqual({
      btRegularization: 0.25,
      btMaxIterations: 100,
      btTolerance: 1e-4,
      minComparisons: 4,
      minOpponents: 3,
      topKReferrals: 3,
    });
  });

  test("garbage falls back to the default with a warning", () => {
    const warnings: string[] = [];
    const cfg = loadConfig(
      {
        TG_BT_REGULARIZATION: "lots",
        TG_BT_MAX_ITERATIONS: "2.5",
        TG_MIN_COMPARISONS: "-1",
        TG_TOP_K_REFERRALS: "",
      },
      { warn: (m) => warnings.push(m) },
    );
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("TG_BT_REGULARIZATION");
  });

  test("a config equal to the registered spec yields the registered spec object", () => {
    expect(bradleyTerrySpecFromConfig(DEFAULT_CONFIG)).toBe(CURRENT_SPECS.bradley_terry);
    expect(referralSignalSpecFromConfig(DEFAULT_CONFIG)).toBe(CURRENT_SPECS.referral_signal);
  });

  test("an overriding config yields a +env tagged, still-valid spec", () => {
    const bt = bradleyTerrySpecFromConfig({ ...DEFAULT_CONFIG, btRegularization: 0.3 });
    expect(bt.version).toBe("1.0.0+env");
    expect(bt.regularization).toBe(0.3);
    expect(validateSpec(bt)).toEqual({ ok: true });

    const rs = referralSignalSpecFromConfig({ ...DEFAULT_CONFIG, topKReferrals: 3 });
    expect(rs.version).toBe("0.1.0+env");
    expect(rs.topK).toBe(3);
  });
});

describe("loadSpecs", () => {
  test("an empty env yields the registered current specs, untagged", () => {
    const specs = loadSpecs({}, { warn: () => {} });
    expect(specs.config).toEqual(DEFAULT_CONFIG);
    expect(specs.referral_signal).toBe(CURRENT_SPECS.referral_signal);
    expect(specs.bradley_terry).toBe(CURRENT_SPECS.bradley_terry);
  });

  test("TG_* overrides reach both specs and tag them +env", () => {
    const specs = loadSpecs(
      { TG_TOP_K_REFERRALS: "1", TG_BT_REGULARIZATION: "2" },
      { warn: () => {} },
    );
    expect(specs.referral_signal.topK).toBe(1);
    expect(specs.referral_signal.version).toBe("0.1.0+env");
    expect(specs.bradley_terry.regularization).toBe(2);
    expect(specs.bradley_terry.version).toBe("1.0.0+env");
    expect(validateSpec(specs.referral_signal)).toEqual({ ok: true });
    expect(validateSpec(specs.bradley_terry)).toEqual({ ok: true });
  });
});
