import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { driveBrowser } from "../.cursor/skills/verify-judge-weights/helpers/browser.ts";
import {
  checkAdmission,
  checkReferralSignal,
  checkSnapshots,
} from "../.cursor/skills/verify-judge-weights/helpers/checks.ts";
import {
  admissionPresent,
  type CheckResult,
  formatReport,
  formatResult,
  referralSignalPresent,
  SKIP_ADMISSION,
  SKIP_REFERRAL_SIGNAL,
  SKIP_SNAPSHOTS,
  snapshotsPresent,
  tally,
} from "../.cursor/skills/verify-judge-weights/helpers/detect.ts";
import { memberViewHits } from "../.cursor/skills/verify-judge-weights/helpers/member-view.ts";
import type { executeRun } from "../.cursor/skills/verify-judge-weights/helpers/run.ts";
import {
  type AssertNoWeightKeys,
  isWeightKey,
  scanWeightKeys,
} from "../.cursor/skills/verify-judge-weights/helpers/scan.ts";
import type {
  LadderAnchor,
  LadderStepView,
  LadderTraitView,
} from "../apps/club/lib/ladderPlacement.ts";
import type { DirectoryMember } from "../apps/club/lib/memberDirectory.ts";
import type { FeedbackInboxItem } from "../apps/club/lib/memberFeedback.ts";
import type { LookupDecision } from "../apps/club/lib/referralSignup.ts";

const repo = join(import.meta.dir, "..");

const _directory: AssertNoWeightKeys<DirectoryMember> = true;
const _inbox: AssertNoWeightKeys<FeedbackInboxItem> = true;
const _lookup: AssertNoWeightKeys<LookupDecision> = true;
const _step: AssertNoWeightKeys<LadderStepView> = true;
const _anchor: AssertNoWeightKeys<LadderAnchor> = true;
const _trait: AssertNoWeightKeys<LadderTraitView> = true;

type _Drive = typeof driveBrowser;
type _Run = typeof executeRun;

test("browser and run modules stay wired", () => {
  const drive: _Drive | null = null;
  const run: _Run | null = null;
  expect(drive).toBeNull();
  expect(run).toBeNull();
});

function writeMarker(root: string, rel: string, source: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
}

describe("weight key scan", () => {
  test("catches a nested w inside an array of objects", () => {
    const hits = scanWeightKeys({
      items: [{ meta: { w: 0.3 } }],
    });
    expect(hits).toEqual([{ path: "items[0].meta.w", key: "w" }]);
  });

  test("walks arrays of arrays to any depth", () => {
    const hits = scanWeightKeys({ rows: [[{ note: { omega: 0.2 } }]] });
    expect(hits.map((hit) => hit.path)).toEqual(["rows[0][0].note.omega"]);
  });

  test("matches exact w only", () => {
    expect(isWeightKey("w")).toBe(true);
    expect(isWeightKey("W")).toBe(false);
    expect(isWeightKey("weighting")).toBe(false);
    expect(isWeightKey("omega3")).toBe(false);
    const hits = scanWeightKeys({
      weighting: 1,
      W: 1,
      omega3: 1,
      trust: 1,
      note: "the weight is hidden in prose",
    });
    expect(hits).toEqual([]);
  });

  test("member view objects have no weight keys", () => {
    expect(_directory).toBe(true);
    expect(_inbox).toBe(true);
    expect(_lookup).toBe(true);
    expect(_step).toBe(true);
    expect(_anchor).toBe(true);
    expect(_trait).toBe(true);
    expect(memberViewHits()).toEqual([]);
  });
});

describe("engine checks enable from merged code", () => {
  test("this checkout skips #120 #122 and #123 and skips are not passes", async () => {
    process.env.VERIFY_JUDGE_WEIGHTS_ADMISSION = "1";
    process.env.VERIFY_JUDGE_WEIGHTS_SNAPSHOTS = "1";
    process.env.VERIFY_JUDGE_WEIGHTS_REFERRAL_SIGNAL = "1";
    expect(admissionPresent(repo)).toBe(false);
    expect(snapshotsPresent(repo)).toBe(false);
    expect(referralSignalPresent(repo)).toBe(false);

    const results: CheckResult[] = [
      { id: "admin-only-weights", status: "pass", detail: "clean" },
      await checkAdmission(repo),
      await checkSnapshots(repo),
      await checkReferralSignal(repo),
    ];
    expect(results[1]).toEqual({
      id: "admission-credit",
      status: "skipped",
      detail: SKIP_ADMISSION,
    });
    expect(results[2]).toEqual({ id: "snapshots", status: "skipped", detail: SKIP_SNAPSHOTS });
    expect(results[3]).toEqual({
      id: "referral-signal",
      status: "skipped",
      detail: SKIP_REFERRAL_SIGNAL,
    });
    expect(formatResult(results[1]!)).toBe("SKIPPED - needs #120 on main");
    expect(formatResult(results[2]!)).toBe("SKIPPED - needs #122 on main");
    expect(formatResult(results[3]!)).toBe("SKIPPED - needs #123 on main");
    expect(tally(results)).toEqual({ passed: 1, skipped: 3, failed: 0 });
    const report = formatReport(results);
    expect(report).toContain("PASS admin-only-weights");
    expect(report).toContain("passed 1\nskipped 3\nfailed 0\n");
    expect(report.match(/PASS /g)?.length).toBe(1);
  });

  test("markers in the tree turn each check on, env vars do not", () => {
    process.env.ADMISSION_CREDIT = "1";
    const empty = mkdtempSync(join(tmpdir(), "jw-empty-"));
    const full = mkdtempSync(join(tmpdir(), "jw-full-"));
    try {
      expect(admissionPresent(empty)).toBe(false);
      expect(snapshotsPresent(empty)).toBe(false);
      expect(referralSignalPresent(empty)).toBe(false);

      writeMarker(
        full,
        "src/judges/admission.ts",
        "export function computeAdmission() {}\ndecidedBy",
      );
      writeMarker(
        full,
        "src/scoring/signalWithout.ts",
        "export function signalWithoutEachReferrer() {}",
      );
      writeMarker(
        full,
        "apps/club/lib/engine/admission.ts",
        "export function admissionObservations() {}",
      );
      writeMarker(full, "apps/club/lib/engine/transitions.ts", "decidedBy: judge");
      expect(admissionPresent(full)).toBe(true);

      writeMarker(
        full,
        "apps/club/lib/longitudinal/evidenceSnapshots.ts",
        "export function planSnapshot() {}\nthin: true",
      );
      writeMarker(full, "apps/club/convex/crons.ts", "internal.evidence.daily");
      writeMarker(full, "apps/club/convex/evidence.ts", "export const daily = internalMutation(");
      expect(snapshotsPresent(full)).toBe(true);

      writeMarker(full, "src/models/registry.ts", "export const REFERRAL_SIGNAL_V0_2_0 = {}");
      writeMarker(full, "src/judges/reliability.ts", "export function judgePseudoWeight() {}");
      writeMarker(full, "src/scoring/referralSignal.ts", "pseudoWeight");
      expect(referralSignalPresent(full)).toBe(true);
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(full, { recursive: true, force: true });
    }
  });
});
