import type { WithoutSystemFields } from "convex/server";
import { v } from "convex/values";
import { companyWorklist } from "../../../src/longitudinal/companyResearch.ts";
import { normalizeOrgName } from "../../../src/longitudinal/companySeed.ts";
import { loadClub } from "../lib/clubStore.ts";
import { type ClaimJudgment, judgeClaimsV12 } from "../lib/longitudinal/claimJudgmentV12.ts";
import {
  currentSnapshot,
  dueSnapshotKinds,
  nextSnapshot,
  planSnapshot,
  SNAPSHOT_KINDS,
  type SnapshotKind,
  type SnapshotRow,
} from "../lib/longitudinal/evidenceSnapshots.ts";
import {
  githubEvidence,
  githubUsername,
  githubVersionsToScore,
  resumeEvidence,
  storedGitHubVersions,
} from "../lib/longitudinal/evidenceSources.ts";
import { createJevClient } from "../lib/longitudinal/jevClient.ts";
import {
  claimLines,
  labelResumeLines,
  parsesAsResume,
  rawResumeLines,
  rebuildResumeLines,
} from "../lib/longitudinal/resumeLines.ts";
import type { GitHubArtifact } from "../lib/longitudinal/sources.ts";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
} from "./_generated/server";
import { requireAdmin } from "./club";
import { snapshotKind } from "./schema";

const COMPANY_RESEARCH_FRESH_MS = 90 * 24 * 60 * 60 * 1000;
export const DAILY_BATCH = 200;
const RECHECK_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
function retryBackoffMs(attempts: number): number {
  return Math.min(2 ** attempts, RECHECK_DAYS) * DAY_MS;
}

export const context = internalQuery({
  args: { personId: v.string() },
  handler: async (ctx, { personId }) => {
    const club = await loadClub(ctx.db);
    if (!club) return null;
    const person = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_domain_id", (q) => q.eq("clubId", club._id).eq("id", personId))
      .unique();
    if (!person) return null;
    const intake = await ctx.db
      .query("evidenceIntakes")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .unique();
    const versions = await ctx.db
      .query("resumeVersions")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .collect();
    // Oldest first: the last one is the newest version, the only one that counts.
    versions.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    const resumes = await Promise.all(
      versions.map(async (version) => ({
        storageId: version.storageId,
        evidenceKeys: version.evidenceKeys ?? null,
        lines: (
          await ctx.db
            .query("resumeLines")
            .withIndex("by_version", (q) => q.eq("resumeVersionId", version._id))
            .collect()
        ).map((line) => ({
          id: line.lineId,
          statement: line.statement,
          publishedAt: line.publishedAt,
        })),
      })),
    );
    const judgments = await ctx.db
      .query("jevJudgments")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .collect();
    const snapshots = await ctx.db
      .query("evidenceSnapshots")
      .withIndex("by_candidate_and_kind", (q) => q.eq("candidateId", personId))
      .collect();
    const storageId = person.resumeStorageId
      ? ctx.db.system.normalizeId("_storage", person.resumeStorageId)
      : null;
    const upload = storageId ? await ctx.db.system.get("_storage", storageId) : null;
    return {
      clubId: club._id,
      person: {
        id: person.id,
        github: person.github ?? null,
        classYear: person.classYear ?? null,
        createdAt: person.createdAt,
      },
      intake: intake ? { intakeAt: intake.intakeAt } : null,
      resume: upload
        ? { storageId: upload._id, uploadedAt: new Date(upload._creationTime).toISOString() }
        : null,
      resumes,
      // Strings: Convex can reorder object keys across the query boundary, changing `inputHash`.
      judgments: judgments.map(storedJudgment),
      snapshots: snapshots.map((row) => ({
        id: row.id,
        kind: row.kind,
        inputHash: row.inputHash,
        classYear: row.classYear,
        computedAt: row.computedAt,
        ...(row.correctsSnapshotId ? { correctsSnapshotId: row.correctsSnapshotId } : {}),
      })),
    };
  },
});

type StoredJudgment = Pick<
  Doc<"jevJudgments">,
  "record" | "claim" | "answer" | "probe" | "configHash" | "companySeedHash"
>;

function storedJudgment(row: StoredJudgment): StoredJudgment {
  return {
    record: row.record,
    claim: row.claim,
    answer: row.answer,
    probe: row.probe,
    configHash: row.configHash,
    companySeedHash: row.companySeedHash,
  };
}

