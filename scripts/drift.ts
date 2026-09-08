#!/usr/bin/env bun
/**
 * bun run drift -- --kind <referral_signal|bradley_terry> --before <version> --after <version>
 *
 * Runs two registered spec versions on the seed dataset and prints the
 * drift report (one per dimension for bradley_terry). Paste the verdict
 * line into docs/models/CHANGELOG.md when shipping a new spec version.
 *
 * An unregistered `--after` can be tried with `--after-json '<ModelSpec json>'`
 * to preview a candidate before registering it.
 */

import { capabilityDrift, formatDriftReport, referralSignalDrift } from "../src/analysis/drift.ts";
import { DIMENSIONS } from "../src/domain/constants.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { getSpec, specVersions } from "../src/models/registry.ts";
import type {
  BradleyTerrySpec,
  ModelSpec,
  ModelSpecKind,
  ReferralSignalSpec,
} from "../src/models/spec.ts";
import { validateSpec } from "../src/models/spec.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { generateSeed } from "../src/seed/generate.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const kindArg = arg("kind") ?? "referral_signal";
const beforeVersion = arg("before");
const afterVersion = arg("after");
const afterJson = arg("after-json");

if (kindArg !== "referral_signal" && kindArg !== "bradley_terry") {
  console.error(`unknown kind ${kindArg}; use referral_signal or bradley_terry`);
  process.exit(2);
}
const kind: ModelSpecKind = kindArg;
if (!beforeVersion || (!afterVersion && !afterJson)) {
  console.error(
    `usage: bun run drift -- --kind ${kind} --before <version> (--after <version> | --after-json '<json>')\n` +
      `known versions: ${specVersions(kind).join(", ")}`,
  );
  process.exit(2);
}

function resolveAfter(): ModelSpec {
  if (afterJson) {
    const parsed = JSON.parse(afterJson) as ModelSpec;
    const v = validateSpec(parsed);
    if (!v.ok) {
      console.error(`--after-json is not a valid spec:\n  ${v.errors.join("\n  ")}`);
      process.exit(2);
    }
    return parsed;
  }
  return getSpec(kind, afterVersion as string);
}

const data = generateSeed();
const before = getSpec(kind, beforeVersion);
const after = resolveAfter();

if (kind === "referral_signal") {
  const a = computeAllReferralSignals(data.people, data.referrals, {
    spec: before as ReferralSignalSpec,
  });
  const b = computeAllReferralSignals(data.people, data.referrals, {
    spec: after as ReferralSignalSpec,
  });
  console.log(formatDriftReport(referralSignalDrift(a, b)));
} else {
  const a = computeCapabilityVectors(data.people, data.comparisons, {
    spec: before as BradleyTerrySpec,
  });
  const b = computeCapabilityVectors(data.people, data.comparisons, {
    spec: after as BradleyTerrySpec,
  });
  const reports = DIMENSIONS.map((d) => capabilityDrift(a, b, d));
  for (const r of reports) {
    console.log(formatDriftReport(r));
    console.log();
  }
  const worst = reports.reduce((w, r) =>
    r.verdict === "breaking" || (r.verdict === "review" && w.verdict === "stable") ? r : w,
  );
  console.log(`Overall verdict across dimensions: ${worst.verdict.toUpperCase()}`);
}
