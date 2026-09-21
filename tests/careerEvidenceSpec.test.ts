/**
 * The career-evidence rubric as a registered spec.
 *
 * The wording *is* the spec: a reworded level description changes what an
 * answer means, so `CAREER_EVIDENCE_V1_0_0` carries the text that shipped and
 * these tests pin it three ways — the rubric hash, the id derived from it, and
 * the requests the Club adapter actually sends, captured from the adapter
 * before it took the spec as an argument.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import {
  CAREER_EVIDENCE_V1_0_0,
  careerEvidenceRubricHash,
  careerEvidenceSpecId,
} from "../src/models/careerEvidence.ts";
import { isRegisteredSpec } from "../src/models/registry.ts";
import type { CareerEvidenceSpec } from "../src/models/spec.ts";
import { validateSpec } from "../src/models/spec.ts";

const ROOT = join(import.meta.dir, "..");

/**
 * The hash of the wording that shipped. If this line has to change, every
 * career event already stamped `career-evidence@1.0.0` has become
 * unreproducible — ship a new spec version instead of editing this one.
 */
const PINNED_RUBRIC_HASH = "6290bc28b1a9b5a61ecab7dc389203daf1d4527a5b1b5c7d20866a34e26bac97";

const spec = CAREER_EVIDENCE_V1_0_0;

/** A structurally-typed clone of the frozen spec, safe to mutate in a test. */
function mutableSpec(): CareerEvidenceSpec {
  return structuredClone(spec) as CareerEvidenceSpec;
}

/** The clone's `levels`, seen as the mutable map a broken spec would carry. */
function levelsOf(candidate: CareerEvidenceSpec): Record<string, string[]> {
  return candidate.levels as unknown as Record<string, string[]>;
}

function _errorsOf(candidate: CareerEvidenceSpec): string[] {
  const result = validateSpec(candidate);
  return result.ok ? [] : result.errors;
}

describe("CareerEvidenceSpec: registration", () => {
  test("the registered spec validates and is registered by id and by value", () => {
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(isRegisteredSpec(spec)).toBe(true);
  });

  test("the rubric hash is the wording that shipped", () => {
    expect(careerEvidenceRubricHash(spec)).toBe(PINNED_RUBRIC_HASH);
  });

  test("the spec id carries the version and the first eight hash digits", () => {
    expect(careerEvidenceSpecId(spec)).toBe(
      `career_evidence@1.0.0:${PINNED_RUBRIC_HASH.slice(0, 8)}`,
    );
  });

  test("editing one character of one level description changes the spec id", () => {
    const edited = mutableSpec();
    const rubric = levelsOf(edited).ownership as string[];
    const original = rubric[0] as string;
    rubric[0] = `${original.slice(0, -1)}!`;
    expect(rubric[0]).not.toBe(original);
    expect(rubric[0]).toHaveLength(original.length);
    expect(careerEvidenceSpecId(edited)).not.toBe(careerEvidenceSpecId(spec));
    // The version did not move; only the hash caught it.
    expect(edited.version).toBe(spec.version);
  });

  test("the spec is deeply frozen, so a level cannot be edited in place", () => {
    expect(Object.isFrozen(spec.levels.difficulty)).toBe(true);
    expect(Object.isFrozen(spec.eventCriteria)).toBe(true);
    expect(Object.isFrozen(spec.thresholds)).toBe(true);
  });

  test("the shared 0..MAX_LEVEL scale is the rubric length, for every dimension", () => {
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(spec.levels[dimension]).toHaveLength(MAX_LEVEL + 1);
    }
  });

  test("docs/models/CHANGELOG.md carries the career_evidence@1.0.0 entry", () => {
    const changelog = readFileSync(join(ROOT, "docs/models/CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## career_evidence@1.0.0");
    expect(changelog).toContain("- **Drift:**");
  });
});

/**
 * The longitudinal signal must never reach Referral Signal or capability code.
 * `src/models/registry.ts` side-effect-imports the model definitions, which
 * pull `scoring/`, `inference/` and `judges/` in behind them — so a
 * longitudinal module importing the registry drags the whole model graph into
 * the pipeline and into the Club (Next/Convex) bundle, transitively crossing a
 * boundary nothing crosses directly. The spec constant lives in a leaf module
 * for exactly this reason; these checks are textual, like tests/invariants.test.ts.
 */
describe("CareerEvidenceSpec: the spec module is a leaf", () => {
  const listTs = (dir: string): string[] => {
    const glob = new Bun.Glob("**/*.ts");
    return [...glob.scanSync({ cwd: join(ROOT, dir), absolute: true })].sort();
  };

  /** Strip block and line comments so prose never trips an import rule. */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const importsPath = (source: string, needle: string): boolean =>
    new RegExp(`from\\s+["'][^"']*${needle}[^"']*["']`).test(stripComments(source));

  const LONGITUDINAL = [...listTs("src/longitudinal"), ...listTs("apps/club/lib/longitudinal")];

  test("no longitudinal module imports the model registry or the definitions", () => {
    expect(LONGITUDINAL.length).toBeGreaterThan(0);
    for (const file of LONGITUDINAL) {
      const source = readFileSync(file, "utf8");
      const name = relative(ROOT, file);
      expect(importsPath(source, "models/registry"), `${name} imports models/registry`).toBe(false);
      expect(importsPath(source, "models/definitions"), `${name} imports models/definitions`).toBe(
        false,
      );
    }
  });

  test("the career-evidence spec module pulls in no model, scoring or inference code", () => {
    const source = readFileSync(join(ROOT, "src/models/careerEvidence.ts"), "utf8");
    for (const needle of [
      "scoring/",
      "inference/",
      "judges/",
      "models/registry",
      "./registry.ts",
      "models/definitions",
      "./definitions",
    ]) {
      expect(importsPath(source, needle), `careerEvidence.ts imports ${needle}`).toBe(false);
    }
  });

  test("at least one longitudinal module reads the spec, so the rule has teeth", () => {
    const pipeline = readFileSync(join(ROOT, "src/longitudinal/pipeline.ts"), "utf8");
    const adapter = readFileSync(join(ROOT, "apps/club/lib/longitudinal/jev.ts"), "utf8");
    expect(importsPath(pipeline, "models/careerEvidence")).toBe(true);
    expect(importsPath(adapter, "models/careerEvidence")).toBe(true);
  });
});