function parseJudgment(row: StoredJudgment): ClaimJudgment {
  return {
    record: JSON.parse(row.record),
    claim: JSON.parse(row.claim),
    answer: JSON.parse(row.answer),
    probe: row.probe === null ? null : JSON.parse(row.probe),
    configHash: row.configHash,
    companySeedHash: row.companySeedHash,
  };
}

export const recentCompanyResearch = internalQuery({
  args: { orgKeys: v.array(v.string()), since: v.number() },
  handler: async (ctx, { orgKeys, since }) => {
    const recent: string[] = [];
    for (const orgKey of orgKeys) {
      const row = await ctx.db
        .query("companyResearchRequests")
        .withIndex("by_org", (q) => q.eq("orgKey", orgKey).gte("requestedAt", since))
        .first();
      if (row) recent.push(orgKey);
    }
    return recent;
  },
});

async function ensureIntakeRow(
  ctx: MutationCtx,
  clubId: Id<"clubs">,
  person: { id: string; createdAt: string },
): Promise<boolean> {
  const existing = await ctx.db
    .query("evidenceIntakes")
    .withIndex("by_person", (q) => q.eq("personId", person.id))
    .unique();
  if (existing) return false;
  const intakeAt = new Date(person.createdAt);
  await ctx.db.insert("evidenceIntakes", {
    clubId,
    personId: person.id,
    intakeAt: intakeAt.toISOString(),
    nextDueAt: nextSnapshot(intakeAt, new Set())?.dueAt.getTime() ?? null,
  });
  return true;
}

export const ensureIntake = internalMutation({
  args: { personId: v.string() },
  handler: async (ctx, { personId }) => {
    const club = await loadClub(ctx.db);
    if (!club) return false;
    const person = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_domain_id", (q) => q.eq("clubId", club._id).eq("id", personId))
      .unique();
    if (!person) return false;
    await ensureIntakeRow(ctx, club._id, person);
    return true;
  },
});

