#!/usr/bin/env bun
/**
 * bun run scripts/drift-gate.ts [--base <ref>]
 *
 * The CI half of the drift gate. When a pull request does not touch
 * `src/models/registry.ts` it does nothing and succeeds — nothing shipped can
 * have moved. When it does, it asks which `CURRENT_SPECS` entries point at a
 * different version than they do on the base branch, and runs
 * `bun run drift -- --kind <k> --before <base> --after <head>` for each one.
 * A `breaking` verdict fails the job; `review` prints and passes, and owes a
 * `**Drift:**` line in `docs/models/CHANGELOG.md`, which
 * `tests/invariants.test.ts` requires of every registered version.
 *
 * The base side is read by materialising the base commit in a throwaway git
 * worktree and importing its `registry.ts`, rather than by parsing the file.
 * Parsing is what the old CHANGELOG invariant did, and a reordered field or a
 * build-tagged version walked straight past it; a spec object is data, and the
 * only faithful reader of a TypeScript module is the runtime. The worktree is
 * outside the checkout, so nothing is written into the tree under test, and
 * `registry.ts` imports only local modules, so no install is needed for it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelSpec } from "../src/models/spec.ts";

const ROOT = join(import.meta.dir, "..");
const REGISTRY = "src/models/registry.ts";

/** One `CURRENT_SPECS` entry whose version differs between two commits. */
export interface SpecMove {
  kind: string;
  before: string;
  after: string;
}

/** `CURRENT_SPECS` as `kind → version`, the only part the gate compares. */
export type SpecVersions = Readonly<Record<string, string>>;

export function currentSpecVersions(currentSpecs: Record<string, ModelSpec>): SpecVersions {
  const out: Record<string, string> = {};
  for (const [kind, spec] of Object.entries(currentSpecs)) out[kind] = spec.version;
  return out;
}

/**
 * The kinds whose current version moved, in kind order.
 *
 * A kind present only on the head side is new: there is no `before` to compare
 * it against, so it is not a move and not this gate's business (its first
 * CHANGELOG entry is). A kind present only on the base side was removed, which
 * likewise has no drift report — the registry is append-only, and a removal is
 * a review question, not a measurable one.
 */
export function movedSpecs(before: SpecVersions, after: SpecVersions): SpecMove[] {
  const moves: SpecMove[] = [];
  for (const kind of Object.keys(after).sort()) {
    const from = before[kind];
    const to = after[kind] as string;
    if (from !== undefined && from !== to) moves.push({ kind, before: from, after: to });
  }
  return moves;
}

/* ------------------------------------------------------------------ *
 * The CI run. Everything below touches git and the filesystem; the two
 * functions above are pure, and are what `tests/drift-gate.test.ts` covers.
 * ------------------------------------------------------------------ */

function git(...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${new TextDecoder().decode(proc.stderr)}`);
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

function registryChanged(base: string): boolean {
  const proc = Bun.spawnSync(["git", "diff", "--quiet", `${base}...HEAD`, "--", REGISTRY], {
    cwd: ROOT,
  });
  return proc.exitCode !== 0;
}

/** `CURRENT_SPECS` as of `ref`, read by importing it, not by parsing it. */
async function versionsAt(ref: string): Promise<SpecVersions> {
  const dir = mkdtempSync(join(tmpdir(), "drift-gate-"));
  try {
    git("worktree", "add", "--detach", "--quiet", dir, ref);
    const mod = (await import(join(dir, REGISTRY))) as {
      CURRENT_SPECS: Record<string, ModelSpec>;
    };
    return currentSpecVersions(mod.CURRENT_SPECS);
  } finally {
    Bun.spawnSync(["git", "worktree", "remove", "--force", dir], { cwd: ROOT });
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const i = process.argv.indexOf("--base");
  const base = i >= 0 ? (process.argv[i + 1] as string) : "origin/main";

  if (!registryChanged(base)) {
    console.log(`${REGISTRY} is unchanged against ${base}; nothing to compare.`);
    return 0;
  }

  const { CURRENT_SPECS } = (await import("../src/models/registry.ts")) as {
    CURRENT_SPECS: Record<string, ModelSpec>;
  };
  const moves = movedSpecs(await versionsAt(base), currentSpecVersions(CURRENT_SPECS));
  if (moves.length === 0) {
    console.log(`${REGISTRY} changed, but no CURRENT_SPECS version moved against ${base}.`);
    return 0;
  }

  let failed = 0;
  for (const move of moves) {
    const args = [
      "run",
      join(ROOT, "scripts", "drift.ts"),
      "--kind",
      move.kind,
      "--before",
      move.before,
      "--after",
      move.after,
      "--max-verdict",
      "review",
    ];
    console.log(`\n=== ${move.kind} ${move.before} → ${move.after}`);
    const proc = Bun.spawnSync(["bun", ...args], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (proc.exitCode !== 0) {
      failed++;
      console.error(`drift gate: ${move.kind} ${move.before} → ${move.after} did not pass.`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} of ${moves.length} moved spec(s) need a smaller change or a plan.`);
    return 1;
  }
  console.log(`\n${moves.length} moved spec(s) are at or below the review threshold.`);
  return 0;
}

if (import.meta.main) process.exit(await main());
