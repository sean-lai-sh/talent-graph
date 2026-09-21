import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentSpecVersions, movedSpecs, mutatedSpecs } from "../scripts/drift-gate.ts";
import { CURRENT_SPECS } from "../src/models/registry.ts";
import type { ModelSpec } from "../src/models/spec.ts";

/** Two registry snapshots, as `kind → current version`. */
const BASE = { referral_signal: "0.1.0", bradley_terry: "1.0.0", judge_reliability: "2.0.0" };

describe("drift gate: which kinds moved", () => {
  test("an unchanged registry moves nothing", () => {
    expect(movedSpecs(BASE, { ...BASE })).toEqual([]);
  });

  test("one bumped kind is one move", () => {
    expect(movedSpecs(BASE, { ...BASE, referral_signal: "0.2.0" })).toEqual([
      { kind: "referral_signal", before: "0.1.0", after: "0.2.0" },
    ]);
  });

  test("several moves come back in kind order", () => {
    expect(
      movedSpecs(BASE, { ...BASE, referral_signal: "0.2.0", judge_reliability: "2.1.0" }),
    ).toEqual([
      { kind: "judge_reliability", before: "2.0.0", after: "2.1.0" },
      { kind: "referral_signal", before: "0.1.0", after: "0.2.0" },
    ]);
  });

  test("a build tag is a different version, and is compared as one", () => {
    expect(movedSpecs(BASE, { ...BASE, referral_signal: "0.1.0+env" })).toEqual([
      { kind: "referral_signal", before: "0.1.0", after: "0.1.0+env" },
    ]);
  });

  /**
   * A kind that only one side has cannot produce a drift report: there is no
   * pair of runs to compare. The gate says nothing about it rather than
   * inventing a baseline — the CHANGELOG invariant is what covers a new kind's
   * first version.
   */
  test("a kind added or removed is not a move", () => {
    expect(movedSpecs(BASE, { ...BASE, career_evidence: "1.0.0" })).toEqual([]);
    const { judge_reliability: _dropped, ...withoutJudge } = BASE;
    expect(movedSpecs(BASE, withoutJudge)).toEqual([]);
  });

  test("currentSpecVersions reads the version off each registered spec", () => {
    expect(currentSpecVersions(CURRENT_SPECS as unknown as Record<string, ModelSpec>)).toEqual({
      referral_signal: "0.1.0",
      bradley_terry: "1.0.0",
      judge_reliability: "2.0.0",
    });
  });

  test("a version bump is a move, not a mutation", () => {
    const base = [spec("referral_signal", "0.1.0", { topK: 5 })];
    const head = [...base, spec("referral_signal", "0.2.0", { topK: 7 })];
    expect(mutatedSpecs(base, head)).toEqual([]);
  });

  /** The real registry against itself: HEAD vs HEAD never fails the gate. */
  test("the live registry compared against itself moves nothing", () => {
    const live = currentSpecVersions(CURRENT_SPECS as unknown as Record<string, ModelSpec>);
    expect(movedSpecs(live, live)).toEqual([]);
  });
});

/** A throwaway spec-shaped object; only `kind`, `version` and content matter. */
function spec(kind: string, version: string, rest: Record<string, unknown> = {}): ModelSpec {
  return { kind, version, ...rest } as unknown as ModelSpec;
}

