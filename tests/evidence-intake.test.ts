import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ClaimJudgment,
  judgeClaimsV12,
} from "../apps/club/lib/longitudinal/claimJudgmentV12.ts";
import {
  claimsAtCutoff,
  currentSnapshot,
  evidenceCutoff,
  planSnapshot,
  type SnapshotKind,
  type SnapshotRow,
  type StoredSnapshot,
} from "../apps/club/lib/longitudinal/evidenceSnapshots.ts";
import {
  evidenceKeyParts,
  githubUsername,
  ongoingJobKeys,
  resumeEvidence,
  versionDigest,
} from "../apps/club/lib/longitudinal/evidenceSources.ts";
import {
  claimLines,
  type LineRole,
  parsesAsResume,
  rawResumeLines,
  rebuildResumeLines,
} from "../apps/club/lib/longitudinal/resumeLines.ts";
import { fetchGitHubArtifacts } from "../apps/club/lib/longitudinal/sources.ts";
import { preprocessJobClaims } from "../src/longitudinal/claimPreprocess.ts";
import { OUTPUT_ONLY_ROLLUP_V1_0_0, outputOnlyRollup } from "../src/longitudinal/outputOnly.ts";
import type { JevJudgmentRecord } from "../src/longitudinal/records.ts";
import { createDeployment, type FakeDeployment } from "./fixtures/fakeConvex.ts";

const root = join(import.meta.dir, "..");

const realJevClient = await import("../apps/club/lib/longitudinal/jevClient.ts");
const als = new AsyncLocalStorage<string>();
let jevFactory: () => FakeJev = () => {
  throw new Error("no fake Jev client installed");
};
mock.module("../apps/club/lib/longitudinal/jevClient.ts", () => ({
  ...realJevClient,
  createJevClient: () => jevFactory(),
}));
const realClub = await import("../apps/club/convex/club.ts");
mock.module("../apps/club/convex/club.ts", () => ({
  ...realClub,
  requireAdmin: async () => ({ _id: "admin" }),
}));
const evidence = await import("../apps/club/convex/evidence.ts");
const { internal } = await import("../apps/club/convex/_generated/api");
const { getFunctionName } = await import("../apps/club/node_modules/convex/server");
afterAll(() => {
  // mock.module is process-wide; leave the real client for other files.
  mock.module("../apps/club/lib/longitudinal/jevClient.ts", () => realJevClient);
  mock.module("../apps/club/convex/club.ts", () => realClub);
});

interface JevOptions {
  model?: string;
  level?: (text: string) => number;
  delay?: () => Promise<void>;
  // "invariant": a response with no role, rejected the same way every time. "transient": a 503.
  // "no-usage" and "no-model": a response missing that metadata.
  fail?: (text: string) => "invariant" | "transient" | "no-usage" | "no-model" | null;
}

function levelBlock(score: number) {
  const probabilities = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, i === score ? 1 : 0]));
  const legend = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, `level ${i}`]));
  return { score, confidence: 0.9, probabilities, legend };
}

function classBlock(choice: "selection" | "output") {
  return {
    choice,
    confidence: 0.9,
    probabilities: {
      selection: choice === "selection" ? 1 : 0,
      output: choice === "output" ? 1 : 0,
      both: 0,
    },
  };
}

const defaultLevel = (text: string) => (/ambitious/i.test(text) ? 4 : /toy/i.test(text) ? 1 : 2);

class FakeJev {
  claimCalls = 0;
  labelCalls = 0;
  readonly texts: string[] = [];
  constructor(private readonly options: JevOptions = {}) {}

  systemOne(request: { state: Record<string, unknown>; questions: Record<string, unknown> }) {
    return {
      withResponse: async () => {
        await this.options.delay?.();
        const model = this.options.model ?? "fake-model";
        const usage = { input_tokens: 10, output_tokens: 5 };
        if (Object.keys(request.questions).some((key) => key.startsWith("line_"))) {
          this.labelCalls += 1;
          const lines = request.state.lines as string[];
          const answers = Object.fromEntries(
            lines.map((line, offset) => {
              const text = line.replace(/^\d+: /, "");
              const role = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)
                ? "dates"
                : /intern|engineer|assistant/i.test(text) && text.length < 40
                  ? "job_title"
                  : /corp|inc|lab/i.test(text) && text.length < 40
                    ? "organization"
                    : "bullet";
              return [`line_${offset}`, { choice: role, confidence: 1, probabilities: {} }];
            }),
          );
          return { data: { model, answers, usage }, requestId: "req-label" };
        }
        this.claimCalls += 1;
        const text = String(request.state.text);
        this.texts.push(text);
        const failure = this.options.fail?.(text) ?? null;
        if (failure === "transient") throw new Error("Jev request failed: 503");
        const score = (this.options.level ?? defaultLevel)(text);
        let answers: unknown;
        if ("selectivity" in request.questions) {
          answers = {
            claim_class: classBlock("selection"),
            selectivity: levelBlock(3),
            pool_strength: levelBlock(2),
          };
        } else if ("difficulty" in request.questions) {
          answers = {
            claim_class: classBlock("output"),
            difficulty: levelBlock(score),
            scale: levelBlock(score),
            role:
              failure === "invariant"
                ? undefined
                : {
                    choice: "major_contributor",
                    confidence: 0.9,
                    probabilities: {
                      original_author: 0,
                      major_contributor: 1,
                      maintainer: 0,
                      minor_part: 0,
                    },
                  },
          };
        } else {
          answers = { claim_class: classBlock("output") };
        }
        return {
          data: {
            model: failure === "no-model" ? undefined : model,
            answers,
            usage: failure === "no-usage" ? undefined : usage,
          },
          requestId: "req-claim",
        };
      },
    };
  }
}

const T0 = new Date("2025-01-10T00:00:00.000Z");
const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);
const PERSON = "p1";

interface Repo {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  stargazers_count?: number;
}

const RESUME_ONE = [
  "Software Engineer Intern at Acme Corp (Jun 2024 - Aug 2024)",
  "- Built an ambitious payment pipeline serving 10,000 daily users",
  "- Cut latency in the checkout service by 40 percent",
].join("\n");

const RESUME_TWO = [
  RESUME_ONE,
  "Research Assistant at Lab Z (Jan 2024 - Mar 2024)",
  "- Designed an ambitious experiment on protein folding",
].join("\n");

const RESUME_MIXED = [
  RESUME_ONE,
  "Research Assistant",
  "Lab Z",
  "Jan 2024 - Mar 2024",
  "- Designed an ambitious experiment on protein folding",
].join("\n");

const RESUME_UNPARSED = [
  "Software Engineer Intern",
  "Acme Corp",
  "Jun 2024 - Aug 2024",
  "Built an ambitious payment pipeline serving 10,000 daily users",
].join("\n");

function repo(partial: Partial<Repo> = {}): Repo {
  return {
    id: 101,
    name: "lamp",
    description: "A small lamp controller",
    created_at: "2025-01-10T10:00:00Z",
    updated_at: "2025-01-12T10:00:00Z",
    ...partial,
  };
}

