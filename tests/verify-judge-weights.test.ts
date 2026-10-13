import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { driveBrowser } from "../.cursor/skills/verify-judge-weights/helpers/browser.ts";
import {
  checkAdmission,
  checkReferralSignal,
  checkSnapshots,
} from "../.cursor/skills/verify-judge-weights/helpers/checks.ts";
import {
  formatDiscovered,
  gateQueries,
} from "../.cursor/skills/verify-judge-weights/helpers/classify.ts";
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
    expect(formatResult(results[1]!)).toBe("SKIPPED admission-credit - needs #120 on main");
    expect(formatResult(results[2]!)).toBe("SKIPPED snapshots - needs #122 on main");
    expect(formatResult(results[3]!)).toBe("SKIPPED referral-signal - needs #123 on main");
    expect(tally(results)).toEqual({ passed: 1, skipped: 3, failed: 0 });
    const report = formatReport(results);
    expect(report).toContain("SKIPPED admission-credit - needs #120 on main");
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

const SERVER_DTS = `import { internalQueryGeneric, queryGeneric } from "convex/server";
export declare const query: typeof queryGeneric;
export declare const internalQuery: typeof internalQueryGeneric;
`;

function apiDts(alias: string, spec: string, key: string): string {
  return `import type * as ${alias} from ${JSON.stringify(spec)};
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  ${JSON.stringify(key)}: typeof ${alias};
}>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
`;
}

function writeConvex(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "jw-q-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, "convex", rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return join(root, "convex");
}

describe("convex query discovery", () => {
  test("a query in a nested folder is found", () => {
    const convex = writeConvex({
      "_generated/server.d.ts": SERVER_DTS,
      "_generated/api.d.ts": apiDts("reports_hidden", "../reports/hidden.js", "reports/hidden"),
      "reports/hidden.ts": `import { query } from "../_generated/server";
export const peek = query({
  args: {},
  handler: async () => ({ label: "nested" }),
});
`,
    });
    try {
      const gate = gateQueries(convex, { allowlist: [] });
      expect(gate.failures).toEqual([]);
      expect(gate.rows.map((row) => `${row.audience} ${row.ref}`)).toEqual([
        "member reports/hidden:peek",
      ]);
    } finally {
      rmSync(join(convex, ".."), { recursive: true, force: true });
    }
  });

  test("a query behind a custom wrapper is found", () => {
    const convex = writeConvex({
      "_generated/server.d.ts": SERVER_DTS,
      "_generated/api.d.ts": apiDts("wrappers", "../wrappers.js", "wrappers"),
      "wrappers.ts": `import { query } from "./_generated/server";

function adminQuery(definition: Parameters<typeof query>[0]) {
  const registered = query(definition);
  return registered;
}

export const hidden = adminQuery({
  args: {},
  handler: async () => ({ ok: true }),
});
`,
    });
    try {
      const gate = gateQueries(convex, { allowlist: [] });
      expect(gate.failures).toEqual([]);
      expect(gate.rows.map((row) => `${row.audience} ${row.ref}`)).toEqual([
        "member wrappers:hidden",
      ]);
    } finally {
      rmSync(join(convex, ".."), { recursive: true, force: true });
    }
  });

  test("an unclassifiable query fails the run", () => {
    const convex = writeConvex({
      "_generated/server.d.ts": SERVER_DTS,
      "_generated/api.d.ts": apiDts("mystery", "../mystery.js", "mystery"),
      "mystery.ts": `import { query } from "./_generated/server";
export const leak = query({
  args: {},
  handler: async () => computeView(null),
});
function computeView(_state: unknown) {
  return { w: 1 };
}
`,
    });
    try {
      const gate = gateQueries(convex, { allowlist: [] });
      expect(gate.rows.find((row) => row.ref === "mystery:leak")?.audience).toBe("unclassified");
      expect(gate.failures.join("\n")).toContain("unclassifiable query mystery:leak");
      const failed: CheckResult = {
        id: "admin-only-weights",
        status: "fail",
        detail: gate.failures.join("; "),
      };
      expect(formatResult(failed)).toContain("mystery:leak");
      expect(formatResult(failed).startsWith("FAIL admin-only-weights")).toBe(true);
    } finally {
      rmSync(join(convex, ".."), { recursive: true, force: true });
    }
  });

  test("an admin-only annotation and the allowlist classify a query", () => {
    const source = `import { query } from "./_generated/server";
/** verify-judge-weights: admin-only */
export const marked = query({
  args: {},
  handler: async () => ({ ok: true }),
});
export const plain = query({
  args: {},
  handler: async () => ({ ok: true }),
});
`;
    const convex = writeConvex({
      "_generated/server.d.ts": SERVER_DTS,
      "_generated/api.d.ts": apiDts("mod", "../mod.js", "mod"),
      "mod.ts": source,
    });
    try {
      const annotated = gateQueries(convex, { allowlist: [] });
      expect(annotated.failures).toEqual([]);
      expect(annotated.rows.find((row) => row.ref === "mod:marked")?.audience).toBe("admin");
      expect(annotated.rows.find((row) => row.ref === "mod:plain")?.audience).toBe("member");
      const listed = gateQueries(convex, { allowlist: ["mod:plain"] });
      expect(listed.failures).toEqual([]);
      expect(listed.rows.find((row) => row.ref === "mod:plain")?.audience).toBe("admin");
    } finally {
      rmSync(join(convex, ".."), { recursive: true, force: true });
    }
  });

  test("this checkout classifies every generated query", () => {
    const gate = gateQueries(join(repo, "apps/club/convex"));
    expect(gate.failures).toEqual([]);
    expect(gate.rows.map((row) => `${row.audience} ${row.ref}`)).toEqual([
      "member auth:getCurrentUser",
      "admin club:getBoard",
      "member club:getMyRole",
      "admin club:getOrganization",
      "member club:listMembers",
      "member club:listMyFeedback",
      "member club:listPosts",
      "member comparisonStep:getComparisonStep",
      "internal grokCompanyResearch:reply",
      "member referral:lookupReferralContact",
      "member referral:referralStatus",
    ]);
    const lines = formatDiscovered(gate.rows);
    expect(lines[0]).toBe("queries discovered 11 (member 8, admin 2, internal 1, unclassified 0)");
    expect(gate.rows.find((row) => row.ref === "club:getBoard")?.argsEmpty).toBe(true);
    expect(gate.rows.find((row) => row.ref === "comparisonStep:getComparisonStep")?.argsEmpty).toBe(
      false,
    );
  });
});
