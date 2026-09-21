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
// Imported for its registration, not for a name: `defineModel` registers
// process-wide, so which models `registeredModels()` returns used to depend on
// whether some *other* test file had already imported this one — and bun's
// file order is not alphabetical. Naming it here makes the set this suite sees
// the same set every time (#54 T8).
import "../src/longitudinal/run.ts";
import { CAREER_EVIDENCE_DIMENSIONS } from "../src/longitudinal/dimensions.ts";
import { CAREER_EVIDENCE_V1_0_0 } from "../src/models/careerEvidence.ts";
import {
  type AnyModelDefinition,
  defineModel,
  MODELS,
  registeredModels,
  runModel,
} from "../src/models/define.ts";
import { bradleyTerryModel, runCapabilityVectors } from "../src/models/definitions/bradleyTerry.ts";
import { judgeReliabilityModel } from "../src/models/definitions/judgeReliability.ts";
import { referralSignalModel } from "../src/models/definitions/referralSignal.ts";
import {
  BRADLEY_TERRY_V1_0_0,
  JUDGE_RELIABILITY_V2_0_0,
  REFERRAL_SIGNAL_V0_1_0,
} from "../src/models/registry.ts";
import { generateSeed } from "../src/seed/generate.ts";
import {
  claimAnswers,
  day,
  evidence,
  fakeRecord,
  identity,
  identityAnswers,
} from "./helpers/longitudinal.ts";

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
  specOf: () => REFERRAL_SIGNAL_V0_1_0,
  inputsOf: (input) => ({ n: input.n }),
  recordedOptionKeys: ["factor"],
  resolveOptions: (spec, opts) => ({
    parameters: { spec, factor: opts.factor },
    upstream: [],
  }),
  excludeFromProvenance: ["label"],
  compute: (input, _spec, opts) => input.n * opts.factor,
});

/**
 * Two definitions of one kind differing only in `compute`: the run id must
 * separate them, or a number computed one way could be reported under the id
 * of a number computed another way.
 */
const twinA = defineModel<"referral_signal", ProbeInput, ProbeOptions, number>({
  name: "twin_a_v0",
  kind: "referral_signal",
  specOf: () => REFERRAL_SIGNAL_V0_1_0,
  inputsOf: (input) => ({ n: input.n }),
  recordedOptionKeys: ["factor"],
  resolveOptions: (spec, opts) => ({ parameters: { spec, factor: opts.factor }, upstream: [] }),
  excludeFromProvenance: ["label"],
  compute: (input, _spec, opts) => input.n * opts.factor,
});