function world(options: { github?: string | null; before?: string[] } = {}) {
  const state = {
    texts: new Map<string, string>(),
    repos: [] as Repo[],
    githubFails: false,
    failingHandles: new Set<string>(),
    urls: [] as string[],
    storageCount: 0,
    jev: new FakeJev(),
  };
  jevFactory = () => state.jev;
  const d: FakeDeployment = createDeployment({
    evidence: evidence as never,
    getFunctionName: (ref) => getFunctionName(ref as never),
    external: {
      [getFunctionName(internal.evidenceNode.extractResumeText)]: async (args) =>
        state.texts.get((args as { storageId: string }).storageId) ?? null,
      [getFunctionName(internal.evidenceNode.fetchGitHub)]: async (args) => {
        const { username } = args as { username: string };
        if (state.githubFails || state.failingHandles.has(username)) {
          throw new Error("GitHub request failed: 503");
        }
        return await fetchGitHubArtifacts(username, new Date(0), new Date(), async (url) => {
          state.urls.push(url);
          return url.includes("/repos")
            ? state.repos.map((r) => ({
                ...r,
                full_name: `alice/${r.name}`,
                html_url: `https://github.com/alice/${r.name}`,
                fork: false,
              }))
            : [];
        });
      },
      [getFunctionName(internal.evidenceNode.requestCompanyResearch)]: async () => ({ runs: 0 }),
    },
  });
  const ready = (async () => {
    const clubId = await d.db.insert("clubs", { name: "Club" });
    for (const id of options.before ?? []) {
      await d.db.insert("clubPeople", {
        clubId,
        id,
        status: "candidate",
        github: id,
        createdAt: T0.toISOString(),
      });
    }
    await d.db.insert("clubPeople", {
      clubId,
      id: PERSON,
      status: "candidate",
      github: options.github === undefined ? "alice" : (options.github ?? undefined),
      createdAt: T0.toISOString(),
    });
  })();
  const person = async () => {
    await ready;
    const row = d.db.rows("clubPeople")[0];
    if (!row) throw new Error("no person");
    return row;
  };
  return {
    d,
    state,
    async upload(text: string) {
      await ready;
      state.storageCount += 1;
      const storageId = `storage-${state.storageCount}`;
      d.db.addStorage(storageId, Date.now());
      state.texts.set(storageId, text);
      await d.db.patch((await person())._id, { resumeStorageId: storageId });
      return storageId;
    },
    async check(personId = PERSON) {
      await ready;
      return (await d.call("evidence:check", { personId })) as {
        scored: number;
        snapshots: number;
        githubFailed: boolean;
      } | null;
    },
    async intake(personId = PERSON) {
      await ready;
      return await d.call("evidence:intake", { personId });
    },
    async daily() {
      return (await this.dailyPeople()).length;
    },
    async dailyPeople() {
      await ready;
      d.scheduled.length = 0;
      await d.call("evidence:daily", {});
      const runs = d.scheduled.filter((entry) => entry.name === "evidence:check");
      for (const run of runs) await d.call("evidence:check", run.args);
      return runs.map((run) => (run.args as { personId: string }).personId);
    },
    snapshots(kind?: string) {
      return d.db
        .rows("evidenceSnapshots")
        .filter((row) => kind === undefined || row.kind === kind);
    },
    current(kind: SnapshotKind) {
      const rows = d.db.rows("evidenceSnapshots") as unknown as StoredSnapshot[];
      return currentSnapshot(rows, kind)?.id ?? null;
    },
    intakeRow(personId = PERSON) {
      const row = d.db.rows("evidenceIntakes").find((intake) => intake.personId === personId);
      if (!row) throw new Error("no intake row");
      return row;
    },
    judgments() {
      return d.db.rows("jevJudgments");
    },
    parsed(): ClaimJudgment[] {
      return d.db.rows("jevJudgments").map((row) => ({
        record: JSON.parse(String(row.record)),
        claim: JSON.parse(String(row.claim)),
        answer: JSON.parse(String(row.answer)),
        probe: row.probe === null ? null : JSON.parse(String(row.probe)),
        configHash: String(row.configHash),
        companySeedHash: String(row.companySeedHash),
      }));
    },
  };
}

const cleanups: (() => void)[] = [];
function afterEachOnce(cleanup: () => void) {
  cleanups.push(cleanup);
}