export const storeResumeVersion = internalMutation({
  args: {
    clubId: v.id("clubs"),
    personId: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.string(),
    rawText: v.string(),
    normalized: v.boolean(),
    lines: v.array(
      v.object({ lineId: v.string(), statement: v.string(), publishedAt: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("resumeVersions")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (existing) return existing._id;
    const versionId = await ctx.db.insert("resumeVersions", {
      clubId: args.clubId,
      personId: args.personId,
      storageId: args.storageId,
      uploadedAt: args.uploadedAt,
      extractedAt: new Date().toISOString(),
      rawText: args.rawText,
      normalized: args.normalized,
      lineCount: args.lines.length,
    });
    for (const [index, line] of args.lines.entries()) {
      await ctx.db.insert("resumeLines", { resumeVersionId: versionId, index, ...line });
    }
    return versionId;
  },
});

export const storeJudgments = internalMutation({
  args: {
    clubId: v.id("clubs"),
    personId: v.string(),
    judgments: v.array(v.string()),
  },
  handler: async (ctx, { clubId, personId, judgments }) => {
    const stored: StoredJudgment[] = [];
    for (const raw of judgments) {
      const judgment = JSON.parse(raw) as ClaimJudgment;
      const { record, claim } = judgment;
      if (record.personId !== personId || claim.personId !== personId) {
        throw new Error(`storeJudgments: record ${record.id} is not ${personId}'s`);
      }
      if (claim.author !== "candidate" && claim.author !== "system") {
        throw new Error(`storeJudgments: claim ${claim.id} has no producer author`);
      }
      const byRecord = await ctx.db
        .query("jevJudgments")
        .withIndex("by_record", (q) => q.eq("recordId", record.id))
        .first();
      const byEvidence = await ctx.db
        .query("jevJudgments")
        .withIndex("by_person_and_evidence_key", (q) =>
          q.eq("personId", personId).eq("evidenceKey", record.evidenceKey),
        )
        .first();
      const existing = byRecord ?? byEvidence;
      if (existing) {
        stored.push(storedJudgment(existing));
        continue;
      }
      const row: WithoutSystemFields<Doc<"jevJudgments">> = {
        clubId,
        personId,
        recordId: record.id,
        evidenceKey: record.evidenceKey,
        specId: record.specId,
        kind: "claim",
        source: claim.source,
        author: claim.author,
        claimId: claim.id,
        record: JSON.stringify(record),
        claim: JSON.stringify(claim),
        answer: JSON.stringify(judgment.answer),
        probe: judgment.probe === null ? null : JSON.stringify(judgment.probe),
        configHash: judgment.configHash,
        companySeedHash: judgment.companySeedHash,
        writtenAt: new Date().toISOString(),
      };
      await ctx.db.insert("jevJudgments", row);
      stored.push(storedJudgment(row));
    }
    return stored;
  },
});

export const recordResumeKeys = internalMutation({
  args: { storageId: v.id("_storage"), evidenceKeys: v.array(v.string()) },
  handler: async (ctx, { storageId, evidenceKeys }) => {
    const version = await ctx.db
      .query("resumeVersions")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (!version) throw new Error(`recordResumeKeys: no resume version for ${storageId}`);
    if (version.evidenceKeys?.join("\n") === evidenceKeys.join("\n")) return;
    await ctx.db.patch(version._id, { evidenceKeys });
  },
});

const snapshotRow = v.object({
  id: v.string(),
  candidateId: v.string(),
  kind: snapshotKind,
  evidenceCutoff: v.string(),
  computedAt: v.string(),
  substance: v.number(),
  selection: v.union(v.number(), v.null()),
  thin: v.boolean(),
  claimCount: v.number(),
  classYear: v.union(v.number(), v.null()),
  inputHash: v.string(),
  configHash: v.string(),
  correctsSnapshotId: v.optional(v.string()),
});

export const writeSnapshots = internalMutation({
  args: { clubId: v.id("clubs"), personId: v.string(), rows: v.array(snapshotRow) },
  handler: async (ctx, { clubId, personId, rows }) => {
    let written = 0;
    for (const row of rows) {
      if (row.candidateId !== personId) throw new Error("writeSnapshots: wrong candidate");
      const ofKind = await ctx.db
        .query("evidenceSnapshots")
        .withIndex("by_candidate_and_kind", (q) =>
          q.eq("candidateId", personId).eq("kind", row.kind),
        )
        .collect();
      const current = currentSnapshot(ofKind, row.kind);
      if (current?.inputHash === row.inputHash) continue;
      if ((current?.id ?? undefined) !== row.correctsSnapshotId) continue;
      await ctx.db.insert("evidenceSnapshots", { clubId, ...row });
      written += 1;
    }
    const intake = await ctx.db
      .query("evidenceIntakes")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .unique();
    if (intake) {
      const all = await ctx.db
        .query("evidenceSnapshots")
        .withIndex("by_candidate_and_kind", (q) => q.eq("candidateId", personId))
        .collect();
      const kinds = new Set<SnapshotKind>(all.map((row) => row.kind));
      await ctx.db.patch(intake._id, {
        nextDueAt: nextSnapshot(new Date(intake.intakeAt), kinds)?.dueAt.getTime() ?? null,
        lastCheckedAt: Date.now(),
        attempts: undefined,
        retryAfter: undefined,
      });
    }
    return written;
  },
});

export const beginCheck = internalMutation({
  args: { personId: v.string() },
  handler: async (ctx, { personId }) => {
    const intake = await ctx.db
      .query("evidenceIntakes")
      .withIndex("by_person", (q) => q.eq("personId", personId))
      .unique();
    if (!intake) return;
    const attempts = (intake.attempts ?? 0) + 1;
    await ctx.db.patch(intake._id, {
      attempts,
      retryAfter: Date.now() + retryBackoffMs(attempts),
    });
  },
});

export const recordCompanyResearch = internalMutation({
  args: { runId: v.string(), orgs: v.array(v.string()) },
  handler: async (ctx, { runId, orgs }) => {
    const requestedAt = Date.now();
    for (const org of orgs) {
      await ctx.db.insert("companyResearchRequests", {
        orgKey: normalizeOrgName(org),
        org,
        runId,
        requestedAt,
      });
    }
  },
});

export const daily = internalMutation({
  args: {},
  handler: async (ctx) => {
    const club = await loadClub(ctx.db);
    if (!club) return { scheduled: 0 };
    const candidates = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_status", (q) => q.eq("clubId", club._id).eq("status", "candidate"))
      .collect();
    for (const person of candidates) await ensureIntakeRow(ctx, club._id, person);
    const now = Date.now();
    const due = await notBackedOff(
      ctx.db
        .query("evidenceIntakes")
        .withIndex("by_next_due", (q) => q.gte("nextDueAt", 0).lte("nextDueAt", now)),
      now,
    );
    const stale = await notBackedOff(
      ctx.db
        .query("evidenceIntakes")
        .withIndex("by_last_checked", (q) => q.lt("lastCheckedAt", now - RECHECK_DAYS * DAY_MS)),
      now,
    );
    const personIds = [...new Set([...due, ...stale].map((intake) => intake.personId))].slice(
      0,
      DAILY_BATCH,
    );
    for (const personId of personIds) {
      await ctx.scheduler.runAfter(0, internal.evidence.check, { personId });
    }
    return { scheduled: personIds.length, due: due.length };
  },
});

async function notBackedOff(
  rows: AsyncIterable<Doc<"evidenceIntakes">>,
  now: number,
): Promise<Doc<"evidenceIntakes">[]> {
  const picked: Doc<"evidenceIntakes">[] = [];
  for await (const intake of rows) {
    if (intake.retryAfter !== undefined && intake.retryAfter > now) continue;
    picked.push(intake);
    if (picked.length >= DAILY_BATCH) break;
  }
  return picked;
}

export const intake = internalAction({
  args: { personId: v.string() },
  handler: async (ctx, { personId }) => {
    if (!(await ctx.runMutation(internal.evidence.ensureIntake, { personId }))) return null;
    return await runCheck(ctx, personId);
  },
});

export const check = internalAction({
  args: { personId: v.string() },
  handler: async (ctx, { personId }) => await runCheck(ctx, personId),
});

type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

async function loadContext(ctx: ActionCtx, personId: string) {
  const found = await ctx.runQuery(internal.evidence.context, { personId });
  return found ? { ...found, judgments: found.judgments.map(parseJudgment) } : null;
}

async function runCheck(ctx: ActionCtx, personId: string) {
  let found = await loadContext(ctx, personId);
  if (!found?.intake) return null;
  await ctx.runMutation(internal.evidence.beginCheck, { personId });
  const versionAdded = await pickUpResume(ctx, found);
  if (versionAdded) found = (await loadContext(ctx, personId)) ?? found;
  const github = await fetchGitHub(ctx, found);
  await requestCompanyResearch(ctx, found);
  const scored = await scoreNewClaims(ctx, found, github ?? []);
  if (github === null) {
    // Fails closed: partial GitHub evidence writes no snapshot, so the
    // candidate stays due and is retried after `beginCheck`'s backoff.
    return { versionAdded, scored: scored.length, snapshots: 0, githubFailed: true };
  }
  const stored = (await loadContext(ctx, personId)) ?? found;
  const snapshots = await writeDueSnapshots(ctx, stored, stored.judgments);
  return { versionAdded, scored: scored.length, snapshots, githubFailed: false };
}

async function pickUpResume(ctx: ActionCtx, found: Context): Promise<boolean> {
  const resume = found.resume;
  if (!resume || found.resumes.some((version) => version.storageId === resume.storageId)) {
    return false;
  }
  const rawText = await ctx.runAction(internal.evidenceNode.extractResumeText, {
    storageId: resume.storageId,
  });
  if (rawText === null) return false;
  const raw = rawResumeLines(rawText);
  const normalized = !parsesAsResume(raw);
  const lines = normalized
    ? rebuildResumeLines(raw, await labelResumeLines(raw, createJevClient()))
    : raw;
  await ctx.runMutation(internal.evidence.storeResumeVersion, {
    clubId: found.clubId,
    personId: found.person.id,
    storageId: resume.storageId,
    uploadedAt: resume.uploadedAt,
    rawText,
    normalized,
    lines: claimLines(lines, resume.uploadedAt).map((line) => ({
      lineId: line.id,
      statement: line.statement,
      publishedAt: line.publishedAt ?? resume.uploadedAt,
    })),
  });
  return true;
}

async function fetchGitHub(ctx: ActionCtx, found: Context): Promise<GitHubArtifact[] | null> {
  const username = githubUsername(found.person.github ?? undefined);
  if (!username) return [];
  try {
    return await ctx.runAction(internal.evidenceNode.fetchGitHub, { username });
  } catch (error) {
    console.warn(`evidence: GitHub fetch for ${found.person.id} failed: ${String(error)}`);
    return null;
  }
}

async function requestCompanyResearch(ctx: ActionCtx, found: Context): Promise<void> {
  const work = found.resumes.flatMap((version) => companyWorklist(version.lines));
  const unseeded = new Map<string, (typeof work)[number]>();
  for (const item of work) {
    if (item.seeded !== null) continue;
    const key = normalizeOrgName(item.org);
    if (!unseeded.has(key)) unseeded.set(key, item);
  }
  if (unseeded.size === 0) return;
  const recent = new Set(
    await ctx.runQuery(internal.evidence.recentCompanyResearch, {
      orgKeys: [...unseeded.keys()],
      since: Date.now() - COMPANY_RESEARCH_FRESH_MS,
    }),
  );
  const worklist = [...unseeded.entries()]
    .filter(([key]) => !recent.has(key))
    .map(([, item]) => ({ org: item.org, titles: item.titles, startedAt: item.earliestStartedAt }));
  if (worklist.length === 0) return;
  try {
    await ctx.runAction(internal.evidenceNode.requestCompanyResearch, { worklist });
  } catch (error) {
    console.warn(`evidence: company research request failed: ${String(error)}`);
  }
}

async function scoreNewClaims(
  ctx: ActionCtx,
  found: Context,
  github: readonly GitHubArtifact[],
): Promise<ClaimJudgment[]> {
  const versions = githubVersionsToScore(
    github,
    storedGitHubVersions(
      found.judgments
        .filter((judgment) => judgment.claim.source === "github")
        .map((judgment) => judgment.record.evidenceKey),
    ),
  );
  for (const sourceId of versions.undatable) {
    console.warn(
      `evidence: ${found.person.id} ${sourceId} has text with no change date after its previous version (creation or stored); that version is not scored`,
    );
  }
  const newest = found.resumes.at(-1);
  const sources = [
    ...(newest ? [{ evidence: resumeEvidence(newest.lines), storageId: newest.storageId }] : []),
    ...(versions.items.length > 0
      ? [{ evidence: githubEvidence(versions.items), storageId: null }]
      : []),
  ];
  if (sources.length === 0) return [];
  const client = createJevClient();
  const known: ClaimJudgment[] = [...found.judgments];
  const written: ClaimJudgment[] = [];
  for (const { evidence, storageId } of sources) {
    const run = await judgeClaimsV12({ personId: found.person.id, evidence, known, client });
    if (storageId !== null) {
      await ctx.runMutation(internal.evidence.recordResumeKeys, {
        storageId,
        evidenceKeys: [...new Set(run.keys)].sort(),
      });
    }
    for (const failure of run.failed) {
      console.warn(`evidence: claim ${failure.claimId} not recorded: ${failure.error}`);
    }
    if (run.written.length === 0) continue;
    const stored = await ctx.runMutation(internal.evidence.storeJudgments, {
      clubId: found.clubId,
      personId: found.person.id,
      judgments: run.written.map((judgment) => JSON.stringify(judgment)),
    });
    const canonical = stored.map(parseJudgment);
    known.push(...canonical);
    written.push(...canonical);
  }
  return written;
}

async function writeDueSnapshots(
  ctx: ActionCtx,
  found: Context,
  judgments: readonly ClaimJudgment[],
): Promise<number> {
  if (!found.intake) return 0;
  const intakeAt = new Date(found.intake.intakeAt);
  const now = new Date();
  const kinds = dueSnapshotKinds(intakeAt, now);
  const claims = judgments.map((judgment) => judgment.claim);
  const records = judgments.map((judgment) => judgment.record);
  const resumeKeys = new Set(found.resumes.at(-1)?.evidenceKeys ?? []);
  const rows: SnapshotRow[] = [];
  const existing = [...found.snapshots];
  for (const kind of SNAPSHOT_KINDS.filter((candidate) => kinds.includes(candidate))) {
    const row = planSnapshot({
      candidateId: found.person.id,
      kind,
      intakeAt,
      now,
      claims,
      records,
      resumeKeys,
      existing,
      classYear: found.person.classYear,
      newId: () => `snap-${crypto.randomUUID()}`,
    });
    if (row === null) continue;
    rows.push(row);
    existing.push(row);
  }
  return await ctx.runMutation(internal.evidence.writeSnapshots, {
    clubId: found.clubId,
    personId: found.person.id,
    rows,
  });
}

export const setClassYear = mutation({
  args: { personId: v.string(), classYear: v.union(v.number(), v.null()) },
  handler: async (ctx, { personId, classYear }) => {
    await requireAdmin(ctx);
    if (
      classYear !== null &&
      !(Number.isInteger(classYear) && classYear >= 1900 && classYear <= 2100)
    ) {
      throw new Error("class year must be a four-digit year");
    }
    const club = await loadClub(ctx.db);
    if (!club) throw new Error("Club is not set up yet.");
    const person = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_domain_id", (q) => q.eq("clubId", club._id).eq("id", personId))
      .unique();
    if (!person) throw new Error("unknown person");
    await ctx.db.patch(person._id, { classYear: classYear ?? undefined });
  },
});
