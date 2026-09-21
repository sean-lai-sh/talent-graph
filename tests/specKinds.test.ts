/**
 * #55 T7 — the parallel kind unions, collapsed.
 *
 * Before this ticket four lists of kinds were maintained by hand and could
 * disagree: `ModelSpecKind` (the registered spec kinds), `LoadedSpecs`'s
 * three named fields, `DriftReport["kind"]`'s own string union, and a runtime
 * `if` in `scripts/drift.ts`. Now there are two, and one is derived from the
 * other:
 *
 *   - `ModelSpecKind` — every registered spec kind. `CURRENT_SPECS` is a
 *     total record over it, so registering a kind is not optional there.
 *   - `PipelineKind` = `keyof RunOutputs` (src/pipeline/advance.ts) — the
 *     kinds one pass actually runs, a subset. `LoadedSpecs` (src/config.ts),
 *     `DriftReport["kind"]` (src/analysis/drift.ts), `DriftKind` and the
 *     `PIPELINE_KINDS` membership record are all it, or derived from it.
 *
 * The distinction is load-bearing rather than cosmetic. A registered spec
 * kind that the pipeline never evaluates — versioned rubric data, say —
 * produces no number, so it has nothing for a `TG_*` override to move and
 * nothing to drift-compare. Mapping `LoadedSpecs` over all of `ModelSpecKind`
 * would have forced such a kind into the env bridge and into the drift CLI's
 * vocabulary, where it has no meaning.
 *
 * This file is the compile-time half of that claim: the `@ts-expect-error`
 * fixtures below fail the build (TS2578, "unused '@ts-expect-error'
 * directive") the day one of these types stops being what it says it is. The
 * other half cannot be written as a fixture — adding a kind is an edit, not
 * an expression — so it was measured by simulation and the output is recorded
 * verbatim in `describe("adding a kind …")` at the bottom of this file.
 */

import { describe, expect, test } from "bun:test";
import type { DriftReport } from "../src/analysis/drift.ts";
import { type LoadedSpecs, loadSpecs, type TalentGraphConfig } from "../src/config.ts";
import { CURRENT_SPECS } from "../src/models/registry.ts";
import type {
  BradleyTerrySpec,
  JudgeReliabilitySpec,
  ModelSpecKind,
  ReferralSignalSpec,
  SpecOfKind,
} from "../src/models/spec.ts";
import { type DriftKind, driftKinds, type PipelineKind } from "../src/pipeline/advance.ts";

/**
 * Mutual assignability is too weak here: `"a" | "b"` and `string` are not
 * equal but each is assignable to the other in one direction, and a mapped
 * type that lost a key would still satisfy a one-way `extends`. This is the
 * usual conditional-type identity check, which compares the two types
 * structurally and exactly.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The env with no `TG_*` overrides set, and no warning noise. */
const NO_ENV = {};
const silent = { warn: () => {} };

describe("LoadedSpecs is a mapped type over the kinds the pipeline runs", () => {
  test("its keys are exactly `config` plus every PipelineKind", () => {
    const keys: Equal<keyof LoadedSpecs, "config" | PipelineKind> = true;
    expect(keys).toBe(true);

    // And at runtime: one key per pipeline kind, plus the config they came
    // from. No key with `undefined` behind it — missing is not low, and a
    // spec that is not there is not a spec that is `undefined`.
    const specs = loadSpecs(NO_ENV, silent);
    expect(Object.keys(specs).sort()).toEqual([
      "bradley_terry",
      "config",
      "judge_reliability",
      "referral_signal",
    ]);
    for (const [key, value] of Object.entries(specs)) {
      expect(value, `${key} is undefined`).toBeDefined();
    }
  });

  /**
   * The Club reads `specs.referral_signal`, `specs.bradley_terry`,
   * `specs.judge_reliability` and `specs.config` by name. The mapped type has
   * to resolve to the *same* concrete types the three named fields had, or
   * those reads change meaning without anyone editing them.
   */
  test("each field still resolves to the same concrete spec type", () => {
    const referral: Equal<LoadedSpecs["referral_signal"], ReferralSignalSpec> = true;
    const capability: Equal<LoadedSpecs["bradley_terry"], BradleyTerrySpec> = true;
    const calibration: Equal<LoadedSpecs["judge_reliability"], JudgeReliabilitySpec> = true;
    const config: Equal<LoadedSpecs["config"], TalentGraphConfig> = true;
    expect([referral, capability, calibration, config]).toEqual([true, true, true, true]);

    // The same four reads, as an application makes them.
    const specs = loadSpecs(NO_ENV, silent);
    expect(specs.referral_signal.kind).toBe("referral_signal");
    expect(specs.bradley_terry.kind).toBe("bradley_terry");
    expect(specs.judge_reliability.kind).toBe("judge_reliability");
    expect(specs.config.topKReferrals).toBe(CURRENT_SPECS.referral_signal.topK);
  });

  test("the mapped type is `SpecOfKind` of its key, not a widened union", () => {
    const perKey: Equal<
      { [K in PipelineKind]: LoadedSpecs[K] },
      { [K in PipelineKind]: SpecOfKind<K> }
    > = true;
    expect(perKey).toBe(true);
  });

  test("a registered kind the pipeline never runs has no LoadedSpecs key", () => {
    const specs = loadSpecs(NO_ENV, silent);
    // @ts-expect-error a kind the pipeline never runs is not a LoadedSpecs key
    const absent = specs.career_evidence;
    expect(absent).toBeUndefined();
  });
});

