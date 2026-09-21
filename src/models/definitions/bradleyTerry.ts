/**
 * V1 Relative Capability (Bradley–Terry) as a model definition.
 *
 * `parameters` lists every input that can change the numbers, explicitly.
 * The prior of an anchored refit is another run's output, so it is recorded
 * as lineage rather than as a parameter: `upstreamRuns` carries
 * `{ role: "anchor", runId, digest }`, where the digest hashes the previous θ
 * values. Two refits against different priors therefore never share an id.
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
  specOf: (opts) => opts.spec ?? CURRENT_SPECS.bradley_terry,
  inputsOf: ({ people, comparisons }) => ({ people: people.map((p) => p.id), comparisons }),
  // Every option this model accounts for: the first six in `parameters`,
  // `previous`/`previousRunId` as lineage. `runModel` refuses anything else,
  // so a solver option added without a provenance answer fails loudly.
  recordedOptionKeys: [
    "spec",
    "minComparisons",
    "minOpponents",
    "tieHandling",
    "bt",
    "anchorStrength",
    "previous",
    "previousRunId",
  ],
  resolveOptions: (spec, opts) => {
    const { previous } = opts;
    // Naming a prior run without handing over its θ values leaves nothing to
    // digest: the refit is unanchored, and the claimed link would sit outside
    // the hash entirely. Refused rather than dropped.
    if (opts.previousRunId !== undefined && previous === undefined) {
      throw new Error(
        "previousRunId without `previous` on a bradley_terry run: " +
          "the named run supplied no prior, so it cannot be recorded as lineage",
      );
    }
    return {
      parameters: {
        spec,
        minComparisons: opts.minComparisons ?? spec.minComparisons,
        minOpponents: opts.minOpponents ?? spec.minOpponents,
        tieHandling: opts.tieHandling ?? spec.tieHandling,
        // κ only bites when there is a prior to be pulled toward. Whether
        // there is one is `upstreamRuns`, not a second boolean here.
        anchorStrength: previous === undefined ? 0 : (opts.anchorStrength ?? spec.anchorStrength),
        bt: opts.bt ?? null,
      },
      // The prior is another run's output; its id alone would not say which θ
      // values it carried, so the θ map is hashed into the digest as well.
      upstream:
        previous === undefined
          ? []
          : [
              {
                role: "anchor",
                runId: opts.previousRunId ?? null,
                digest: hashInputs(previousThetas(previous)),
              },
            ],
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
  return runModel(bradleyTerryModel, { people, comparisons }, opts, now);
}
