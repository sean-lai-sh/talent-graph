/**
 * Static checks over `src/` that encode the core invariants (PLAN.md §1).
 * Plain file reads + regexes; no runtime magic.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BANNED_LANGUAGE, PRODUCT_LANGUAGE } from "../src/domain/constants.ts";

const ROOT = join(import.meta.dir, "..");

function listTs(dir: string): string[] {
  const glob = new Bun.Glob("**/*.ts");
  return [...glob.scanSync({ cwd: join(ROOT, dir), absolute: true })].sort();
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Strip block and line comments so prose in docs never trips a code rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function rel(path: string): string {
  return relative(ROOT, path);
}

const SRC = listTs("src");
const SCORING = SRC.filter((f) => f.includes("/src/scoring/"));
const INFERENCE = SRC.filter((f) => f.includes("/src/inference/"));
const JUDGES = SRC.filter((f) => f.includes("/src/judges/"));

const importsFrom = (source: string, segment: string): boolean =>
  new RegExp(`from\\s+["'][^"']*/${segment}/[^"']*["']`).test(source);

describe("invariants: Referral Signal ≠ Relative Capability", () => {
  test("no file under src/scoring imports from src/inference", () => {
    for (const f of SCORING) {
      expect(importsFrom(read(f), "inference")).toBe(false);
    }
  });

  test("no file under src/inference imports from src/scoring", () => {
    for (const f of INFERENCE) {
      expect(importsFrom(read(f), "scoring")).toBe(false);
    }
  });

  test("only the explicit meeting points import from both scoring/ and inference/", () => {
    const allowed = new Set([
      "src/analysis/underRecognition.ts", // the diagnostic itself
      "src/analysis/dashboard.ts", // presentation of both, computes nothing
      "src/analysis/drift.ts", // compares runs of either kind (types only)
      "src/modelRun.ts", // wraps either kind in a ModelRun
      "src/index.ts", // public barrel
    ]);
    const both = SRC.filter((f) => {
      const s = read(f);
      return importsFrom(s, "scoring") && importsFrom(s, "inference");
    }).map(rel);
    for (const f of both) expect(allowed.has(f)).toBe(true);
    expect(both).toContain("src/analysis/underRecognition.ts");
  });
});

