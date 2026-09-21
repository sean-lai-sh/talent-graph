/**
 * Provenance is structural, not conventional.
 *
 * TS types are not present at runtime, so what actually keeps a model honest
 * is this: for every registered model, and for every key of its options
 * object, perturbing that key moves `run.id` — unless the key is named in
 * `excludeFromProvenance`, in which case it must *not*. Forgetting to record
 * an option becomes a red test rather than a silent provenance hole.
 *
 * A model with no probe below fails the suite, so adding a model without
 * saying how to perturb its options is also a red test.
 */

import { describe, expect, test } from "bun:test";
import { runCapabilityVectors } from "../src/modelRun.ts";
import {
  type AnyModelDefinition,
  defineModel,
  MODELS,
  registeredModels,
  runModel,
} from "../src/models/define.ts";
import { bradleyTerryModel } from "../src/models/definitions/bradleyTerry.ts";
import { judgeReliabilityModel } from "../src/models/definitions/judgeReliability.ts";
import { referralSignalModel } from "../src/models/definitions/referralSignal.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  JUDGE_RELIABILITY_V2_0_0,
  REFERRAL_SIGNAL_V0_1_0,
} from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const T = new Date("2026-12-31T00:00:00.000Z");
const data = generateSeed();

/** A model defined *in this test file*: no file under src/models/ is edited. */
interface ProbeInput {
  n: number;
}
interface ProbeOptions {
  factor: number;
  /** Deliberately not recorded: a display label cannot move a number. */
  label: string;
}

const inTestModel = defineModel<"referral_signal", ProbeInput, ProbeOptions, number>({
  name: "defined_in_test_v0",
  kind: "referral_signal",
  legacyId: "referral_signal_v0",
  specOf: () => REFERRAL_SIGNAL_V0_1_0,
  inputsOf: (input) => ({ n: input.n }),
  resolveOptions: (spec, opts) => ({
    parameters: { spec, factor: opts.factor },
    upstream: [],
  }),
  excludeFromProvenance: ["label"],
  compute: (input, _spec, opts) => input.n * opts.factor,
});

/** One concrete call per model, plus how to perturb the awkward options. */
interface Probe {
  input: unknown;
  opts: Record<string, unknown>;
  now: Date;
  /** Perturbations the generic one cannot derive (specs, nested objects, runs). */
  perturb?: Record<string, (value: unknown) => unknown>;
}

const priorA = runCapabilityVectors(data.people, data.comparisons, NOW);
const priorB = runCapabilityVectors(data.people, data.comparisons, NOW, {
  bt: { regularization: 5 },
});

const PROBES: Record<string, Probe> = {
  referral_signal_v0: {
    input: { people: data.people, referrals: data.referrals },
    opts: {
      spec: REFERRAL_SIGNAL_V0_1_0,
      topK: 5,
      judgeReliability: new Map([["p-001", 0.5]]),
      judgeBias: new Map([["p-001", 0.1]]),
    },
    now: NOW,
    perturb: { spec: () => ({ ...REFERRAL_SIGNAL_V0_1_0, version: "0.1.1" }) },
  },
  bradley_terry_v1: {
    input: { people: data.people, comparisons: data.comparisons },
    opts: {
      spec: BRADLEY_TERRY_V1_0_0,
      minComparisons: 3,
      minOpponents: 2,
      tieHandling: "ignore",
      bt: { regularization: 0.2 },
      previous: priorA.outputs,
      previousRunId: priorA.id,
      anchorStrength: 1,
    },
    now: NOW,
    perturb: {
      spec: () => ({ ...BRADLEY_TERRY_V1_0_0, version: "1.0.1" }),
      tieHandling: () => "half",
      bt: () => ({ regularization: 0.4 }),
      previous: () => priorB.outputs,
    },
  },
  judge_reliability_v2: {
    input: {
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
    },
    opts: { now: T, spec: JUDGE_RELIABILITY_V2_0_0, referralSpec: REFERRAL_SIGNAL_V0_1_0 },
    now: T,
    perturb: {
      spec: () => ({ ...JUDGE_RELIABILITY_V2_0_0, version: "2.0.1" }),
      referralSpec: () => ({ ...REFERRAL_SIGNAL_V0_1_0, version: "0.1.1" }),
    },
  },
  defined_in_test_v0: {
    input: { n: 3 },
    opts: { factor: 2, label: "display only" },
    now: NOW,
  },
};