beforeEach(() => {
  setSystemTime(day(1));
});
afterEach(() => {
  setSystemTime();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function judge(text: string, client = new FakeJev(), known: ClaimJudgment[] = []) {
  const run = await judgeClaimsV12({
    personId: PERSON,
    evidence: resumeEvidence(claimLines(rawResumeLines(text), "2025-01-01T00:00:00.000Z")),
    known,
    client: client as never,
    now: () => new Date("2025-01-01T00:00:00.000Z"),
  });
  return run.written;
}

function plan(judgments: readonly ClaimJudgment[], kind: "s0" | "s12" = "s0"): SnapshotRow {
  const row = planSnapshot({
    candidateId: PERSON,
    kind,
    intakeAt: T0,
    now: day(61),
    claims: judgments.map((j) => j.claim),
    records: judgments.map((j) => j.record),
    resumeKeys: new Set(judgments.map((j) => j.record.evidenceKey)),
    existing: [],
    classYear: null,
    newId: () => "snap-test",
  });
  if (row === null) throw new Error("no snapshot planned");
  return row;
}

describe("snapshots are frozen", () => {
  test("a snapshot's numbers never change after it is written; only a new correction row supersedes it", async () => {
    const w = world();
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const [s0] = w.snapshots("s0");
    expect(s0).toBeDefined();
    const frozen = structuredClone(s0);

    setSystemTime(day(80));
    await w.upload(RESUME_TWO);
    await w.daily();
    setSystemTime(day(400));
    await w.daily();

    const s0Rows = w.snapshots("s0");
    expect(s0Rows.length).toBe(2);
    expect(s0Rows[0]).toEqual(frozen);
    expect(s0Rows[1]?.correctsSnapshotId).toBe(String(frozen?.id));
    expect(s0Rows[1]?.inputHash).not.toBe(frozen?.inputHash);
    expect(w.current("s0")).toBe(String(s0Rows[1]?.id));
  });
});

describe("snapshot inputs", () => {
  test("the same evidence in a different order or in batches gives the same inputHash", async () => {
    const jobOne = RESUME_ONE;
    const jobTwo = [
      "Research Assistant at Lab Z (Jan 2024 - Mar 2024)",
      "- Designed an ambitious experiment on protein folding",
    ].join("\n");
    const together = await judge([jobOne, jobTwo].join("\n"));
    const reversed = await judge([jobTwo, jobOne].join("\n"));
    const first = await judge(jobOne);
    const second = await judge(jobTwo, new FakeJev(), first);
    const batches = [...first, ...second];

    expect(together.length).toBeGreaterThan(2);
    const base = plan(together).inputHash;
    expect(plan(reversed).inputHash).toBe(base);
    expect(plan(batches).inputHash).toBe(base);
    expect(plan([...batches].reverse()).inputHash).toBe(base);
  });

  test("evidence dated after a cutoff never enters that snapshot", async () => {
    const early = await judge(RESUME_ONE);
    const late = await judge(
      ["Software Engineer at Beta Inc (Jun 2025 - Aug 2025)", "- Built an ambitious compiler"].join(
        "\n",
      ),
    );
    expect(late.length).toBeGreaterThan(0);
    const without = plan(early);
    const withLate = plan([...early, ...late]);
    expect(withLate.inputHash).toBe(without.inputHash);
    expect(withLate.claimCount).toBe(without.claimCount);
    expect(plan([...early, ...late], "s12").inputHash).not.toBe(plan(early, "s12").inputHash);
  });
});

describe("corrections and reruns", () => {
  test("late pre-intake evidence creates a correction, not a changed row", async () => {
    const w = world();
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const before = w.snapshots("s0");
    expect(before.length).toBe(1);
    const original = structuredClone(before[0]);

    setSystemTime(day(65));
    await w.upload(RESUME_TWO);
    await w.check();

    const after = w.snapshots("s0");
    expect(after.length).toBe(2);
    expect(after[0]).toEqual(original);
    expect(after[1]?.correctsSnapshotId).toBe(String(original?.id));
    expect(Number(after[1]?.claimCount)).toBeGreaterThan(Number(original?.claimCount));
  });

  for (const [label, correctionAt] of [
    ["in the same millisecond as", day(61)],
    ["on a host whose clock reads earlier than", new Date(day(61).getTime() - 60 * 60 * 1000)],
  ] as const) {
    test(`a correction computed ${label} its original is still current, and a rerun writes nothing`, async () => {
      const w = world({ github: null });
      await w.upload(RESUME_ONE);
      await w.intake();
      setSystemTime(day(61));
      await w.daily();
      const [original] = w.snapshots("s0");
      if (!original) throw new Error("no s0");

      setSystemTime(correctionAt);
      await w.upload(RESUME_TWO);
      await w.check();
      const rows = w.snapshots("s0");
      expect(rows.length).toBe(2);
      const correction = rows[1];
      expect(correction?.correctsSnapshotId).toBe(String(original.id));
      expect(String(correction?.computedAt) <= String(original.computedAt)).toBe(true);
      expect(w.current("s0")).toBe(String(correction?.id));

      await w.check();
      await w.check();
      expect(w.snapshots("s0")).toEqual(rows);
    });
  }

  test("a cron run twice writes once", async () => {
    const w = world();
    await w.upload(RESUME_ONE);
    setSystemTime(day(61));
    expect(await w.daily()).toBe(1);
    const rows = w.snapshots();
    const judgments = w.judgments().length;
    const calls = w.state.jev.claimCalls;
    expect(rows.length).toBe(1);

    expect(await w.daily()).toBe(0);
    await w.check();
    expect(w.snapshots()).toEqual(rows);
    expect(w.judgments().length).toBe(judgments);
    expect(w.state.jev.claimCalls).toBe(calls);
  });

  test("a thin candidate gets thin = true and s_floor, never a missing snapshot", async () => {
    const w = world({ github: null });
    setSystemTime(day(61));
    expect(await w.daily()).toBe(1);
    const [s0] = w.snapshots("s0");
    expect(s0).toBeDefined();
    expect(s0?.thin).toBe(true);
    expect(s0?.substance).toBe(OUTPUT_ONLY_ROLLUP_V1_0_0.sFloor);
    expect(s0?.claimCount).toBe(0);

    const one = world({ github: null });
    await one.upload(
      ["Software Engineer Intern at Acme Corp (Jun 2024 - Aug 2024)", "- Built a toy script"].join(
        "\n",
      ),
    );
    setSystemTime(day(61));
    await one.daily();
    expect(one.snapshots("s0")[0]?.thin).toBe(true);
  });
});

const RESUME_ONE_REWORDED = [
  "Software Engineer Intern at Acme Corp (Jun 2024 - Aug 2024)",
  "- Built an ambitious payments pipeline used by 10,000 daily users",
  "- Reduced checkout service latency by 40 percent",
].join("\n");

const numbers = (row: Record<string, unknown> | undefined) => ({
  substance: Number(row?.substance),
  claimCount: Number(row?.claimCount),
  thin: row?.thin,
});

function movement(
  from: Record<string, unknown> | undefined,
  to: Record<string, unknown> | undefined,
) {
  return {
    substance: Number(to?.substance) - Number(from?.substance),
    claimCount: Number(to?.claimCount) - Number(from?.claimCount),
  };
}

describe("resume versions", () => {
  test("a newer resume restating pre-referral work corrects s0, and movement is unchanged", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const [original] = w.snapshots("s0");

    setSystemTime(day(80));
    await w.upload(RESUME_ONE_REWORDED);
    await w.check();
    const rows = w.snapshots("s0");
    expect(rows.length).toBe(2);
    expect(rows[1]?.correctsSnapshotId).toBe(String(original?.id));
    expect(rows[1]?.inputHash).not.toBe(original?.inputHash);
    expect(numbers(rows[1])).toEqual(numbers(original));
    expect(w.current("s0")).toBe(String(rows[1]?.id));

    setSystemTime(day(400));
    await w.daily();
    expect(movement(rows[1], w.snapshots("s12")[0])).toEqual({ substance: 0, claimCount: 0 });
  });

  test("a restating upload after s12 is frozen corrects both s0 and s12, and the movement from s0 to s12 is unchanged", async () => {
    const w = world();
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    setSystemTime(day(200));
    w.state.repos = [
      repo({ created_at: "2025-07-01T10:00:00Z", updated_at: "2025-07-01T10:00:00Z" }),
    ];
    setSystemTime(day(400));
    await w.check();
    const [s0] = w.snapshots("s0");
    const [s12] = w.snapshots("s12");
    expect(w.snapshots().length).toBe(2);
    const v1Movement = movement(s0, s12);
    expect(v1Movement.claimCount).toBeGreaterThan(0);

    setSystemTime(day(410));
    await w.upload(RESUME_ONE_REWORDED);
    await w.check();
    const s0Rows = w.snapshots("s0");
    const s12Rows = w.snapshots("s12");
    expect(s0Rows.length).toBe(2);
    expect(s12Rows.length).toBe(2);
    expect(s0Rows[1]?.correctsSnapshotId).toBe(String(s0?.id));
    expect(s12Rows[1]?.correctsSnapshotId).toBe(String(s12?.id));
    expect(numbers(s0Rows[1])).toEqual(numbers(s0));
    expect(numbers(s12Rows[1])).toEqual(numbers(s12));
    expect(w.current("s0")).toBe(String(s0Rows[1]?.id));
    expect(w.current("s12")).toBe(String(s12Rows[1]?.id));
    expect(movement(s0Rows[1], s12Rows[1])).toEqual(v1Movement);

    const rows = w.snapshots();
    await w.check();
    await w.check();
    expect(w.snapshots()).toEqual(rows);
  });

  test("an unchanged job re-uploaded leaves substance, claimCount and thin unchanged and writes nothing", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const rows = w.snapshots();
    const judgments = w.judgments().length;
    const calls = w.state.jev.claimCalls;

    setSystemTime(day(80));
    await w.upload(RESUME_ONE);
    await w.check();
    expect(w.d.db.rows("resumeVersions").length).toBe(2);
    expect(w.snapshots()).toEqual(rows);
    expect(w.judgments().length).toBe(judgments);
    expect(w.state.jev.claimCalls).toBe(calls);
  });

  test("content dated after the referral in a newer version counts only in later snapshots and shows as movement", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const s0 = w.snapshots("s0");

    setSystemTime(day(200));
    await w.upload(
      [
        RESUME_ONE,
        "Software Engineer at Beta Inc (Mar 2025 - Jun 2025)",
        "- Built an ambitious compiler",
      ].join("\n"),
    );
    await w.check();
    expect(w.snapshots("s0")).toEqual(s0);

    setSystemTime(day(400));
    await w.daily();
    expect(movement(s0[0], w.snapshots("s12")[0]).claimCount).toBeGreaterThan(0);
  });

  test("a snapshot whose cutoff is before D is not corrected", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    setSystemTime(day(400));
    await w.daily();
    const s0 = w.snapshots("s0");
    const [s12] = w.snapshots("s12");

    setSystemTime(day(410));
    await w.upload(
      [
        RESUME_ONE,
        "Software Engineer at Beta Inc (Mar 2025 - Dec 2025)",
        "- Built an ambitious compiler",
      ].join("\n"),
    );
    await w.check();
    expect(w.snapshots("s0")).toEqual(s0);
    const s12Rows = w.snapshots("s12");
    expect(s12Rows.length).toBe(2);
    expect(s12Rows[1]?.correctsSnapshotId).toBe(String(s12?.id));
    expect(Number(s12Rows[1]?.claimCount)).toBeGreaterThan(Number(s12?.claimCount));
  });

  test("an older version's claims never count once a newer version exists at an uncomputed snapshot", async () => {
    const alone = world({ github: null });
    await alone.upload(RESUME_ONE);
    await alone.intake();
    setSystemTime(day(61));
    await alone.daily();

    setSystemTime(day(1));
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(10));
    await w.upload(RESUME_ONE_REWORDED);
    await w.check();
    setSystemTime(day(61));
    await w.daily();
    const rows = w.snapshots("s0");
    expect(rows.length).toBe(1);
    expect(numbers(rows[0])).toEqual(numbers(alone.snapshots("s0")[0]));
  });
});

