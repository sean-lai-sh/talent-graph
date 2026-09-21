import type { ProgressDimension } from "./types.ts";

/**
 * The single source of truth for the career-evidence progress dimensions.
 *
 * Every consumer (evidence pipeline, outcome translation, validation, and the
 * Club-side Jev adapter) reads this list so a new dimension cannot be added to
 * one copy and silently missed by the others.
 */
export const CAREER_EVIDENCE_DIMENSIONS = [
  "difficulty",
  "ownership",
  "external_impact",
  "originality",
  "peer_validation",
] as const satisfies readonly ProgressDimension[];

/** Compile-time guard: the list must cover the whole `ProgressDimension` union. */
type MissingDimension = Exclude<ProgressDimension, (typeof CAREER_EVIDENCE_DIMENSIONS)[number]>;
const _exhaustive: MissingDimension[] = [];
void _exhaustive;

/**
 * Highest value on the shared 0..MAX_LEVEL dimension scale. Judgment scores are
 * integers in `[0, MAX_LEVEL]`; normalising to `[0, 1]` divides by MAX_LEVEL.
 */
export const MAX_LEVEL = 4;
