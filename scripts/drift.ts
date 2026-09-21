#!/usr/bin/env bun
/**
 * bun run drift -- --kind <kind> --before <version> --after <version>
 * bun run drift -- --v0-vs-v2 [--spec <version|env>]
 *
 * Runs the pipeline twice on the seed dataset and prints the drift reports
 * for the requested kind (one per dimension for `bradley_terry`; for
 * `judge_reliability`, one per judge measure plus one for the judge-weighted
 * Referral Signal the calibration feeds). Paste the verdict line into
 * docs/models/CHANGELOG.md when shipping a new spec version.
 *
 * The kinds are resolved, never enumerated here: `driftKinds()` reads them
 * off the loaded specs, which are keyed on the kinds a pass runs. A kind the
 * pipeline runs is therefore driftable the day it lands, and a registered
 * spec kind the pipeline never evaluates is refused by name rather than
 * failing somewhere inside the comparison.
 *
 * A version is either a registered semver (`0.1.0`) or the literal `env`,
 * meaning "the current registered spec with `TG_*` overrides applied" via
 * `loadSpecs()` — e.g. `TG_TOP_K_REFERRALS=1 bun run drift -- --before 0.1.0
 * --after env` previews what the deployment's overrides would do.
 *
 * An unregistered `--after` can be tried with `--after-json '<ModelSpec json>'`
 * to preview a candidate before registering it. The JSON may not reuse a
 * registered version: a candidate is not the thing it wants to replace.
 *
 * Exit status is the gate. 0 when the worst verdict across the reports is at
 * or below `--max-verdict` (default `review`, so only `breaking` fails), 1
 * when it is above it, 2 for a usage error. `--max-verdict stable` fails a
 * `review` too; `--max-verdict breaking` reports without ever failing.
 *
 * `--v0-vs-v2` is the other question: not "what does a new spec do" but
 * "what do the judge weights do", the unweighted Referral Signal against the
 * judge-weighted one from a single pass, under one spec.
 */

import {
  type DriftReport,
  type DriftVerdict,
  formatDriftReport,
  referralSignalDrift,
} from "../src/analysis/drift.ts";
import { type LoadedSpecs, loadSpecs } from "../src/config.ts";
import { getSpec, specVersions } from "../src/models/registry.ts";
import type { ModelSpec, SpecOfKind } from "../src/models/spec.ts";
import { validateSpec } from "../src/models/spec.ts";
import {
  advance,
  baselineReferralRun,
  type DriftKind,
  driftKinds,
  judgeWeightedReferralRun,
  type Observations,
} from "../src/pipeline/advance.ts";
import { generateSeed } from "../src/seed/generate.ts";

const ENV_VERSION = "env";
/** The evaluation time step T, as `bun run demo` pins it. Never a clock read. */
const T = new Date("2026-12-31T00:00:00.000Z");

const base = loadSpecs();

/**
 * The kinds this script can compare — what a pass actually runs, not every
 * registered kind. Derived, so a kind added to the pipeline is driftable the
 * day it lands and one that is registered but not run is refused here rather
 * than failing somewhere inside the comparison.
 */
const KINDS = driftKinds(base);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function isKind(value: string): value is DriftKind {
  return (KINDS as string[]).includes(value);
}

const kindArg = arg("kind") ?? "referral_signal";
if (!isKind(kindArg)) {
  console.error(`unknown kind ${kindArg}; use one of ${KINDS.join(", ")}`);
  process.exit(2);
}
const kind: DriftKind = kindArg;

/**
 * Verdict severity, worst last. The gate compares positions in this list; the
 * thresholds that produce a verdict live in `src/analysis/drift.ts` and are
 * not this script's business.
 */
const VERDICTS: readonly DriftVerdict[] = ["stable", "review", "breaking"];
const severity = (v: DriftVerdict): number => VERDICTS.indexOf(v);

const maxVerdictArg = arg("max-verdict") ?? "review";
if (!(VERDICTS as readonly string[]).includes(maxVerdictArg)) {
  console.error(`unknown --max-verdict ${maxVerdictArg}; use one of ${VERDICTS.join(", ")}`);
  process.exit(2);
}
const maxVerdict = maxVerdictArg as DriftVerdict;

/** Registered version lookup, or the env-derived current spec for `env`. */
function resolveVersion(version: string): SpecOfKind<typeof kind> {
  if (version === ENV_VERSION) return loadSpecs()[kind];
  return getSpec(kind, version);
}

const data = generateSeed();
const observations: Observations = {
  people: data.people,
  referrals: data.referrals,
  comparisons: data.comparisons,
  outcomes: data.outcomes,
  opportunities: data.opportunities,
};

/**
 * `base` with one kind's spec swapped. The computed key and the spec are the
 * same `K`, which is what the assertion stands on: TypeScript widens a
 * computed key to `string` and loses that on its own.
 */