describe("ongoing roles", () => {
  const ACME_ONGOING = [
    "Software Engineer Intern at Acme Corp (Jun 2024 - Present)",
    "- Built an ambitious payment pipeline serving 10,000 daily users",
    "- Cut latency in the checkout service by 40 percent",
  ].join("\n");
  const ACME_CLOSED = ACME_ONGOING.replace("Jun 2024 - Present", "Jun 2024 - Jun 2025");

  const resumeClaims = (w: ReturnType<typeof world>) =>
    w.parsed().filter((j) => j.claim.source === "resume" && j.claim.claimClass === "output");

  test("closing an ongoing role on a re-upload after s12 manufactures no movement", async () => {
    const w = world({ github: null });
    await w.upload(ACME_ONGOING);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    setSystemTime(day(400));
    await w.daily();
    const [s0] = w.snapshots("s0");
    const [s12] = w.snapshots("s12");
    expect(Number(s0?.claimCount)).toBeGreaterThan(1);
    const before = movement(s0, s12);

    setSystemTime(day(410));
    await w.upload(ACME_CLOSED);
    await w.check();
    const s0Head = w.snapshots("s0").find((row) => row.id === w.current("s0"));
    const s12Head = w.snapshots("s12").find((row) => row.id === w.current("s12"));
    expect(numbers(s0Head)).toEqual(numbers(s0));
    expect(numbers(s12Head)).toEqual(numbers(s12));
    expect(movement(s0Head, s12Head)).toEqual(before);
    expect(resumeClaims(w).every((j) => j.claim.jobDates.endedAt === null)).toBe(true);
    expect(w.d.db.rows("resumeLines").some((line) => /Jun 2025/.test(String(line.statement)))).toBe(
      true,
    );

    const rows = w.snapshots();
    const judgments = w.judgments().length;
    await w.check();
    await w.check();
    expect(w.snapshots()).toEqual(rows);
    expect(w.judgments().length).toBe(judgments);
  });

  test("a role first seen already closed is dated at its end date", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    setSystemTime(day(400));
    await w.daily();
    const [s0] = w.snapshots("s0");

    setSystemTime(day(410));
    await w.upload(RESUME_ONE.replace("Jun 2024 - Aug 2024", "Jun 2024 - Mar 2025"));
    await w.check();
    const newest = new Set(w.d.db.rows("resumeVersions").at(-1)?.evidenceKeys as string[]);
    const outputs = resumeClaims(w).filter((j) => newest.has(j.record.evidenceKey));
    expect(outputs.length).toBe(2);
    expect(outputs.every((j) => j.claim.jobDates.endedAt === "2025-03-01")).toBe(true);
    const s0Head = w.snapshots("s0").find((row) => row.id === w.current("s0"));
    expect(Number(s0Head?.claimCount)).toBe(Number(s0?.claimCount) - 2);
  });

  test("a job key match uses organisation, title and start so a different job is not affected", async () => {
    const lines = (text: string) => claimLines(rawResumeLines(text), "2025-01-01T00:00:00.000Z");
    const earlier = lines(ACME_ONGOING);
    const later = lines(
      [
        ACME_CLOSED,
        "Software Engineer at Acme Corp (Jun 2024 - Jun 2025)",
        "- Built an ambitious title change service",
        "Software Engineer Intern at Beta Inc (Jun 2024 - Jun 2025)",
        "- Built an ambitious other company service",
        "Software Engineer Intern at Acme Corp (Jul 2024 - Jun 2025)",
        "- Built an ambitious later start service",
      ].join("\n"),
    );
    const run = await judgeClaimsV12({
      personId: PERSON,
      evidence: resumeEvidence(later, ongoingJobKeys([earlier])),
      known: [],
      client: new FakeJev() as never,
      now: () => new Date("2025-01-01T00:00:00.000Z"),
    });
    // Only the two Acme intern bullets match: a key missing any one field would stick a third.
    const outputs = run.written.filter((j) => j.claim.claimClass === "output");
    expect(outputs.length).toBe(5);
    expect(outputs.filter((j) => j.claim.jobDates.endedAt === null).length).toBe(2);
    expect(outputs.filter((j) => j.claim.jobDates.endedAt === "2025-06-01").length).toBe(3);
  });

  test("new bullets under an ongoing role are dated at the role start (SEA-94)", async () => {
    const w = world({ github: null });
    await w.upload(ACME_ONGOING);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    setSystemTime(day(400));
    await w.daily();
    const [s0] = w.snapshots("s0");
    const [s12] = w.snapshots("s12");

    setSystemTime(day(410));
    await w.upload(`${ACME_ONGOING}\n- Shipped an ambitious fraud model in 2025`);
    await w.check();
    const s0Head = w.snapshots("s0").find((row) => row.id === w.current("s0"));
    const s12Head = w.snapshots("s12").find((row) => row.id === w.current("s12"));
    // The accepted limit: the new bullet lands in s0 as a correction, not as growth by s12.
    expect(Number(s0Head?.claimCount)).toBe(Number(s0?.claimCount) + 1);
    expect(Number(s12Head?.claimCount)).toBe(Number(s12?.claimCount) + 1);
    expect(movement(s0Head, s12Head).claimCount).toBe(movement(s0, s12).claimCount);
  });
});