describe("the drift vocabulary is the pipeline's, not the registry's", () => {
  test("DriftReport['kind'] is PipelineKind", () => {
    const reportKind: Equal<DriftReport["kind"], PipelineKind> = true;
    expect(reportKind).toBe(true);
  });

  /**
   * `DriftKind` used to be `PipelineKind & keyof LoadedSpecs` — an
   * intersection whose job was to catch the two lists disagreeing. They
   * cannot disagree any more, so it is one union with two names rather than
   * two unions to keep in step.
   */
  test("DriftKind is PipelineKind", () => {
    const driftKind: Equal<DriftKind, PipelineKind> = true;
    expect(driftKind).toBe(true);
    expect(driftKinds(loadSpecs(NO_ENV, silent))).toEqual([
      "bradley_terry",
      "judge_reliability",
      "referral_signal",
    ]);
  });

  test("a kind the pipeline never runs cannot be reported as drift", () => {
    // @ts-expect-error drift exists only for kinds that produce numbers
    const notReportable: DriftReport["kind"] = "career_evidence";
    // @ts-expect-error … and `DriftKind` is the same union, so the CLI agrees
    const notDriftable: DriftKind = "career_evidence";
    expect([notReportable as string, notDriftable as string]).toEqual([
      "career_evidence",
      "career_evidence",
    ]);
  });
});

describe("PipelineKind is a subset of ModelSpecKind, and CURRENT_SPECS is total", () => {
  test("every kind the pipeline runs is a registered spec kind", () => {
    const subset: PipelineKind extends ModelSpecKind ? true : false = true;
    expect(subset).toBe(true);
  });

  /**
   * The other direction is deliberately false: `ModelSpecKind` does not
   * extend `PipelineKind`, which is what leaves room for a registered kind
   * the pipeline never evaluates. Today the two sets happen to coincide, so
   * this is asserted on the *types* being distinct declarations rather than
   * on their current members: `CURRENT_SPECS` is keyed on `ModelSpecKind`,
   * `LoadedSpecs` on `PipelineKind`, and the simulations below show they
   * come apart the moment such a kind is registered.
   */
  test("CURRENT_SPECS has an entry for every registered spec kind", () => {
    const total: Equal<keyof typeof CURRENT_SPECS, ModelSpecKind> = true;
    expect(total).toBe(true);
    for (const [kind, spec] of Object.entries(CURRENT_SPECS)) {
      expect(String(spec.kind), `CURRENT_SPECS.${kind} is filed under the wrong kind`).toBe(kind);
    }
  });
});