/** Body of `function name(...) { ... }` (first match). Nested braces included. */
function extractFunction(source: string, name: string): string | null {
  const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** True if a reliability / MSE field is assigned an expression that mentions slope/gain. */
function mixesSlopeIntoIntercept(code: string): boolean {
  return /(?:reliability|meanSquaredError)\s*(?:=|\+=|:)\s*[^\n,;]*\b(?:delta|gain|scoutGain)\b/.test(
    code,
  );
}

describe("invariants: judge calibration is grounded in outcomes, not in V1", () => {
  test("src/judges never imports from src/inference (no circular truth)", () => {
    expect(JUDGES.length).toBeGreaterThan(0);
    for (const f of JUDGES) expect(importsFrom(read(f), "inference"), rel(f)).toBe(false);
  });

  test("src/judges never reads the clock; the time step T is a parameter", () => {
    for (const f of JUDGES) {
      const code = stripComments(read(f));
      expect(/Date\.now\(\)/.test(code), rel(f)).toBe(false);
      expect(/new Date\(\s*\)/.test(code), rel(f)).toBe(false);
    }
  });

  test("scoring never imports from src/judges (weights are passed in)", () => {
    for (const f of SCORING) expect(importsFrom(read(f), "judges"), rel(f)).toBe(false);
  });

  test("src/inference never imports from src/judges (no slopes inside V1)", () => {
    for (const f of INFERENCE) expect(importsFrom(read(f), "judges"), rel(f)).toBe(false);
  });

  test("judges are never graded by agreement with other judges", () => {
    for (const f of JUDGES) {
      const code = stripComments(read(f));
      expect(/\bagreement\b/i.test(code), `${rel(f)} mentions agreement`).toBe(false);
    }
  });

  test("judges are never graded by θ or by capability percentiles as truth", () => {
    for (const f of JUDGES) {
      const code = stripComments(read(f));
      expect(/\btrueTheta\b/.test(code), `${rel(f)} references trueTheta`).toBe(false);
      expect(/\bcapabilityPercentile\b/i.test(code), `${rel(f)} uses capability percentiles`).toBe(
        false,
      );
    }
  });
});

describe("invariants: slope ≠ intercept (two judge numbers)", () => {
  test("no judges file adds delta/gain/scoutGain into reliability or meanSquaredError", () => {
    expect(JUDGES.length).toBeGreaterThan(0);
    for (const f of JUDGES) {
      const code = stripComments(read(f));
      expect(mixesSlopeIntoIntercept(code), rel(f)).toBe(false);
    }
  });

  test("ScoutInformationGain and JudgeReliabilityEstimate stay separate types", () => {
    const types = read(join(ROOT, "src/domain/types.ts"));
    const reliability = read(join(ROOT, "src/judges/reliability.ts"));
    expect(types).toMatch(/export interface ScoutInformationGain\b/);
    expect(reliability).toMatch(/export interface JudgeReliabilityEstimate\b/);
    expect(types.includes("export interface JudgeReliabilityEstimate")).toBe(false);
    expect(reliability.includes("export interface ScoutInformationGain")).toBe(false);
  });

  test("CURRENT_SPECS.judge_reliability.scoutHook stays false", async () => {
    const { CURRENT_SPECS } = await import("../src/models/registry.ts");
    expect(CURRENT_SPECS.judge_reliability.version).toBe("3.0.0");
    expect(CURRENT_SPECS.judge_reliability.scoutHook).toBe(false);
  });
});

describe("invariants: no synthesized comparisons from outcomes", () => {
  test("src/judges never constructs Comparison rows", () => {
    for (const f of JUDGES) {
      const code = stripComments(read(f));
      expect(/\bComparison\b/.test(code), `${rel(f)} names Comparison`).toBe(false);
    }
  });

  test("src/seed/outcomes.ts never writes Comparison rows", () => {
    const code = stripComments(read(join(ROOT, "src/seed/outcomes.ts")));
    expect(/\bComparison\b/.test(code)).toBe(false);
  });

  test("seed comparison generator does not read Outcome records", () => {
    const src = stripComments(read(join(ROOT, "src/seed/generate.ts")));
    const fn = extractFunction(src, "buildComparisons");
    expect(fn).toBeTruthy();
    expect(/\bOutcome\b|\boutcomes\b/.test(fn ?? "")).toBe(false);
  });
});

describe("invariants: language", () => {
  test("no banned phrase appears in src/ outside constants.ts", () => {
    for (const f of SRC) {
      if (f.endsWith("/domain/constants.ts")) continue;
      const s = read(f);
      for (const phrase of BANNED_LANGUAGE) {
        expect(s.includes(phrase), `${rel(f)} contains "${phrase}"`).toBe(false);
      }
    }
  });

  test("demo and presentation never use a collapsed product name", () => {
    const files = ["demo/index.html", "demo/app.js", "scripts/demo.ts", "scripts/demo-ui.ts"];
    for (const f of files) {
      const s = read(join(ROOT, f));
      for (const phrase of BANNED_LANGUAGE) {
        expect(s.includes(phrase), `${f} contains "${phrase}"`).toBe(false);
      }
    }
  });

  test("approved Phase E names exist as separate product phrases", () => {
    expect(PRODUCT_LANGUAGE.scoutInformationGain).toBe("Scout Information Gain");
    expect(PRODUCT_LANGUAGE.intensityCalibration).toBe("Intensity Calibration");
    expect(PRODUCT_LANGUAGE.judgeReliability).toBe("Judge Reliability");
    expect(PRODUCT_LANGUAGE.residualSlope).toBe("Residual Slope");
  });
});

describe("invariants: inputs", () => {
  test("scoring/ and inference/ never read affiliation, bio, rubric Evaluations, or forecastKind", () => {
    for (const f of [...SCORING, ...INFERENCE]) {
      const code = stripComments(read(f));
      for (const word of ["affiliation", "bio", "Evaluation", "forecastKind"]) {
        expect(new RegExp(`\\b${word}\\b`).test(code), `${rel(f)} references ${word}`).toBe(false);
      }
    }
  });

  test("scoring/ and inference/ never read the clock", () => {
    for (const f of [...SCORING, ...INFERENCE]) {
      const code = stripComments(read(f));
      expect(/Date\.now\(\)/.test(code), `${rel(f)} calls Date.now()`).toBe(false);
      expect(/new Date\(\s*\)/.test(code), `${rel(f)} calls new Date()`).toBe(false);
    }
  });

  test("scoring/ and inference/ take weights from a spec, not from constants", () => {
    for (const f of [...SCORING, ...INFERENCE]) {
      const code = stripComments(read(f));
      expect(/\bEVIDENCE_MULTIPLIER\b|\bREFERRAL_WEIGHTS\b/.test(code), rel(f)).toBe(false);
    }
  });
});

describe("invariants: no scalar collapse", () => {
  test("CapabilityVector exposes no aggregate field", () => {
    const code = stripComments(read(join(ROOT, "src/inference/capabilityVector.ts")));
    expect(/\b(overall|total|score)\s*:/.test(code)).toBe(false);
    expect(/\b(average|mean)Percentile\b/.test(code)).toBe(false);
  });
});

describe("invariants: hidden seed abilities stay out of the public surface", () => {
  const barrelSource = read(join(ROOT, "src/index.ts"));

  test("the barrel never names the generator-only modules or the hidden ability", () => {
    for (const needle of ["personaShapes", "prng", "trueTheta"]) {
      expect(barrelSource.includes(needle), `src/index.ts mentions ${needle}`).toBe(false);
    }
  });

  test("the barrel exports the seed API but no persona shape or hidden ability", async () => {
    const barrel = (await import("../src/index.ts")) as Record<string, unknown>;
    expect(typeof barrel.generateSeed).toBe("function");
    expect(Array.isArray(barrel.PERSONA_IDS)).toBe(true);
    expect(Array.isArray(barrel.PERSONA_PROFILES)).toBe(true);
    expect("PERSONAS" in barrel).toBe(false);
    expect("trueTheta" in barrel).toBe(false);
    expect("mulberry32" in barrel).toBe(false);
    const profiles = barrel.PERSONA_PROFILES as Array<Record<string, unknown>>;
    for (const p of profiles) {
      expect(Object.keys(p).sort()).toEqual(["affiliation", "bio", "id", "name"]);
    }
  });

  test("trueTheta is referenced only inside src/seed/", () => {
    for (const f of SRC) {
      if (f.includes("/src/seed/")) continue;
      expect(read(f).includes("trueTheta"), `${rel(f)} references trueTheta`).toBe(false);
    }
  });
});

describe("invariants: durable updates", () => {
  test("every registered spec version has a CHANGELOG entry", () => {
    const changelog = read(join(ROOT, "docs/models/CHANGELOG.md"));
    const registry = read(join(ROOT, "src/models/registry.ts"));
    const versions = [...registry.matchAll(/kind:\s*"(\w+)",\s*version:\s*"([\d.]+)"/g)];
    expect(versions.length).toBeGreaterThanOrEqual(3);
    for (const [, kind, version] of versions) {
      expect(changelog.includes(`${kind}@${version}`), `${kind}@${version} missing`).toBe(true);
    }
  });
});