describe("class year", () => {
  async function frozenS0() {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    return w;
  }
  const setClassYear = (w: ReturnType<typeof world>, classYear: number | null) =>
    w.d.call("evidence:setClassYear", { personId: PERSON, classYear });

  test("a late edit writes exactly one s0 correction carrying it, and a rerun writes nothing", async () => {
    const w = await frozenS0();
    const [original] = w.snapshots("s0");
    expect(original?.classYear).toBeNull();

    setSystemTime(day(70));
    await setClassYear(w, 2027);
    const rows = w.snapshots("s0");
    expect(rows.length).toBe(2);
    expect(rows[1]?.correctsSnapshotId).toBe(String(original?.id));
    expect(rows[1]?.classYear).toBe(2027);
    expect(numbers(rows[1])).toEqual(numbers(original));
    expect(w.current("s0")).toBe(String(rows[1]?.id));

    await setClassYear(w, 2027);
    await w.check();
    await w.check();
    expect(w.snapshots()).toEqual(rows);
  });

  test("a class year that changed outside setClassYear is corrected once by the next check", async () => {
    const w = await frozenS0();
    const person = w.d.db.rows("clubPeople")[0];
    if (!person) throw new Error("no person");
    await w.d.db.patch(person._id, { classYear: 2026 });
    await w.check();
    const rows = w.snapshots("s0");
    expect(rows.length).toBe(2);
    expect(rows[1]?.classYear).toBe(2026);
    await w.check();
    expect(w.snapshots("s0")).toEqual(rows);
  });

  test("a snapshot written with a null class year warns", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    afterEachOnce(() => warn.mockRestore());
    const w = await frozenS0();
    const [s0] = w.snapshots("s0");
    expect(warn.mock.calls.map(([message]) => String(message))).toContain(
      `evidence: ${PERSON} s0 snapshot ${String(s0?.id)} has no class year`,
    );
  });
});

describe("failed claim judgments", () => {
  const RESUME_FLAKY = [RESUME_ONE, "- Wrote a flaky widget"].join("\n");
  const flaky = (text: string) => /flaky/.test(text);
  const flakyCalls = (jev: FakeJev) => jev.texts.filter(flaky).length;

  async function brokenRubric() {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    afterEachOnce(() => warn.mockRestore());
    const w = world({ github: null });
    w.state.jev = new FakeJev({ fail: (text) => (flaky(text) ? "invariant" : null) });
    await w.upload(RESUME_FLAKY);
    await w.intake();
    return w;
  }

  test("a deterministic failure is billed once across two checks under one spec version, and the snapshot is still written", async () => {
    const w = await brokenRubric();
    expect(flakyCalls(w.state.jev)).toBe(1);
    const markers = w.d.db.rows("claimJudgmentFailures");
    expect(markers.length).toBe(1);
    const stored = w.parsed();
    expect(stored.some((j) => /flaky/.test(JSON.stringify(j.record)))).toBe(false);

    setSystemTime(day(61));
    await w.daily();
    setSystemTime(day(80));
    await w.check();
    expect(flakyCalls(w.state.jev)).toBe(1);
    expect(w.d.db.rows("claimJudgmentFailures")).toEqual(markers);
    const [s0] = w.snapshots("s0");
    expect(Number(s0?.claimCount)).toBe(stored.length);
  });

  for (const failure of ["no-usage", "no-model"] as const) {
    test(`a response with ${failure} is a recorded failure billed once, and the run still stores the rest`, async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      afterEachOnce(() => warn.mockRestore());
      const w = world({ github: null });
      w.state.jev = new FakeJev({ fail: (text) => (flaky(text) ? failure : null) });
      await w.upload(RESUME_FLAKY);
      await w.intake();
      expect(flakyCalls(w.state.jev)).toBe(1);
      expect(w.d.db.rows("claimJudgmentFailures").length).toBe(1);
      const stored = w.parsed();
      expect(stored.length).toBeGreaterThan(0);

      setSystemTime(day(61));
      await w.daily();
      setSystemTime(day(80));
      await w.check();
      expect(flakyCalls(w.state.jev)).toBe(1);
      const [s0] = w.snapshots("s0");
      expect(Number(s0?.claimCount)).toBe(stored.length);
    });
  }

  test("a spec bump retries a recorded failure, which can then succeed", async () => {
    const w = await brokenRubric();
    const [marker] = w.d.db.rows("claimJudgmentFailures");
    if (!marker) throw new Error("no failure marker");
    await w.d.db.patch(marker._id, { specId: "career-evidence@1.2.3:00000000" });
    const before = w.judgments().length;
    w.state.jev = new FakeJev();

    await w.check();
    expect(flakyCalls(w.state.jev)).toBe(1);
    expect(w.judgments().length).toBe(before + 1);
  });

  test("a transient failure is not recorded and is retried", async () => {
    const w = world({ github: null });
    let outage = true;
    w.state.jev = new FakeJev({ fail: (text) => (outage && flaky(text) ? "transient" : null) });
    await w.upload(RESUME_FLAKY);
    await expect(w.intake()).rejects.toThrow("503");
    expect(w.d.db.rows("claimJudgmentFailures").length).toBe(0);

    outage = false;
    const before = flakyCalls(w.state.jev);
    await w.check();
    expect(flakyCalls(w.state.jev)).toBe(before + 1);
    const keys = w.d.db.rows("resumeVersions")[0]?.evidenceKeys as string[] | undefined;
    expect(w.parsed().length).toBe(keys?.length ?? -1);
  });
});

describe("a spec bump", () => {
  test("stores the new spec's records once, a later check calls Jev for nothing, and the snapshots count each evidence key once", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const values = () =>
      (["s0", "s12"] as const).map((kind) =>
        numbers(w.snapshots(kind).find((row) => row.id === w.current(kind))),
      );
    const counted = values();
    const OLD_SPEC = "career_evidence@1.2.3:8119ac21";
    for (const row of w.judgments()) {
      const record = JSON.parse(String(row.record));
      const claim = JSON.parse(String(row.claim));
      const recordId = `${row.recordId}-old`;
      await w.d.db.patch(row._id, {
        specId: OLD_SPEC,
        recordId,
        record: JSON.stringify({ ...record, id: recordId, specId: OLD_SPEC }),
        claim: JSON.stringify({ ...claim, recordId }),
      });
    }
    const before = w.judgments().length;

    setSystemTime(day(80));
    const calls = w.state.jev.claimCalls;
    await w.check();
    expect(w.state.jev.claimCalls).toBeGreaterThan(calls);
    expect(w.judgments().length).toBe(before * 2);
    expect(values()).toEqual(counted);
    const rows = w.snapshots();

    const after = w.state.jev.claimCalls;
    await w.check();
    expect(w.state.jev.claimCalls).toBe(after);
    expect(w.judgments().length).toBe(before * 2);
    expect(w.snapshots()).toEqual(rows);
  });
});

