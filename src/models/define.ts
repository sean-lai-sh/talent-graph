/**
 * `defineModel` — one declaration per model, one generic runner.
 *
 * A model is four functions and a kind: what counts as a raw observation,
 * which spec a call uses, what the options mean for provenance, and the
 * maths. `runModel` turns those into a `ModelRun`, so the id formula and the
 * provenance discipline live in exactly one place instead of being retyped
 * in every wrapper.
 *
 * `resolveOptions` is the single provenance seam: it returns the options
 * verbatim as `parameters`, with any option that is *another run's output*
 * replaced by that run's id (or a digest of it) in `upstream`. There is no
 * second hand-written parameter list to forget, and `excludeFromProvenance`
 * must name any option key deliberately left out — a key named there is
 * asserted *not* to move the id, so the omission is a claim the test checks
 * rather than a silent hole.
 *
 * This module imports no scoring, inference or judge code: definitions
 * depend on it, never the other way round.
 */

import { createRun, type ModelRun, type ModelType, type UpstreamRun } from "./run.ts";
import type { ModelSpecKind, SpecOfKind } from "./spec.ts";

/** What `resolveOptions` hands back: the provenance record of one call. */
export interface ResolvedOptions {
  /** Everything that can change the numbers, recorded verbatim. */
  parameters: Record<string, unknown>;
  /** Options that were another run's output, by role. */
  upstream: readonly UpstreamRun[];
}

export interface ModelDefinition<K extends ModelSpecKind, TIn, TOpts, TOut> {
  /** Unique key in the runtime registry. */
  name: string;
  kind: K;
  /**
   * The `modelType` segment of the emitted run id. Frozen per model so the
   * id format survives this refactor unchanged; it goes away with the run-id
   * format bump, which is the one change allowed to move ids.
   */
  legacyId: ModelType;
  /** The spec a call uses, given its options. The only default-spec seam. */
  specOf(opts: TOpts): SpecOfKind<K>;
  /**
   * The version stamped on the run. Defaults to `spec.version`; a model
   * whose numbers change with an option (judge-weighted Referral Signals)
   * tags the version so a weighted run is never mistaken for the plain one.
   */
  versionOf?(spec: SpecOfKind<K>, opts: TOpts): string;
  /** Raw observations only. Everything returned here is hashed into inputHash. */
  inputsOf(input: TIn): unknown;
  /** The single provenance seam; see the module comment. */
  resolveOptions(spec: SpecOfKind<K>, opts: TOpts): ResolvedOptions;
  /** Option keys deliberately absent from `parameters`. */
  excludeFromProvenance?: readonly string[];
  compute(input: TIn, spec: SpecOfKind<K>, opts: TOpts): TOut;
}

/**
 * A definition with its type parameters erased, as the registry stores them.
 * `any` rather than `unknown` because the registry is heterogeneous: a caller
 * that pulls a definition out of it has already lost the static types and
 * gets them back from the probe or call site that supplies the input.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry, see above.
export type AnyModelDefinition = ModelDefinition<ModelSpecKind, any, any, unknown>;

const REGISTRY = new Map<string, AnyModelDefinition>();

/** Every model known at runtime, by name. Populated by `defineModel`. */
export const MODELS: ReadonlyMap<string, AnyModelDefinition> = REGISTRY;

/**
 * Declare a model and register it.
 *
 * Registration is what makes the provenance property test complete: a model
 * that exists is a model the test perturbs. Defining one needs no edit to
 * any central union or switch — including from a test file.
 */
export function defineModel<K extends ModelSpecKind, TIn, TOpts, TOut>(
  def: ModelDefinition<K, TIn, TOpts, TOut>,
): ModelDefinition<K, TIn, TOpts, TOut> {
  const existing = REGISTRY.get(def.name);
  if (existing !== undefined && existing !== (def as unknown as AnyModelDefinition)) {
    throw new Error(`model "${def.name}" is already registered`);
  }
  REGISTRY.set(def.name, def as unknown as AnyModelDefinition);
  return def;
}

/** Every registered model, in registration order. */
export function registeredModels(): AnyModelDefinition[] {
  return [...REGISTRY.values()];
}

/** Look a model up by name. Throws on an unknown name, listing the known ones. */
export function getModel(name: string): AnyModelDefinition {
  const def = REGISTRY.get(name);
  if (def === undefined) {
    const known = [...REGISTRY.keys()];
    throw new Error(
      `unknown model ${name}; known models: ${known.length ? known.join(", ") : "(none)"}`,
    );
  }
  return def;
}

/**
 * Run a model and wrap the result in a `ModelRun`.
 *
 * The maths runs first, so an invalid spec throws before anything is
 * recorded; `parameters` and lineage are then read off the same options the
 * maths saw.
 */
export function runModel<K extends ModelSpecKind, TIn, TOpts, TOut>(
  def: ModelDefinition<K, TIn, TOpts, TOut>,
  input: TIn,
  spec: SpecOfKind<K>,
  opts: TOpts,
  now: Date,
): ModelRun<TOut> {
  const outputs = def.compute(input, spec, opts);
  const { parameters, upstream } = def.resolveOptions(spec, opts);
  const version = def.versionOf === undefined ? spec.version : def.versionOf(spec, opts);
  return createRun(def.legacyId, version, parameters, def.inputsOf(input), outputs, now, {
    upstream,
  });
}
