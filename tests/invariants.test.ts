/**
 * Static checks over `src/` that encode the core invariants (PLAN.md §1).
 * Plain file reads + regexes; no runtime magic.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BANNED_LANGUAGE } from "../src/domain/constants.ts";
import { SPEC_HISTORY } from "../src/models/registry.ts";
import { specId } from "../src/models/spec.ts";

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
const LONGITUDINAL = SRC.filter((f) => f.includes("/src/longitudinal/"));

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
      "src/analysis/reviewQueue.ts", // categorical review buckets over both channels; no merged number
      // The pipeline's kind vocabulary: `RunOutputs` names each kind's
      // output type, so it imports both — as types only, and it computes
      // nothing. It is where `src/pipeline/advance.ts` used to be on this
      // list: since #55 T8 the orchestrator imports the two channels'
      // *runners*, not their result types, so it no longer meets the rule
      // this allow-list is about.
      "src/pipeline/kinds.ts",
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
});

describe("invariants: inputs", () => {
  test("scoring/ and inference/ never read affiliation, bio, or rubric Evaluations", () => {
    for (const f of [...SCORING, ...INFERENCE]) {
      const code = stripComments(read(f));
      for (const word of ["affiliation", "bio", "Evaluation"]) {
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

describe("invariants: longitudinal evidence boundaries", () => {
  test("core longitudinal modules do not import scoring, inference, SDKs, or network I/O", () => {
    expect(LONGITUDINAL.length).toBeGreaterThan(0);
    for (const f of LONGITUDINAL) {
      const code = stripComments(read(f));
      expect(importsFrom(code, "scoring"), rel(f)).toBe(false);
      expect(importsFrom(code, "inference"), rel(f)).toBe(false);
      expect(code.includes("@typesafe-ai/sdk"), rel(f)).toBe(false);
      expect(/\bfetch\s*\(/.test(code), rel(f)).toBe(false);
    }
  });

  test("Jev and source adapters stay in the Club app layer", () => {
    expect(read(join(ROOT, "apps/club/lib/longitudinal/jev.ts"))).toContain("@typesafe-ai/sdk");
    expect(read(join(ROOT, "apps/club/lib/longitudinal/sources.ts"))).toContain("fetch(");
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
  /**
   * The registry is read as data, not as text. The old version of this test
   * scraped `registry.ts` for `kind: "x", version: "y"` pairs, so a spec that
   * wrote its fields in another order, or carried a build tag (`0.2.0+env`),
   * was simply not seen — the invariant passed by failing to look. Every
   * shipped version is in `SPEC_HISTORY`; that is the list to iterate.
   */
  const changelog = read(join(ROOT, "docs/models/CHANGELOG.md"));

  /**
   * The CHANGELOG split into `## ` sections: heading title → body, the text
   * up to the next `## ` heading. `### ` subheadings stay inside their
   * section, which is what keeps a `**Drift:**` line attributable to the
   * version it is written under.
   */
  function sections(markdown: string): Map<string, string> {
    const headings = [...markdown.matchAll(/^## (.+)$/gm)];
    const map = new Map<string, string>();
    for (const [i, h] of headings.entries()) {
      const start = (h.index as number) + h[0].length;
      const end = (headings[i + 1]?.index as number | undefined) ?? markdown.length;
      map.set((h[1] as string).trim(), markdown.slice(start, end));
    }
    return map;
  }

  /** The section whose heading opens with exactly `kind@version`. */
  function entryFor(id: string): string | undefined {
    for (const [title, body] of sections(changelog)) {
      if (title.split(/\s/)[0] === id) return body;
    }
    return undefined;
  }

  test("every registered spec version has a CHANGELOG entry", () => {
    expect(SPEC_HISTORY.length).toBeGreaterThanOrEqual(3);
    for (const spec of SPEC_HISTORY) {
      const id = specId(spec);
      expect(entryFor(id) !== undefined, `docs/models/CHANGELOG.md has no "## ${id}" entry`).toBe(
        true,
      );
    }
  });

  /**
   * A `review` verdict fails nothing in CI — `bun run drift` exits 1 only on
   * `breaking`. What a review-grade change owes the reader is the report, in
   * the entry, so the line is required of every registered version.
   */
  test("every registered spec version records its drift report", () => {
    for (const spec of SPEC_HISTORY) {
      const id = specId(spec);
      const body = entryFor(id) ?? "";
      expect(/^\s*[-*]?\s*\*\*Drift:\*\*/m.test(body), `${id} has no **Drift:** line`).toBe(true);
    }
  });
});

