#!/usr/bin/env bun
/**
 * bun run scripts/drift-gate.ts [--base <ref>]
 *
 * The CI half of the drift gate. It resolves the registry on both sides of a
 * pull request — the merge base of `--base` and HEAD, against HEAD — and asks
 * two questions of the pair:
 *
 *  1. Was a *shipped* version edited? `SPEC_HISTORY` is append-only: a version
 *     that exists on both sides must have identical content, because a run
 *     recorded under `kind@version` is only reproducible if that version still
 *     means what it meant. A content difference under an unchanged version is
 *     a rule violation, not a drift verdict, and fails the job outright — no
 *     threshold can make it acceptable.
 *  2. Did a `CURRENT_SPECS` version *move*? Then
 *     `bun run drift -- --kind <k> --before <base> --after <head>` reports what
 *     the move does to the numbers. A `breaking` verdict fails the job;
 *     `review` prints and passes, and owes a `**Drift:**` line in
 *     `docs/models/CHANGELOG.md`, which `tests/invariants.test.ts` requires of
 *     every registered version.
 *
 * Both sides are *resolved*, never parsed, and never short-circuited on a file
 * path. `registry.ts` spreads `REFERRAL_WEIGHTS` and `EVIDENCE_MULTIPLIER` from
 * `src/domain/constants.ts`, so a commit that touches only `constants.ts`
 * changes what `referral_signal@0.1.0` *is* while leaving `registry.ts`
 * byte-identical — a path-scoped diff would wave it through. Such a commit now
 * fails as an in-place edit of a shipped version, which is exactly what it is.
 *
 * The base side is read by materialising the merge-base commit in a throwaway
 * git worktree and importing its `registry.ts`. A spec object is data, and the
 * only faithful reader of a TypeScript module is the runtime: a reordered
 * field or a build-tagged version walks straight past a regex. The worktree is
 * outside the checkout, so nothing is written into the tree under test, and
 * `registry.ts` imports only local modules, so no install is needed for it.
 *
 * The comparison is against the merge base rather than the base tip, so a base
 * branch that already carries the same bump is not misread as "nothing moved".
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelSpec, specId } from "../src/models/spec.ts";
import { stableStringify } from "../src/provenance/hash.ts";

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

/** The two sides of a registry comparison, each resolved by importing it. */
export interface RegistrySnapshot {
  current: SpecVersions;
  history: readonly ModelSpec[];
}

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

/**
 * The `kind@version` ids that exist on both sides with different content —
 * versions edited in place.
 *
 * Content is compared with `stableStringify`, the same key-sorting serializer
 * the run ids are built from, so reordering a spec's fields is not a mutation:
 * the registry is data, and only a changed value is a changed version. A
 * version that only one side has is not compared at all — that is a new
 * version (or a removed one), which the `movedSpecs` arm and the CHANGELOG
 * invariant speak to instead.
 */
export function mutatedSpecs(base: readonly ModelSpec[], head: readonly ModelSpec[]): string[] {
  const byId = (specs: readonly ModelSpec[]) => new Map(specs.map((s) => [specId(s), s]));
  const baseById = byId(base);
  const mutated: string[] = [];
  for (const [id, spec] of byId(head)) {
    const was = baseById.get(id);
    if (was !== undefined && stableStringify(was) !== stableStringify(spec)) mutated.push(id);
  }
  return mutated.sort();
}

/**
 * The `kind@version` ids the base had and the head does not — versions
 * deleted from `SPEC_HISTORY`.
 *
 * Append-only has two halves, and a deletion is the quieter one: the entry
 * simply stops existing, `CURRENT_SPECS` can be untouched, and every run ever
 * recorded under that id becomes unresolvable (`getSpec` throws) with nothing
 * in the diff that names a number. It is the same rule violation as an
 * in-place edit and is refused the same way.
 */
export function removedSpecs(base: readonly ModelSpec[], head: readonly ModelSpec[]): string[] {
  const present = new Set(head.map((s) => specId(s)));
  return base
    .map((s) => specId(s))
    .filter((id) => !present.has(id))
    .sort();
}

