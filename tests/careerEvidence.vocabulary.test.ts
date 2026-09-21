/**
 * The vocabulary, enforced.
 *
 * Finding 7 divides two words: `longitudinal` is the time concept (monitoring
 * plans, checkpoints, cutoffs, residual slope) and `career-evidence` is the
 * judgment concept (claims, events, rubric, spec, dimensions). "Progress" was
 * a third word for the second one and is retired (#54 T8) — the grep below is
 * what keeps it retired, because a rename with an alias left behind is not a
 * rename.
 *
 * The dimension list is here for the same reason: it is the vocabulary the
 * rubric, the union and the Club-side adapter all have to agree on.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEVELS } from "../apps/club/lib/longitudinal/jev.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import type { CareerEvidenceDimension } from "../src/longitudinal/types.ts";

const LONGITUDINAL = join(import.meta.dir, "..", "src", "longitudinal");

describe('the word "progress" is retired', () => {
  test("no file under src/longitudinal contains it, in any case, anywhere", () => {
    const glob = new Bun.Glob("**/*.ts");
    const offenders: string[] = [];
    // Nothing is excluded: not comments, not prose, not a test fixture path.
    // The point of the rename is that the word has no meaning left here, so a
    // surviving mention is a surviving concept.
    for (const file of [...glob.scanSync({ cwd: LONGITUDINAL })].sort()) {
      const source = readFileSync(join(LONGITUDINAL, file), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (/progress/i.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the renamed names are the ones the barrel carries", async () => {
    const barrel = (await import("../src/index.ts")) as Record<string, unknown>;
    expect(typeof barrel.careerEvidenceVector).toBe("function");
    expect("progressVector" in barrel).toBe(false);
  });
});

describe("career-evidence dimension list", () => {
  test("CAREER_EVIDENCE_DIMENSIONS matches the LEVELS rubric keys", () => {
    expect([...CAREER_EVIDENCE_DIMENSIONS].sort()).toEqual(
      [...Object.keys(LEVELS)].sort() as CareerEvidenceDimension[],
    );
  });

  test("CAREER_EVIDENCE_DIMENSIONS matches the CareerEvidenceDimension union", () => {
    // This map is exhaustive by construction: adding a member to the union
    // without adding it here is a typecheck failure.
    const union: Record<CareerEvidenceDimension, true> = {
      difficulty: true,
      ownership: true,
      external_impact: true,
      originality: true,
      peer_validation: true,
    };
    expect([...CAREER_EVIDENCE_DIMENSIONS].sort()).toEqual(
      [...Object.keys(union)].sort() as CareerEvidenceDimension[],
    );
    expect(new Set(CAREER_EVIDENCE_DIMENSIONS).size).toBe(CAREER_EVIDENCE_DIMENSIONS.length);
  });

  test("MAX_LEVEL is the top of the shared rubric scale", () => {
    expect(MAX_LEVEL).toBe(4);
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(LEVELS[dimension].length).toBe(MAX_LEVEL + 1);
    }
  });
});