describe("invariants: provenance is runtime-agnostic", () => {
  const PROVENANCE = SRC.filter((f) => f.includes("/src/provenance/"));

  test("no file under src/provenance imports from scoring/inference/models/judges", () => {
    expect(PROVENANCE.length).toBeGreaterThan(0);
    for (const f of PROVENANCE) {
      const source = stripComments(read(f));
      for (const segment of ["scoring", "inference", "models", "judges"]) {
        expect(importsFrom(source, segment), `${rel(f)} imports from ${segment}/`).toBe(false);
      }
    }
  });
});

// --- #56 T3: the inverted layering, now enforced (owner decision D2). -------
// `src/graph/` used to import `src/models/` and `src/scoring/`. Since T3 it
// imports nothing outside `src/domain/`, and `scoring → graph` is the only
// allowed direction: edge weights live in `scoring/scoredGraph.ts` and
// score-based selection in `analysis/graphSelection.ts`.
describe("invariants: referral graph layering (#56 D2)", () => {
  const GRAPH = SRC.filter((f) => f.includes("/src/graph/"));

  const importSpecifiers = (source: string): string[] =>
    [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] as string);

  test("src/graph/** imports nothing outside src/domain/", () => {
    expect(GRAPH.length).toBeGreaterThan(0);
    for (const f of GRAPH) {
      for (const spec of importSpecifiers(read(f))) {
        if (!spec.startsWith(".")) continue; // node: / package imports are not layering
        const ok = spec.startsWith("./") || spec.startsWith("../domain/");
        expect(ok, `${rel(f)} imports ${spec}`).toBe(true);
      }
    }
  });

  test("the dependency runs scoring → graph, never graph → scoring/models", () => {
    expect(GRAPH.length).toBeGreaterThan(0);
    for (const f of GRAPH) {
      const s = read(f);
      expect(importsFrom(s, "scoring"), `${rel(f)} imports scoring`).toBe(false);
      expect(importsFrom(s, "models"), `${rel(f)} imports models`).toBe(false);
    }
  });
});

// --- #55 T4: the orchestrator is pure, like the calibration it runs. -------
describe("invariants: the pipeline takes its time step as a parameter", () => {
  const PIPELINE = SRC.filter((f) => f.includes("/src/pipeline/"));

  test("src/pipeline never reads the clock; `now` is a parameter", () => {
    expect(PIPELINE.length).toBeGreaterThan(0);
    for (const f of PIPELINE) {
      const code = stripComments(read(f));
      expect(/Date\.now\(\)/.test(code), rel(f)).toBe(false);
      expect(/new Date\(\s*\)/.test(code), rel(f)).toBe(false);
    }
  });
});

// --- #55 T8: the kind vocabulary is a leaf, not the orchestrator. ---------
// `PipelineKind` / `isPipelineKind` live in `src/pipeline/kinds.ts`, which
// imports no value module at all. The CI gate script and the env bridge ask
// only "is this a kind a pass runs?", and answering it must not drag in
// `advance()` and everything it evaluates.
describe("invariants: the kind vocabulary is a leaf module (#55 T8)", () => {
  test("scripts/drift-gate.ts and src/config.ts do not import src/pipeline/advance.ts", () => {
    for (const path of ["scripts/drift-gate.ts", "src/config.ts"]) {
      const code = stripComments(read(join(ROOT, path)));
      const imports = /from\s+["'][^"']*\/pipeline\/advance\.ts["']/.test(code);
      expect(imports, `${path} imports the orchestrator`).toBe(false);
    }
  });
});