function specsWith<K extends DriftKind>(
  base: LoadedSpecs,
  kind: K,
  spec: SpecOfKind<K>,
): LoadedSpecs {
  return { ...base, [kind]: spec } as LoadedSpecs;
}

/**
 * Print every report, then exit on the worst verdict among them. This is the
 * whole gate: the reports are printed first, always, so a failing run says
 * what moved rather than only that something did.
 */
function report(reports: readonly DriftReport[]): never {
  if (reports.length === 0) {
    console.error(`no ${kind} drift report was produced`);
    process.exit(1);
  }
  // The same ordering the exit code is taken from, so a fourth verdict cannot
  // mean one thing to the summary line and another to the gate.
  const worst = reports.reduce((w, r) => (severity(r.verdict) > severity(w.verdict) ? r : w));
  if (reports.length === 1) {
    console.log(formatDriftReport(reports[0] as DriftReport));
  } else {
    for (const r of reports) {
      console.log(formatDriftReport(r));
      console.log();
    }
    console.log(`Overall verdict across ${reports.length} reports: ${worst.verdict.toUpperCase()}`);
  }
  process.exit(severity(worst.verdict) > severity(maxVerdict) ? 1 : 0);
}

/* ---------------------------------------------------------------- *
 * V0 vs V2 — one spec, one pass, judge weights on or off.
 * ---------------------------------------------------------------- */

function getReferralSpec(version: string): SpecOfKind<"referral_signal"> {
  return version === ENV_VERSION
    ? loadSpecs().referral_signal
    : getSpec("referral_signal", version);
}

if (flag("v0-vs-v2")) {
  // Judge weights are a Referral Signal question; there is nothing to weight
  // on another kind, so a `--kind` that says otherwise is a mistake, not a
  // silently ignored argument.
  if (arg("kind") !== undefined && kind !== "referral_signal") {
    console.error(`--v0-vs-v2 compares referral_signal runs; --kind ${kind} has no V2 variant`);
    process.exit(2);
  }
  const version = arg("spec") ?? ENV_VERSION;
  const specs = specsWith(loadSpecs(), "referral_signal", getReferralSpec(version));
  const pass = advance(null, observations, specs, T, { drift: false });
  report([
    referralSignalDrift(baselineReferralRun(pass).outputs, judgeWeightedReferralRun(pass).outputs),
  ]);
}

/* ---------------------------------------------------------------- *
 * Spec vs spec — two passes on the same observations.
 * ---------------------------------------------------------------- */

const beforeVersion = arg("before");
const afterVersion = arg("after");
const afterJson = arg("after-json");

if (!beforeVersion || (!afterVersion && !afterJson)) {
  console.error(
    `usage: bun run drift -- --kind ${kind} --before <version|env> (--after <version|env> | --after-json '<json>')\n` +
      `   or: bun run drift -- --v0-vs-v2 [--spec <version|env>]\n` +
      `kinds: ${KINDS.join(", ")}\n` +
      `[--max-verdict ${VERDICTS.join("|")}] — exit 1 when the worst verdict is above it (default review)\n` +
      `known ${kind} versions: ${specVersions(kind).join(", ")} · "env" = current spec with TG_* overrides`,
  );
  process.exit(2);
}

function resolveAfter(): SpecOfKind<typeof kind> {
  if (afterJson) {
    const parsed = JSON.parse(afterJson) as ModelSpec;
    const v = validateSpec(parsed);
    if (!v.ok) {
      console.error(`--after-json is not a valid spec:\n  ${v.errors.join("\n  ")}`);
      process.exit(2);
    }
    if (parsed.kind !== kind) {
      console.error(`--after-json is a ${parsed.kind} spec, but --kind is ${kind}`);
      process.exit(2);
    }
    // A candidate must not wear a shipped version's name: the report labels
    // each side by `spec.version`, so JSON claiming a registered version would
    // print as that version while carrying different numbers.
    if (specVersions(kind).includes(parsed.version)) {
      console.error(
        `--after-json: ${kind}@${parsed.version} is a registered version; tag the candidate instead, e.g. ${parsed.version}+candidate`,
      );
      process.exit(2);
    }
    return parsed as SpecOfKind<typeof kind>;
  }
  return resolveVersion(afterVersion as string);
}

const beforeSpecs = specsWith(base, kind, resolveVersion(beforeVersion));
const afterSpecs = specsWith(base, kind, resolveAfter());

// The first pass is the baseline the second is compared against: `advance`
// does the comparison per kind, so this script never decides what "drift"
// means for a kind it has never heard of.
const before = advance(null, observations, beforeSpecs, T, { drift: false });
const after = advance(before.state, observations, afterSpecs, T);

// The weighted-signal arm of a `judge_reliability` comparison comes from
// `advance` itself, so a caller reading `advance().drift` sees exactly what
// this script prints — there is one definition of what a kind's drift is.
report(after.drift.filter((r) => r.kind === kind));