describe("1.2 records", () => {
  test("claim lines to snapshot: what the 1.2 path writes passes outputOnlyRollup's checks", async () => {
    for (const text of [RESUME_ONE, RESUME_TWO]) {
      const judgments = await judge(text);
      expect(judgments.length).toBeGreaterThan(1);
      const rollup = outputOnlyRollup({
        personId: PERSON,
        records: judgments.map((j) => j.record),
        claims: judgments.map((j) => j.claim),
        evidenceCutoff: evidenceCutoff(T0, "s0"),
      });
      expect(rollup.claimCount).toBeGreaterThan(0);
      expect(rollup.inputHash).toBe(plan(judgments).inputHash);
    }
    for (const j of await judge(RESUME_ONE)) {
      expect(j.record.specId).toContain("career_evidence@1.2.4");
      expect(j.record.kind).toBe("claim");
    }
  });

  test("the same, through the whole check: PDF text that needs the labelling pass, to a stored s0", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_UNPARSED);
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    expect(w.parsed().length).toBeGreaterThan(1);
    const [s0] = w.snapshots("s0");
    expect(Number(s0?.claimCount)).toBeGreaterThan(0);
  });

  test("every stored claim has author set, none rely on the default", async () => {
    const w = world();
    w.state.repos = [repo()];
    await w.upload(RESUME_ONE);
    await w.intake();
    const rows = w.judgments();
    expect(rows.some((row) => row.source === "resume")).toBe(true);
    expect(rows.some((row) => row.source === "github")).toBe(true);
    for (const row of rows) {
      const claim = JSON.parse(String(row.claim));
      expect(["candidate", "system"]).toContain(claim.author);
      expect(row.author).toBe(claim.author);
      expect(claim.author).toBe(row.source === "resume" ? "candidate" : "system");
    }
    const [one] = w.parsed();
    if (!one) throw new Error("no judgment");
    const { author: _dropped, ...noAuthor } = one.claim;
    const clubId = String(w.d.db.rows("clubs")[0]?._id);
    await expect(
      w.d.call("evidence:storeJudgments", {
        clubId,
        personId: PERSON,
        judgments: [JSON.stringify({ ...one, claim: noAuthor })],
      }),
    ).rejects.toThrow(/author/);
  });
});