/**
 * A different value of the same shape. Objects have no safe generic
 * perturbation, so a probe must supply one — that is what forces whoever
 * adds an option to say what changing it means.
 */
function perturbValue(key: string, value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (typeof value === "string") return `${value}~`;
  if (value instanceof Date) return new Date(value.getTime() + 86_400_000);
  if (value instanceof Map) return new Map([...value, ["p-probe", 0.25]]);
  throw new Error(`no perturbation for option "${key}"; add one to its probe`);
}

function idFor(def: AnyModelDefinition, probe: Probe, opts: Record<string, unknown>): string {
  return runModel(def, probe.input, def.specOf(opts), opts, probe.now).id;
}

describe("every option moves the id", () => {
  test("every registered model has a probe", () => {
    const registered = registeredModels().map((d) => d.name);
    expect(registered.sort()).toEqual(Object.keys(PROBES).sort());
  });

  for (const def of registeredModels()) {
    test(`${def.name}: perturbing any recorded option changes run.id`, () => {
      const probe = PROBES[def.name] as Probe;
      const excluded = new Set(def.excludeFromProvenance ?? []);
      const baseline = idFor(def, probe, probe.opts);
      expect(idFor(def, probe, { ...probe.opts })).toBe(baseline);

      const keys = Object.keys(probe.opts);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const custom = probe.perturb?.[key];
        const value = custom ? custom(probe.opts[key]) : perturbValue(key, probe.opts[key]);
        const moved = idFor(def, probe, { ...probe.opts, [key]: value });
        if (excluded.has(key)) {
          expect(moved, `${def.name}.${key} is excluded from provenance`).toBe(baseline);
        } else {
          expect(moved, `${def.name}.${key} must move the run id`).not.toBe(baseline);
        }
      }
    });
  }
});

describe("a model defined outside src/models/", () => {
  test("registers and runs without editing any file under src/models/", () => {
    expect(MODELS.get("defined_in_test_v0")).toBe(inTestModel as unknown as AnyModelDefinition);
    const run = runModel(
      inTestModel,
      { n: 3 },
      REFERRAL_SIGNAL_V0_1_0,
      {
        factor: 2,
        label: "display only",
      },
      NOW,
    );
    expect(run.outputs).toBe(6);
    expect(run.modelVersion).toBe("0.1.0");
    expect(run.id).toMatch(/^referral_signal_v0@0\.1\.0:[0-9a-f]{12}:[0-9a-f]{8}$/);
    expect(run.createdAt).toEqual(NOW);
    expect(Object.keys(run.parameters).sort()).toEqual(["factor", "spec"]);
  });

  test("defining a second model under the same name is refused", () => {
    expect(() =>
      defineModel({
        name: "defined_in_test_v0",
        kind: "referral_signal",
        legacyId: "referral_signal_v0",
        specOf: () => REFERRAL_SIGNAL_V0_1_0,
        inputsOf: () => ({}),
        resolveOptions: (spec) => ({ parameters: { spec }, upstream: [] }),
        compute: () => 0,
      }),
    ).toThrow(/already registered/);
  });
});

describe("the three shipped models are registered", () => {
  test("each keeps its legacy id segment", () => {
    expect(referralSignalModel.legacyId).toBe("referral_signal_v0");
    expect(bradleyTerryModel.legacyId).toBe("bradley_terry_v1");
    expect(judgeReliabilityModel.legacyId).toBe("judge_reliability_v2");
  });
});
