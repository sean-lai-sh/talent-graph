/**
 * Central tunables with env overrides.
 *
 * Doppler project `talent-graph`, config `dev`, holds the same keys, so both
 * `doppler run --project talent-graph --config dev -- bun test` and plain
 * `bun test` work. `loadConfig` is the **only** place in `src/` that reads
 * `process.env`; every math function takes its parameters explicitly and
 * falls back to `CURRENT_SPECS` (src/models/registry.ts), never to the env.
 *
 * Config is a deployment override on top of a registered spec. When any
 * value differs from the registered spec the derived spec gets a `+env`
 * build tag so a `ModelRun` never claims to be a registered version while
 * carrying different numbers.
 */

import { CURRENT_SPECS } from "./models/registry.ts";
import type { BradleyTerrySpec, JudgeReliabilitySpec, ReferralSignalSpec } from "./models/spec.ts";

export interface TalentGraphConfig {
  /** λ — see the note on BRADLEY_TERRY_V1_0_0 for why 0.1. */
  btRegularization: number;
  btMaxIterations: number;
  btTolerance: number;
  minComparisons: number;
  minOpponents: number;
  topKReferrals: number;
}

export const DEFAULT_CONFIG: TalentGraphConfig = Object.freeze({
  btRegularization: CURRENT_SPECS.bradley_terry.regularization,
  btMaxIterations: CURRENT_SPECS.bradley_terry.maxIterations,
  btTolerance: CURRENT_SPECS.bradley_terry.tolerance,
  minComparisons: CURRENT_SPECS.bradley_terry.minComparisons,
  minOpponents: CURRENT_SPECS.bradley_terry.minOpponents,
  topKReferrals: CURRENT_SPECS.referral_signal.topK,
});

export const CONFIG_ENV_KEYS: Record<keyof TalentGraphConfig, string> = {
  btRegularization: "TG_BT_REGULARIZATION",
  btMaxIterations: "TG_BT_MAX_ITERATIONS",
  btTolerance: "TG_BT_TOLERANCE",
  minComparisons: "TG_MIN_COMPARISONS",
  minOpponents: "TG_MIN_OPPONENTS",
  topKReferrals: "TG_TOP_K_REFERRALS",
};

type Parser = (raw: string) => number | undefined;

const nonNegativeFloat: Parser = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const positiveFloat: Parser = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const positiveInt: Parser = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const PARSERS: Record<keyof TalentGraphConfig, Parser> = {
  btRegularization: nonNegativeFloat,
  btMaxIterations: positiveInt,
  btTolerance: positiveFloat,
  minComparisons: positiveInt,
  minOpponents: positiveInt,
  topKReferrals: positiveInt,
};

export interface LoadConfigOptions {
  /** Receives one message per invalid value. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

/**
 * Read `TG_*` overrides from `env`. Unset keys keep the default; an unparsable
 * or out-of-range value keeps the default and emits a warning. Never throws.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  opts: LoadConfigOptions = {},
): TalentGraphConfig {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const config: TalentGraphConfig = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(CONFIG_ENV_KEYS) as Array<keyof TalentGraphConfig>) {
    const envKey = CONFIG_ENV_KEYS[key];
    const raw = env[envKey];
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = PARSERS[key](raw.trim());
    if (parsed === undefined) {
      warn(`${envKey}=${JSON.stringify(raw)} is invalid; using default ${DEFAULT_CONFIG[key]}`);
      continue;
    }
    config[key] = parsed;
  }

  return config;
}

function tagIfChanged<T extends { version: string }>(base: T, derived: T): T {
  const same = JSON.stringify(base) === JSON.stringify(derived);
  return same ? base : { ...derived, version: `${base.version}+env` };
}

/** The Bradley–Terry spec a config implies, on top of the current registered spec. */
export function bradleyTerrySpecFromConfig(
  config: TalentGraphConfig,
  base: BradleyTerrySpec = CURRENT_SPECS.bradley_terry,
): BradleyTerrySpec {
  return tagIfChanged(base, {
    ...base,
    regularization: config.btRegularization,
    maxIterations: config.btMaxIterations,
    tolerance: config.btTolerance,
    minComparisons: config.minComparisons,
    minOpponents: config.minOpponents,
  });
}

/** The Referral Signal spec a config implies, on top of the current registered spec. */
export function referralSignalSpecFromConfig(
  config: TalentGraphConfig,
  base: ReferralSignalSpec = CURRENT_SPECS.referral_signal,
): ReferralSignalSpec {
  return tagIfChanged(base, { ...base, topK: config.topKReferrals });
}

export interface LoadedSpecs {
  config: TalentGraphConfig;
  referral_signal: ReferralSignalSpec;
  bradley_terry: BradleyTerrySpec;
  /** No env overrides exist for V2 yet; always the registered current spec. */
  judge_reliability: JudgeReliabilitySpec;
}

/**
 * The bridge between the environment and the math. `compute*` / `fit*`
 * functions never read `process.env`; a caller that wants the advertised
 * `TG_*` overrides to apply calls this once and passes the specs it returns
 * (`spec:` option). Each spec is the current registered version, tagged
 * `+env` when any override changed a number.
 */
export function loadSpecs(
  env: Record<string, string | undefined> = process.env,
  opts: LoadConfigOptions = {},
): LoadedSpecs {
  const config = loadConfig(env, opts);
  return {
    config,
    referral_signal: referralSignalSpecFromConfig(config),
    bradley_terry: bradleyTerrySpecFromConfig(config),
    judge_reliability: CURRENT_SPECS.judge_reliability,
  };
}
