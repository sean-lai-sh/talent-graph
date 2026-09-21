/**
 * V1 Relative Capability (Bradley–Terry) as a model definition.
 *
 * `parameters` lists every input that can change the numbers, explicitly: an
 * anchored refit records the effective κ and a hash of the previous θ
 * values, so two refits against different priors never share an id.
 */

import { DIMENSIONS } from "../../domain/constants.ts";
import type { Comparison, Dimension, Person } from "../../domain/types.ts";
import {
  type CapabilityOptions,
  type CapabilityRun,
  computeCapabilityVectors,
} from "../../inference/capabilityVector.ts";
import { hashInputs } from "../../provenance/hash.ts";
import { defineModel, runModel } from "../define.ts";
import { CURRENT_SPECS } from "../registry.ts";
import type { ModelRun } from "../run.ts";

export type CapabilityRunOptions = CapabilityOptions & {
  /** Id of the ModelRun that `previous` came from, recorded for provenance. */
  previousRunId?: string;
};

export interface CapabilityInput {
  people: readonly Person[];
  comparisons: readonly Comparison[];
}

/**
 * Per-dimension θ maps of a previous run, in the form the anchor prior
 * consumes. Hashing this (rather than the whole run) fingerprints exactly
 * what influenced the refit.
 */
function previousThetas(previous: CapabilityRun): Record<Dimension, Map<string, number>> {
  const out = {} as Record<Dimension, Map<string, number>>;
  for (const d of DIMENSIONS) {
    out[d] = new Map(previous.runsByDimension[d].fits.map((f) => [f.personId, f.theta]));
  }
  return out;
}

/** The solver options, without the provenance-only `previousRunId`. */
function solverOptions(opts: CapabilityRunOptions): CapabilityOptions {
  const { previousRunId, ...capabilityOpts } = opts;
  return capabilityOpts;
}

export const bradleyTerryModel = defineModel<
  "bradley_terry",
  CapabilityInput,
  CapabilityRunOptions,
  CapabilityRun
>({
  name: "bradley_terry_v1",
  kind: "bradley_terry",
  legacyId: "bradley_terry_v1",
  specOf: (opts) => opts.spec ?? CURRENT_SPECS.bradley_terry,
  inputsOf: ({ people, comparisons }) => ({ people: people.map((p) => p.id), comparisons }),
  resolveOptions: (spec, opts) => {
    const { previous } = opts;
    return {
      parameters: {
        spec,
        minComparisons: opts.minComparisons ?? spec.minComparisons,
        minOpponents: opts.minOpponents ?? spec.minOpponents,
        tieHandling: opts.tieHandling ?? spec.tieHandling,
        anchored: previous !== undefined,
        // κ only bites when there is a prior to be pulled toward.
        anchorStrength: previous === undefined ? 0 : (opts.anchorStrength ?? spec.anchorStrength),
        bt: opts.bt ?? null,
        previousRunId: opts.previousRunId ?? null,
        // The prior is another run's output; its id alone would not say
        // which θ values it carried, so the θ map is hashed as well.
        previousThetaHash: previous === undefined ? null : hashInputs(previousThetas(previous)),
      },
      upstream:
        previous === undefined ? [] : [{ role: "previous", runId: opts.previousRunId ?? null }],
    };
  },
  compute: ({ people, comparisons }, spec, opts) =>
    computeCapabilityVectors(people, comparisons, { ...solverOptions(opts), spec }),
});

/** Relative Capability Estimates for everyone, wrapped in a ModelRun. */
export function runCapabilityVectors(
  people: readonly Person[],
  comparisons: readonly Comparison[],
  now: Date,
  opts: CapabilityRunOptions = {},
): ModelRun<CapabilityRun> {
  return runModel(
    bradleyTerryModel,
    { people, comparisons },
    bradleyTerryModel.specOf(opts),
    opts,
    now,
  );
}