const twinB = defineModel<"referral_signal", ProbeInput, ProbeOptions, number>({
  name: "twin_b_v0",
  kind: "referral_signal",
  specOf: () => REFERRAL_SIGNAL_V0_1_0,
  inputsOf: (input) => ({ n: input.n }),
  recordedOptionKeys: ["factor"],
  resolveOptions: (spec, opts) => ({ parameters: { spec, factor: opts.factor }, upstream: [] }),
  excludeFromProvenance: ["label"],
  compute: (input, _spec, opts) => input.n * opts.factor + 1,
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

/**
 * One item of evidence and the two judgment records it was judged under.
 *
 * `deriveEvidence` is pure over records, so this probe needs no service and no
 * clock: every number is stated here. The identity passes the registered gate,
 * so the claim record is read — a probe whose derivation stopped at identity
 * would exercise half the model.
 */
const careerEvidenceItem = evidence("provenance-probe", 40);

const careerEvidenceInput = {
  identity,
  evidence: [careerEvidenceItem],
  records: [
    fakeRecord(
      "identity",
      identity.personId,
      careerEvidenceItem,
      identityAnswers({
        decision: "same",
        confidence: 0.98,
        fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
      }),
    ),
    fakeRecord(
      "claim",
      identity.personId,
      careerEvidenceItem,
      claimAnswers({
        eventKind: "open_source_contribution",
        eventConfidence: 0.92,
        dimensions: CAREER_EVIDENCE_DIMENSIONS.map((dimension) => ({
          dimension,
          score: 3,
          probabilities: [0, 0, 0, 1, 0],
          confidence: 0.9,
        })),
      }),
    ),
  ],
  cutoffAt: day(90),
  retrievedAt: day(100),
  pipelineVersion: "1",
};

const PROBES: Record<string, Probe> = {
  referral_signal_v0: {
    input: { people: data.people, referrals: data.referrals },
    opts: {
      spec: REFERRAL_SIGNAL_V0_1_0,
      topK: 5,
      judgeReliability: new Map([["p-001", 0.5]]),
      judgeBias: new Map([["p-001", 0.1]]),
      judgeRunId: "judge_reliability/judge_reliability_v2@2.0.0:deadbeefcafe:01234567",
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
  career_evidence_v1: {
    input: careerEvidenceInput,
    opts: { spec: CAREER_EVIDENCE_V1_0_0 },
    now: NOW,
    // Thresholds and version only: the rubric hash stays the one the records
    // carry, so the derivation still reads them and the id has to move on the
    // recorded spec alone — which is the whole point of a thresholds-only bump
    // being free (`runCareerEvidence`).
    perturb: {
      spec: () => ({
        ...CAREER_EVIDENCE_V1_0_0,
        version: "1.0.1+probe",
        thresholds: { ...CAREER_EVIDENCE_V1_0_0.thresholds, dimensionConfidence: 0.9 },
      }),
    },
  },
  twin_a_v0: { input: { n: 3 }, opts: { factor: 2, label: "display only" }, now: NOW },
  twin_b_v0: { input: { n: 3 }, opts: { factor: 2, label: "display only" }, now: NOW },
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
  return runModel(def, probe.input, opts, probe.now).id;
}

describe("every option moves the id", () => {
  // A coverage check, not an equality one: models register process-wide, so
  // a second test file defining a model must not break this file depending
  // on load order. What matters is that no registered model goes unprobed.
  test("every registered model has a probe", () => {
    const unprobed = registeredModels()
      .map((d) => d.name)
      .filter((name) => !(name in PROBES));
    expect(unprobed).toEqual([]);
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
    const run = runModel(inTestModel, { n: 3 }, { factor: 2, label: "display only" }, NOW);
    expect(run.outputs).toBe(6);
    expect(run.specVersion).toBe("0.1.0");
    expect(run.id).toMatch(
      /^referral_signal\/defined_in_test_v0@0\.1\.0:[0-9a-f]{12}:[0-9a-f]{8}$/,
    );
    expect(run.createdAt).toEqual(NOW);
    expect(Object.keys(run.parameters).sort()).toEqual(["factor", "spec"]);
  });

  test("defining a second model under the same name is refused", () => {
    expect(() =>
      defineModel({
        name: "defined_in_test_v0",
        kind: "referral_signal",
        specOf: () => REFERRAL_SIGNAL_V0_1_0,
        inputsOf: () => ({}),
        recordedOptionKeys: [],
        resolveOptions: (spec) => ({ parameters: { spec }, upstream: [] }),
        compute: () => 0,
      }),
    ).toThrow(/already registered/);
  });
});

describe("the three shipped models are registered", () => {
  test("each names its spec kind, and the kind resolves a spec", () => {
    expect(referralSignalModel.kind).toBe("referral_signal");
    expect(bradleyTerryModel.kind).toBe("bradley_terry");
    expect(judgeReliabilityModel.kind).toBe("judge_reliability");
  });
});

describe("the runner derives the spec it stamps", () => {
  const opts = { factor: 2, label: "display only" };

  test("two definitions of one kind never share a run id", () => {
    const a = runModel(twinA, { n: 3 }, opts, NOW);
    const b = runModel(twinB, { n: 3 }, opts, NOW);
    expect(a.outputs).not.toBe(b.outputs);
    expect(a.id).not.toBe(b.id);
    expect(a.kind).toBe(b.kind);
    expect(a.specVersion).toBe(b.specVersion);
  });

  test("the stamped spec is `specOf(opts)`; a caller cannot supply another", () => {
    // `runModel` takes no spec argument, so hashing spec A onto a number
    // computed with spec B is unrepresentable. An extra argument is ignored.
    const wrong = { ...REFERRAL_SIGNAL_V0_1_0, version: "9.9.9" };
    const run = (runModel as unknown as (...args: unknown[]) => { specVersion: string })(
      twinA,
      { n: 3 },
      opts,
      NOW,
      wrong,
    );
    expect(run.specVersion).toBe("0.1.0");
  });
});

/**
 * Fail-closed option checking, for every model rather than for one.
 *
 * Under review it turned out only `referral_signal` refused an option it did
 * not record: a `weighting` key handed to the capability or calibration
 * runner was silently dropped and the run kept the id of a call that never
 * saw it. The mechanism now lives in `runModel`, so there is exactly one
 * place for it to be right and no definition can forget it.
 */
describe("an option no definition records is refused", () => {
  for (const def of registeredModels()) {
    test(`${def.name}: an unknown option key throws before anything is computed`, () => {
      const probe = PROBES[def.name] as Probe;
      expect(() =>
        runModel(def, probe.input, { ...probe.opts, weighting: { kind: "uniform" } }, probe.now),
      ).toThrow(/unrecorded option "weighting"/);
    });

    /**
     * `recordedOptionKeys` is a claim that each key moves the id; the
     * property test above is what checks the claim. A key declared but never
     * put in the probe is an unchecked claim, so it fails here by name.
     */
    test(`${def.name}: every recorded option key is probed`, () => {
      const probe = PROBES[def.name] as Probe;
      const probed = new Set(Object.keys(probe.opts));
      const unprobed = def.recordedOptionKeys.filter((key) => !probed.has(key));
      expect(
        unprobed,
        `${def.name}: recordedOptionKeys names ${unprobed.join(", ")}, which the probe never sets`,
      ).toEqual([]);
    });
  }
});
