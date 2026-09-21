import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as engine from "../apps/club/lib/engine.ts";

const root = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * The public surface of `apps/club/lib/engine.ts`, pinned to what it exported
 * before the file was split (commit 34cb4b3). Splitting the engine is allowed
 * to move code between modules; it is not allowed to move a name off this
 * list, because every caller in `apps/club`, `tests` and `scripts` imports
 * from `engine.ts` and nothing else.
 */
const ENGINE_EXPORTS = [
  "EXAMPLE_REQUIRED_DIMENSIONS",
  "EXAMPLE_T_END",
  "EXAMPLE_T_START",
  "INTERESTING_GAP",
  "OWNER_EVALUATOR_ID",
  "OWNER_NAME",
  "addComparison",
  "addEvaluation",
  "addPerson",
  "addReferral",
  "computeView",
  "decide",
  "emptyState",
  "initialState",
  "loadClub",
  "queueBuckets",
  "recordFeedback",
  "requestFeedback",
  "resetClub",
  "setReviewConfig",
  "setStatus",
  "wallClockNow",
];

/** Line budget for the orchestrator. The pre-split file was 1094 lines. */
const ENGINE_MAX_LINES = 200;

const engineModules = readdirSync(join(root, "apps/club/lib/engine"))
  .filter((f) => f.endsWith(".ts"))
  .sort();

describe("club engine layout", () => {
  test("engine.ts stays an orchestrator, not a monolith", () => {
    const lines = read("apps/club/lib/engine.ts").split("\n").length;
    expect(lines).toBeLessThanOrEqual(ENGINE_MAX_LINES);
  });

  test("the public surface is exactly what it was before the split", () => {
    expect(Object.keys(engine).sort()).toEqual(ENGINE_EXPORTS);
  });

  test("engine modules never import back into engine.ts", () => {
    expect(engineModules.length).toBeGreaterThan(1);
    for (const file of engineModules) {
      const text = read(`apps/club/lib/engine/${file}`);
      expect(text, `${file} must not import ../engine.ts`).not.toContain('"../engine.ts"');
    }
  });
});