/**
 * The acceptance criterion, measured rather than asserted.
 *
 * Adding a kind is an edit to the source, not an expression a test can
 * contain, so each case below was simulated in the worktree: apply the edit,
 * run `bun run typecheck`, record every error, `git checkout --` the edit.
 * The two simulations used a placeholder pipeline kind (`cohort_baseline`,
 * `{ kind; version; window }`) added to the `ModelSpec` union in
 * `src/models/spec.ts`.
 *
 * ── Simulation 1: a 4th NON-pipeline spec kind ───────────────────────────
 * Edit: the new interface, plus `| CohortBaselineSpec` on `ModelSpec`.
 * Nothing else. `bun run typecheck` reports exactly ONE error:
 *
 *   src/models/registry.ts(93,14): error TS2741: Property 'cohort_baseline'
 *   is missing in type '{ referral_signal: ReferralSignalSpec; bradley_terry:
 *   BradleyTerrySpec; judge_reliability: JudgeReliabilitySpec; }' but
 *   required in type '{ readonly referral_signal: ReferralSignalSpec;
 *   readonly bradley_terry: BradleyTerrySpec; readonly judge_reliability:
 *   JudgeReliabilitySpec; readonly cohort_baseline: CohortBaselineSpec; }'.
 *
 * That is `CURRENT_SPECS`, and only `CURRENT_SPECS`. The env bridge, the
 * drift report, the drift CLI and the pipeline are all silent: a rubric-only
 * kind is registered without being dragged into any of them.
 *
 * ── Simulation 2: a 4th PIPELINE kind ────────────────────────────────────
 * Edit: the same, plus `cohort_baseline: Map<string, number>` in `RunOutputs`
 * (src/pipeline/advance.ts) — the one hand-written list of the pipeline's
 * kinds. `bun run typecheck` reports exactly THREE errors:
 *
 *   src/config.ts(162,3): error TS2322: Type '{ config: TalentGraphConfig;
 *   referral_signal: ReferralSignalSpec; bradley_terry: BradleyTerrySpec;
 *   judge_reliability: JudgeReliabilitySpec; }' is not assignable to type
 *   'LoadedSpecs'.
 *     Property 'cohort_baseline' is missing in type '{ config:
 *     TalentGraphConfig; referral_signal: ReferralSignalSpec; bradley_terry:
 *     BradleyTerrySpec; judge_reliability: JudgeReliabilitySpec; }' but
 *     required in type '{ referral_signal: ReferralSignalSpec; bradley_terry:
 *     BradleyTerrySpec; judge_reliability: JudgeReliabilitySpec;
 *     cohort_baseline: CohortBaselineSpec; }'.
 *   src/models/registry.ts(93,14): error TS2741: Property 'cohort_baseline'
 *   is missing in type … (as in simulation 1)
 *   src/pipeline/advance.ts(96,7): error TS2741: Property 'cohort_baseline'
 *   is missing in type 'Readonly<{ bradley_terry: true; judge_reliability:
 *   true; referral_signal: true; }>' but required in type
 *   'Readonly<Record<keyof RunOutputs, true>>'.
 *
 * Which is: the `loadSpecs()` return (the env bridge owes the kind a spec),
 * `CURRENT_SPECS` (the registry owes it a version), and `PIPELINE_KINDS` (the
 * membership record the drift CLI filters on). `DriftReport["kind"]`,
 * `DriftKind`, `EngineState`, `requireRun` and `scripts/drift.ts` widen on
 * their own and need no edit — that is the collapse working.
 *
 * Filling those three in and writing the kind's own `defineModel` file
 * (`src/models/definitions/`, one more line in that directory's `index.ts`)
 * takes the tree back to zero errors — verified by carrying simulation 2
 * through to a green `bun run typecheck`.
 *
 * ── What the compiler still does NOT catch ───────────────────────────────
 * `EngineState.runs` is `Partial`, because the first pass of a deployment has
 * no previous runs and a caller may legitimately hold a state that is missing
 * one. So `advance()` returning a state without the new kind's run is not a
 * type error: the kind would be declared, specced, registered and never
 * evaluated. Making the *returned* state total is a separate design question
 * (it would need a second, non-partial type for "a state a pass just
 * produced"), and is not what this ticket bought. Recorded here so the
 * "exactly three places" claim above is read as what it is.
 *
 * And `defineModel` is open by design (src/models/define.ts): a model is
 * registered by its module running, not by an entry in a central union, so a
 * new kind's definition file is code you write rather than an existing file
 * that breaks. There is no compile error to point at there — only the three
 * above plus a file that does not exist yet.
 */
describe("adding a kind: what the compiler catches, measured", () => {
  test("the simulations above are recorded, not asserted at runtime", () => {
    // The fixtures in this file are the part that can fail automatically:
    // each `@ts-expect-error` becomes TS2578 the day its type widens.
    expect(true).toBe(true);
  });
});