describe("GitHub evidence", () => {
  test("claim dates are the artifact's date, never the fetch time", async () => {
    const w = world();
    w.state.repos = [
      repo({
        id: 1,
        name: "old",
        created_at: "2023-03-05T10:00:00Z",
        updated_at: "2023-03-05T10:00:00Z",
      }),
    ];
    setSystemTime(new Date("2025-02-01T12:34:56Z"));
    await w.upload(RESUME_ONE);
    await w.intake();
    const github = w.parsed().filter((j) => j.claim.source === "github");
    expect(github.length).toBeGreaterThan(0);
    for (const j of github) {
      expect(j.claim.jobDates.startedAt).toBe("2023-03-05");
      expect(j.claim.jobDates.endedAt).toBe("2023-03-05");
      expect(j.record.evidenceKey).toContain("2023-03-05T10:00:00Z");
    }
    const everything = JSON.stringify(github.map((j) => [j.claim, j.record.evidenceKey]));
    expect(everything).not.toContain("2025-02-01");
  });

  test("a changed artifact is dated at its own change, not at the fetch", async () => {
    const w = world();
    w.state.repos = [
      repo({ created_at: "2025-01-10T10:00:00Z", updated_at: "2025-01-10T10:00:00Z" }),
    ];
    await w.intake();
    w.state.repos = [
      repo({
        description: "A lamp controller with an ambitious scheduler",
        updated_at: "2025-08-01T09:00:00Z",
      }),
    ];
    setSystemTime(day(300));
    await w.check();
    const dates = w
      .parsed()
      .filter((j) => j.claim.source === "github")
      .map((j) => j.claim.jobDates.startedAt)
      .sort();
    expect(dates).toEqual(["2025-01-10", "2025-08-01"]);
  });

  test("editing a repo description does not create a duplicate claim: one version counts per cutoff", async () => {
    const w = world();
    w.state.repos = [repo()];
    await w.intake();
    const jevCalls = w.state.jev.claimCalls;
    expect(w.judgments().filter((r) => r.source === "github").length).toBe(2);

    w.state.repos = [
      repo({ description: "a  small LAMP controller!", updated_at: "2025-01-15T09:00:00Z" }),
    ];
    setSystemTime(day(10));
    await w.check();
    expect(w.state.jev.claimCalls).toBe(jevCalls);
    expect(w.judgments().filter((r) => r.source === "github").length).toBe(2);

    w.state.repos = [
      repo({
        description: "A lamp controller with a scheduler",
        updated_at: "2025-01-25T09:00:00Z",
      }),
    ];
    setSystemTime(day(20));
    await w.check();
    const github = w.parsed().filter((j) => j.claim.source === "github");
    expect(github.length).toBe(3);
    const counted = claimsAtCutoff(
      github.map((j) => j.claim),
      github.map((j) => j.record),
      evidenceCutoff(T0, "s0"),
    );
    expect(counted.length).toBe(1);
    expect(counted[0]?.jobDates.startedAt).toBe("2025-01-25");

    setSystemTime(day(61));
    await w.daily();
    const s0 = w.snapshots("s0").at(-1);
    expect(s0?.claimCount).toBe(1);
  });

  test("a material change gets a new version dated at the change, and growth shows across s0 -> s12", async () => {
    const w = world();
    w.state.repos = [repo({ description: "A toy lamp script" })];
    setSystemTime(day(10));
    await w.intake();
    setSystemTime(day(62));
    await w.daily();
    const s0 = w.snapshots("s0")[0];
    if (!s0) throw new Error("no s0");
    const frozen = structuredClone(s0);

    w.state.repos = [
      repo({
        description: "A lamp controller with an ambitious distributed scheduler",
        updated_at: "2025-08-01T09:00:00Z",
      }),
    ];
    setSystemTime(day(200));
    await w.check();
    expect(w.snapshots("s0")).toEqual([frozen]);

    setSystemTime(day(400));
    await w.daily();
    const s12 = w.snapshots("s12")[0];
    expect(s12).toBeDefined();
    expect(Number(s12?.substance)).toBeGreaterThan(Number(s0?.substance));
    expect(w.snapshots("s0")).toEqual([frozen]);
  });

  test("an immaterial change does not re-score", async () => {
    const w = world();
    w.state.repos = [repo({ stargazers_count: 1 })];
    await w.intake();
    const calls = w.state.jev.claimCalls;
    const records = w.judgments().length;
    w.state.repos = [repo({ stargazers_count: 99, updated_at: "2025-02-20T00:00:00Z" })];
    setSystemTime(day(50));
    await w.check();
    w.state.repos = [
      repo({ description: "A small lamp controller.", updated_at: "2025-03-20T00:00:00Z" }),
    ];
    setSystemTime(day(70));
    await w.check();
    expect(w.state.jev.claimCalls).toBe(calls);
    expect(w.judgments().length).toBe(records);
  });

  test("a description edited after s0 on a repo created before it stays out of s0 and counts in s12", async () => {
    const w = world();
    w.state.repos = [
      repo({
        description: "A lamp controller with an ambitious distributed scheduler",
        created_at: "2025-01-10T10:00:00Z",
        updated_at: "2025-08-01T09:00:00Z",
      }),
    ];
    setSystemTime(day(250));
    await w.intake();
    const github = w.parsed().filter((j) => j.claim.source === "github");
    const creation = versionDigest("alice created the public repository alice/lamp.");
    const edited = versionDigest(
      "alice created the public repository alice/lamp: A lamp controller with an ambitious distributed scheduler",
    );
    const versionsAt = (kind: SnapshotKind) => {
      const ids = new Set(
        claimsAtCutoff(
          github.map((j) => j.claim),
          github.map((j) => j.record),
          evidenceCutoff(T0, kind),
        ).map((claim) => claim.id),
      );
      return github
        .filter((j) => ids.has(j.claim.id))
        .map((j) => evidenceKeyParts(j.record.evidenceKey));
    };
    const s0 = versionsAt("s0");
    expect(s0.length).toBeGreaterThan(0);
    for (const key of s0) {
      expect(key.publishedAt).toBe("2025-01-10T10:00:00Z");
      expect(key.versionDigest).toBe(creation);
    }
    const s12 = versionsAt("s12");
    expect(s12.length).toBeGreaterThan(0);
    for (const key of s12) {
      expect(key.publishedAt).toBe("2025-08-01T09:00:00Z");
      expect(key.versionDigest).toBe(edited);
    }

    await w.check();
    setSystemTime(day(400));
    await w.daily();
    const s0Row = w.snapshots("s0").at(-1);
    const s12Row = w.snapshots("s12").at(-1);
    expect(Number(s12Row?.substance)).toBeGreaterThan(Number(s0Row?.substance));
  });

  test("a repo without a description gives only its creation claim", async () => {
    const w = world();
    w.state.repos = [repo({ description: null, updated_at: "2025-03-01T09:00:00Z" })];
    await w.intake();
    const github = w.parsed().filter((j) => j.claim.source === "github");
    expect(github.length).toBe(1);
    expect(github[0]?.claim.jobDates.startedAt).toBe("2025-01-10");
    expect(github[0]?.record.evidenceKey).toContain("2025-01-10T10:00:00Z");

    const calls = w.state.jev.claimCalls;
    setSystemTime(day(30));
    await w.check();
    expect(w.state.jev.claimCalls).toBe(calls);
    expect(w.judgments().length).toBe(1);
  });

  test("the creation-time claim never contains the description", async () => {
    const description = "Zephyrine quantum lamp orchestration";
    const artifacts = await fetchGitHubArtifacts("alice", new Date(0), day(400), async (url) =>
      url.includes("/repos")
        ? [
            {
              ...repo({ description, updated_at: "2025-06-01T00:00:00Z" }),
              full_name: "alice/lamp",
              html_url: "https://github.com/alice/lamp",
              fork: false,
            },
          ]
        : [],
    );
    const [artifact] = artifacts;
    if (!artifact) throw new Error("no artifact");
    expect(JSON.stringify(artifact.created)).not.toContain("Zephyrine");
    expect(artifact.created.publishedAt).toBe("2025-01-10T10:00:00Z");
    expect(artifact.item.statement).toContain(description);

    const w = world();
    w.state.repos = [repo({ description, updated_at: "2025-06-01T00:00:00Z" })];
    await w.intake();
    const keys = w
      .parsed()
      .filter((j) => j.claim.source === "github")
      .map((j) => evidenceKeyParts(j.record.evidenceKey));
    const creation = keys.filter((key) => key.publishedAt === "2025-01-10T10:00:00Z");
    expect(creation.length).toBeGreaterThan(0);
    for (const key of creation) {
      expect(key.versionDigest).toBe(versionDigest(artifact.created.statement));
    }
    const shown = w.state.jev.texts;
    expect(shown.some((text) => !text.includes("Zephyrine"))).toBe(true);
    expect(shown.some((text) => text.includes("Zephyrine"))).toBe(true);
  });

  test("GitHub claims are never externally_verified", async () => {
    const w = world();
    w.state.repos = [repo(), repo({ id: 102, name: "other", description: "Another project" })];
    await w.upload(RESUME_ONE);
    await w.intake();
    const github = w.parsed().filter((j) => j.claim.source === "github");
    expect(github.length).toBe(4);
    for (const j of github) expect(j.claim.evidenceTier).toBe("self_reported");
    for (const j of w.parsed()) expect(j.claim.evidenceTier).not.toBe("externally_verified");
  });

  test("a bare handle or a profile URL is the same account; ORCID has no path", () => {
    expect(githubUsername("alice")).toBe("alice");
    expect(githubUsername("https://github.com/alice/lamp")).toBe("alice");
    for (const file of [
      "apps/club/convex/evidence.ts",
      "apps/club/convex/evidenceNode.ts",
      "apps/club/lib/longitudinal/evidenceSources.ts",
      "apps/club/lib/longitudinal/claimJudgmentV12.ts",
      "apps/club/lib/longitudinal/evidenceSnapshots.ts",
    ]) {
      const code = readFileSync(join(root, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/orcid/i);
    }
  });

  test("no ORCID request is ever made by a check", async () => {
    const w = world();
    w.state.repos = [repo()];
    await w.intake();
    expect(w.state.urls.length).toBeGreaterThan(0);
    for (const url of w.state.urls) expect(url).not.toMatch(/orcid/i);
  });
});

describe("the daily check", () => {
  test("the periodic recheck corrects a due snapshot for late pre-intake evidence, and is idempotent", async () => {
    const w = world();
    setSystemTime(day(1));
    await w.intake();
    setSystemTime(day(61));
    await w.daily();
    const original = structuredClone(w.snapshots("s0")[0]);
    expect(original?.thin).toBe(true);
    expect(w.intakeRow().lastCheckedAt).toBeDefined();

    setSystemTime(day(70));
    expect(await w.daily()).toBe(0);

    w.state.repos = [
      repo({ created_at: "2024-12-01T08:00:00Z", updated_at: "2024-12-01T08:00:00Z" }),
    ];
    setSystemTime(day(80));
    expect(await w.daily()).toBe(1);
    const rows = w.snapshots("s0");
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(original);
    expect(rows[1]?.correctsSnapshotId).toBe(String(original?.id));
    expect(Number(rows[1]?.claimCount)).toBe(1);

    expect(await w.daily()).toBe(0);
    const calls = w.state.jev.claimCalls;
    await w.check();
    expect(w.snapshots("s0")).toEqual(rows);
    expect(w.state.jev.claimCalls).toBe(calls);
  });

  test("a failed GitHub fetch writes no snapshot and does not advance nextDueAt", async () => {
    const w = world();
    await w.upload(RESUME_ONE);
    await w.intake();
    const before = w.intakeRow();
    expect(before.lastCheckedAt).toBeDefined();
    const lastChecked = before.lastCheckedAt;
    w.state.githubFails = true;
    setSystemTime(day(61));
    expect(await w.daily()).toBe(1);
    const result = await w.check();
    expect(result?.githubFailed).toBe(true);
    expect(w.snapshots().length).toBe(0);
    const after = w.intakeRow();
    expect(after.nextDueAt).toBe(before.nextDueAt);
    expect(after.lastCheckedAt).toBe(lastChecked);
    expect(w.judgments().length).toBeGreaterThan(0);

    w.state.githubFails = false;
    setSystemTime(day(64));
    expect(await w.daily()).toBe(0);
    setSystemTime(day(65));
    expect(await w.daily()).toBe(1);
    expect(w.snapshots("s0").length).toBe(1);
    expect(Number(w.intakeRow().nextDueAt)).toBeGreaterThan(Number(before.nextDueAt));
    expect(w.intakeRow().retryAfter).toBeUndefined();
  });

  test("more than a batch of candidates whose GitHub always fails do not starve the rest", async () => {
    const failing = Array.from({ length: evidence.DAILY_BATCH + 5 }, (_, i) => `f${i}`);
    const w = world({ github: null, before: failing });
    for (const handle of failing) w.state.failingHandles.add(handle);
    await w.upload(RESUME_ONE);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    afterEachOnce(() => warn.mockRestore());

    setSystemTime(day(61));
    const first = await w.dailyPeople();
    expect(first.length).toBe(evidence.DAILY_BATCH);
    expect(first).not.toContain(PERSON);
    const f0 = w.intakeRow("f0");
    expect(w.snapshots().length).toBe(0);

    setSystemTime(day(62));
    const second = await w.dailyPeople();
    expect(second).toContain(PERSON);
    expect(second).toContain(`f${evidence.DAILY_BATCH}`);
    expect(second).not.toContain("f0");
    expect(w.snapshots("s0").filter((row) => row.candidateId === PERSON).length).toBe(1);
    expect(w.intakeRow("f0").nextDueAt).toBe(f0.nextDueAt);
    expect(w.intakeRow("f0").lastCheckedAt).toBeUndefined();

    setSystemTime(day(63));
    const third = await w.dailyPeople();
    expect(third).toContain("f0");
    expect(third).not.toContain(PERSON);
    setSystemTime(day(65));
    expect(await w.dailyPeople()).not.toContain("f0");
    setSystemTime(day(67));
    expect(await w.dailyPeople()).toContain("f0");
  });

  test("two concurrent checks with different model answers produce one reproducible snapshot from stored records", async () => {
    const w2 = world({ github: null });
    await w2.upload(RESUME_ONE);
    await w2.d.call("evidence:ensureIntake", { personId: PERSON });
    const jevA = new FakeJev({ model: "model-A", level: () => 1 });
    const jevB = new FakeJev({ model: "model-B", level: () => 4 });
    jevFactory = () => (als.getStore() === "A" ? jevA : jevB);
    setSystemTime(day(61));

    let release: () => void = () => {};
    const bStored = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aFinished: () => void = () => {};
    const aDone = new Promise<void>((resolve) => {
      aFinished = resolve;
    });
    const hooksA = async (name: string) => {
      if (name === "evidence:storeJudgments") await bStored;
    };
    const hooksB = async (name: string) => {
      if (name === "evidence:writeSnapshots") {
        release();
        await aDone;
      }
    };
    const runA = als.run("A", () =>
      w2.d.call("evidence:check", { personId: PERSON }, { before: hooksA }),
    );
    runA.then(aFinished, aFinished);
    const runB = als.run("B", () =>
      w2.d.call("evidence:check", { personId: PERSON }, { before: hooksB }),
    );
    await Promise.all([runA, runB]);

    const stored = w2.parsed();
    const keys = stored.map((j) => j.record.evidenceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(stored.map((j) => j.record.respondedModel))).toEqual(new Set(["model-B"]));

    const rows = w2.snapshots("s0");
    expect(rows.length).toBe(1);
    const again = planSnapshot({
      candidateId: PERSON,
      kind: "s0",
      intakeAt: T0,
      now: day(61),
      claims: stored.map((j) => j.claim),
      records: stored.map((j) => j.record) as JevJudgmentRecord[],
      resumeKeys: new Set(stored.map((j) => j.record.evidenceKey)),
      existing: [],
      classYear: null,
      newId: () => "x",
    });
    expect(rows[0]?.inputHash).toBe(again?.inputHash as string);
    expect(rows[0]?.substance).toBe(again?.substance as number);
  });
});

describe("resume intake", () => {
  test("a resume that parses without the LLM pass never calls the LLM", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    expect(w.state.jev.labelCalls).toBe(0);
    const [version] = w.d.db.rows("resumeVersions");
    expect(version?.normalized).toBe(false);
    expect(version?.rawText).toBe(RESUME_ONE);
    expect(w.state.jev.claimCalls).toBeGreaterThan(0);
  });

  test("text that does not parse takes the labelling pass, and the raw text is kept", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_UNPARSED);
    await w.intake();
    expect(w.state.jev.labelCalls).toBeGreaterThan(0);
    const [version] = w.d.db.rows("resumeVersions");
    expect(version?.normalized).toBe(true);
    expect(version?.rawText).toBe(RESUME_UNPARSED);
    expect(w.parsed().length).toBeGreaterThan(0);
  });

  test("a mixed-format resume, one job parseable and one not, takes the labelling pass", async () => {
    expect(parsesAsResume(rawResumeLines(RESUME_TWO))).toBe(true);
    expect(parsesAsResume(rawResumeLines(RESUME_MIXED))).toBe(false);
    expect(
      parsesAsResume(rawResumeLines(["- A bullet before any job", RESUME_ONE].join("\n"))),
    ).toBe(false);
    const w = world({ github: null });
    await w.upload(RESUME_MIXED);
    await w.intake();
    expect(w.state.jev.labelCalls).toBeGreaterThan(0);
    expect(w.d.db.rows("resumeVersions")[0]?.normalized).toBe(true);
  });

  test("a new upload adds a version and its lines; earlier ones stay", async () => {
    const w = world({ github: null });
    await w.upload(RESUME_ONE);
    await w.intake();
    const firstLines = w.d.db.rows("resumeLines").length;
    await w.upload(RESUME_TWO);
    await w.check();
    expect(w.d.db.rows("resumeVersions").length).toBe(2);
    expect(w.d.db.rows("resumeLines").length).toBeGreaterThan(firstLines);
    const keys = w.parsed().map((j) => j.record.evidenceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a bullet under a section heading after a job is not scored as work for that job", () => {
    const labelled: [string, LineRole][] = [
      ["Software Engineer Intern", "job_title"],
      ["Acme Corp", "organization"],
      ["Jun 2024 - Aug 2024", "dates"],
      ["Built the billing service used by 40,000 users", "bullet"],
      ["Projects", "other"],
      ["Wrote a ray tracer in Rust", "bullet"],
    ];
    const rebuilt = rebuildResumeLines(
      labelled.map(([line]) => line),
      labelled.map(([, role]) => role),
    );
    const claims = preprocessJobClaims(claimLines(rebuilt, "2024-09-01T00:00:00.000Z"), {
      version: "1.2.0",
    });
    const atAcme = claims.filter((claim) => "org" in claim && claim.org === "Acme Corp");
    expect(atAcme.some((claim) => claim.statement.includes("billing service"))).toBe(true);
    expect(atAcme.some((claim) => claim.statement.includes("ray tracer"))).toBe(false);
  });
});

const JEV_TS_SHA256_ON_MAIN = "f9622bf9954fe653becb5eaebc4bb388913305e85193f8d40fe8a44a87cb40e9";

describe("createJevJudgmentService", () => {
  test("is unchanged: still the 1.0 path, and does not touch the 1.2 one", () => {
    const source = readFileSync(join(root, "apps/club/lib/longitudinal/jev.ts"), "utf8");
    expect(source).toContain("export function createJevJudgmentService");
    expect(source).not.toMatch(/claimJudgmentV12|career_evidence@1\.2|V12/);
    // Pinned to the file as it is on main. A deliberate edit to jev.ts must update this hash.
    const digest = createHash("sha256").update(source).digest("hex");
    expect(digest).toBe(JEV_TS_SHA256_ON_MAIN);
  });
});