/* ------------------------------------------------------------------ *
 * The CI run. Everything below touches git and the filesystem; the four
 * functions above are pure, and are what `tests/drift-gate.test.ts` covers.
 * ------------------------------------------------------------------ */

function git(...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${new TextDecoder().decode(proc.stderr)}`);
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

function snapshotOf(mod: unknown): RegistrySnapshot {
  const { CURRENT_SPECS, SPEC_HISTORY } = mod as {
    CURRENT_SPECS: Record<string, ModelSpec>;
    SPEC_HISTORY: readonly ModelSpec[];
  };
  return { current: currentSpecVersions(CURRENT_SPECS), history: SPEC_HISTORY };
}

/** The registry as of `ref`, read by importing it, not by parsing it. */
async function snapshotAt(ref: string): Promise<RegistrySnapshot> {
  const dir = mkdtempSync(join(tmpdir(), "drift-gate-"));
  try {
    git("worktree", "add", "--detach", "--quiet", dir, ref);
    return snapshotOf(await import(join(dir, REGISTRY)));
  } finally {
    Bun.spawnSync(["git", "worktree", "remove", "--force", dir], { cwd: ROOT });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run the drift report for one move; true when it passed. */
function driftPasses(move: SpecMove): boolean {
  console.log(`\n=== ${move.kind} ${move.before} → ${move.after}`);
  const proc = Bun.spawnSync(
    [
      "bun",
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
    ],
    { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
  );
  return proc.exitCode === 0;
}

async function main(): Promise<number> {
  const i = process.argv.indexOf("--base");
  const base = i >= 0 ? (process.argv[i + 1] as string) : "origin/main";
  const mergeBase = git("merge-base", base, "HEAD");
  console.log(`drift gate: HEAD against ${base}, at merge base ${mergeBase}.`);

  const before = await snapshotAt(mergeBase);
  const after = snapshotOf(await import("../src/models/registry.ts"));

  // A shipped version that was rewritten or deleted. Checked first and on its
  // own: it is a rule violation, and there is no baseline left to measure the
  // change against — the spec that would have been the "before" is the one
  // that was overwritten or removed.
  const mutated = mutatedSpecs(before.history, after.history);
  const removed = removedSpecs(before.history, after.history);
  if (mutated.length > 0 || removed.length > 0) {
    for (const id of mutated) {
      console.error(`registered version ${id} was edited in place; ship a new version instead`);
    }
    for (const id of removed) {
      console.error(
        `registered version ${id} was removed from SPEC_HISTORY; history is append-only`,
      );
    }
    console.error(
      "\nSPEC_HISTORY is append-only: a run recorded under one of those ids is no longer\n" +
        "reproducible from its own record — getSpec() cannot resolve a version that was\n" +
        "deleted, and resolves a rewritten one to numbers that are not the ones it ran\n" +
        "with. Add a new version, with a CHANGELOG entry.\n" +
        "A version's numbers can move from src/domain/constants.ts without registry.ts\n" +
        "changing at all — that counts, and is why this gate resolves specs instead of\n" +
        "diffing file paths.",
    );
    return 1;
  }

  // A current version that moved: measurable, so it is measured.
  const moves = movedSpecs(before.current, after.current);
  if (moves.length === 0) {
    console.log(
      `no registered version was edited and no CURRENT_SPECS version moved against ${mergeBase}.`,
    );
    return 0;
  }

  const failed = moves.filter((move) => !driftPasses(move));
  for (const move of failed) {
    console.error(`drift gate: ${move.kind} ${move.before} → ${move.after} did not pass.`);
  }
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${moves.length} moved spec(s) need a smaller change or a plan.`,
    );
    return 1;
  }
  console.log(`\n${moves.length} moved spec(s) are at or below the review threshold.`);
  return 0;
}

if (import.meta.main) process.exit(await main());