describe("drift gate: which shipped versions were edited in place", () => {
  const base = [
    spec("referral_signal", "0.1.0", { weights: { conviction: 0.5 }, topK: 5 }),
    spec("bradley_terry", "1.0.0", { regularization: 0.1 }),
  ];

  test("an untouched history has no mutations", () => {
    expect(
      mutatedSpecs(
        base,
        base.map((s) => ({ ...s })),
      ),
    ).toEqual([]);
  });

  test("a field changed under the same version is named", () => {
    const head = [
      spec("referral_signal", "0.1.0", { weights: { conviction: 0.6 }, topK: 5 }),
      base[1] as ModelSpec,
    ];
    expect(mutatedSpecs(base, head)).toEqual(["referral_signal@0.1.0"]);
  });

  test("several mutations come back sorted, by kind@version", () => {
    const head = [
      spec("referral_signal", "0.1.0", { weights: { conviction: 0.5 }, topK: 9 }),
      spec("bradley_terry", "1.0.0", { regularization: 0.2 }),
    ];
    expect(mutatedSpecs(base, head)).toEqual(["bradley_terry@1.0.0", "referral_signal@0.1.0"]);
  });

  test("a version present on one side only is not a mutation", () => {
    expect(
      mutatedSpecs(base, [...base, spec("judge_reliability", "2.0.0", { shrinkage: 3 })]),
    ).toEqual([]);
    expect(mutatedSpecs(base, [base[0] as ModelSpec])).toEqual([]);
  });

  /**
   * Field order is not content. The registry is data; a spec whose fields were
   * reordered is the same spec, and the gate must not cry mutation over a diff
   * that changes no number — `stableStringify` sorts keys for exactly this.
   */
  test("reordering a spec's fields is not a mutation", () => {
    const head = [
      { topK: 5, version: "0.1.0", weights: { conviction: 0.5 }, kind: "referral_signal" },
      base[1] as ModelSpec,
    ] as unknown as ModelSpec[];
    expect(mutatedSpecs(base, head)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The gate itself, run against real commits.
 *
 * Each case makes a throwaway detached worktree of HEAD, commits one edit
 * into it, and runs the gate there with HEAD as the base. What is under test
 * is the part no unit test can reach: that the base registry is *resolved*,
 * not read as a file path, so an edit that never touches `registry.ts` is
 * still seen.
 * ------------------------------------------------------------------ */

const ROOT = join(import.meta.dir, "..");
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${decode(proc.stderr)}`);
  return decode(proc.stdout).trim();
}

/** Commit `edit` in a detached worktree of HEAD, run the gate, clean up. */
function gateAfter(edit: (dir: string) => void): { exitCode: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "drift-gate-case-"));
  const headSha = git(ROOT, "rev-parse", "HEAD");
  try {
    git(ROOT, "worktree", "add", "--detach", "--quiet", dir, headSha);
    // The worktree is checked out at the committed HEAD; overlay this
    // checkout's `src/` and `scripts/` so the case exercises the gate as it
    // stands here, not as it was last committed. The *base* side stays the
    // commit, which is the comparison under test.
    for (const tree of ["src", "scripts"]) {
      Bun.spawnSync(["cp", "-a", `${join(ROOT, tree)}/.`, join(dir, tree)]);
    }
    edit(dir);
    git(dir, "add", "-A");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "case");
    // The worktree's *own* copy of the gate, so the head side it resolves is
    // the edited tree and not the checkout this test is running in.
    const proc = Bun.spawnSync(["bun", join(dir, "scripts", "drift-gate.ts"), "--base", headSha], {
      cwd: dir,
    });
    return {
      exitCode: proc.exitCode ?? -1,
      output: decode(proc.stdout) + decode(proc.stderr),
    };
  } finally {
    Bun.spawnSync(["git", "worktree", "remove", "--force", dir], { cwd: ROOT });
    rmSync(dir, { recursive: true, force: true });
  }
}

function edit(dir: string, path: string, from: string, to: string): void {
  const file = join(dir, path);
  const before = readFileSync(file, "utf8");
  if (!before.includes(from)) throw new Error(`${path} no longer contains ${from}`);
  writeFileSync(file, before.replace(from, to));
}

describe("drift gate: end to end", () => {
  test("a field edited under a shipped version fails, without a version bump to point at", () => {
    const { exitCode, output } = gateAfter((dir) =>
      edit(dir, "src/models/registry.ts", "  topK: 5,\n});", "  topK: 4,\n});"),
    );
    expect(output).toContain(
      "registered version referral_signal@0.1.0 was edited in place; ship a new version instead",
    );
    expect(exitCode).toBe(1);
  }, 60_000);

  /**
   * The finding the path short-circuit hid: `registry.ts` spreads
   * `REFERRAL_WEIGHTS`, so this commit changes what `referral_signal@0.1.0`
   * *is* while leaving `registry.ts` byte-identical.
   */
  test("a constants-only change to a shipped version's numbers fails too", () => {
    const { exitCode, output } = gateAfter((dir) =>
      edit(dir, "src/domain/constants.ts", "conviction: 0.5,", "conviction: 0.55,"),
    );
    expect(output).toContain("referral_signal@0.1.0 was edited in place");
    expect(output).not.toContain("bradley_terry");
    expect(exitCode).toBe(1);
  }, 60_000);

  test("a change that moves no spec passes", () => {
    const { exitCode, output } = gateAfter((dir) =>
      edit(
        dir,
        "src/models/registry.ts",
        "/** Every spec version ever shipped. Append only. */",
        "/** Every spec version ever shipped. Append only. (comment-only edit) */",
      ),
    );
    expect(output).toContain("no registered version was edited");
    expect(exitCode).toBe(0);
  }, 60_000);
});
