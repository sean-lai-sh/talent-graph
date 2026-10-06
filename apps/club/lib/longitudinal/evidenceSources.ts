import type { JobClaimLine, JobDateFields } from "../../../../src/longitudinal/claimPreprocess.ts";
import type { ScoredClaimV12 } from "../../../../src/longitudinal/claimRubricV12.ts";
import { contentFingerprint } from "../../../../src/longitudinal/provenance.ts";
import type { GrokEvidenceItem } from "../../../../src/longitudinal/types.ts";
import type { ClaimEvidence } from "./claimJudgmentV12.ts";
import type { GitHubArtifact } from "./sources.ts";

function claimDigest(claim: ScoredClaimV12, jobDates: JobDateFields): string {
  return contentFingerprint({
    text: claim.text,
    claimClass: claim.claimClass,
    titleHint: claim.titleHint,
    startedAt: jobDates.startedAt,
    endedAt: jobDates.endedAt,
  }).slice(0, 32);
}

export function resumeEvidence(lines: readonly JobClaimLine[]): ClaimEvidence {
  return {
    lines,
    source: "resume",
    author: "candidate",
    evidenceTier: "self_reported",
    evidenceItemFor(claim) {
      const digest = claimDigest(claim, claim.jobDates);
      return {
        source: "resume",
        sourceId: `resume:${digest}`,
        url: "resume",
        publisher: "resume",
        publishedAt: claim.jobDates.startedAt ?? "undated",
        quotedText: claim.text,
        contentHash: digest,
        statement: claim.statement,
        proposedEventKind: null,
      };
    },
  };
}

export function githubUsername(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  const bare = /^@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/.exec(trimmed);
  if (bare?.[1]) return bare[1];
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) return null;
    const user = url.pathname.split("/").filter(Boolean)[0];
    return user && /^[A-Za-z0-9-]{1,39}$/.test(user) ? user : null;
  } catch {
    return null;
  }
}

export function materialText(statement: string): string {
  return statement
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function versionDigest(statement: string): string {
  return contentFingerprint(materialText(statement)).slice(0, 16);
}

const VERSION_SEPARATOR = ".";

export function evidenceKeyParts(evidenceKey: string): {
  sourceId: string;
  publishedAt: string;
  versionDigest: string;
} {
  const [, sourceId, publishedAt, contentHash] = evidenceKey.split("|");
  if (sourceId === undefined || publishedAt === undefined || contentHash === undefined) {
    throw new Error(`evidence key ${evidenceKey} has no source id, date and hash`);
  }
  return {
    sourceId,
    publishedAt,
    versionDigest: contentHash.split(VERSION_SEPARATOR)[0] ?? contentHash,
  };
}

export function storedGitHubVersions(
  evidenceKeys: readonly string[],
): Map<string, { publishedAt: string; versionDigest: string }> {
  const latest = new Map<string, { publishedAt: string; versionDigest: string }>();
  for (const key of evidenceKeys) {
    const parts = evidenceKeyParts(key);
    const current = latest.get(parts.sourceId);
    if (current === undefined || Date.parse(parts.publishedAt) > Date.parse(current.publishedAt)) {
      latest.set(parts.sourceId, {
        publishedAt: parts.publishedAt,
        versionDigest: parts.versionDigest,
      });
    }
  }
  return latest;
}

// Dates are the artifact's own (`created_at`, `updated_at`, the event's date), never the fetch time:
// a fetch-time date would re-date old work as new at every snapshot.
export function githubVersionsToScore(
  artifacts: readonly GitHubArtifact[],
  stored: ReadonlyMap<string, { publishedAt: string; versionDigest: string }>,
): { items: GrokEvidenceItem[]; unchanged: number; undatable: string[] } {
  const items: GrokEvidenceItem[] = [];
  const undatable: string[] = [];
  let unchanged = 0;
  for (const artifact of artifacts) {
    const sourceId = `github:${artifact.artifactId}`;
    const current = versionDigest(artifact.item.statement);
    let latest = stored.get(sourceId);
    if (latest === undefined) {
      items.push({ ...artifact.created, sourceId });
      latest = {
        publishedAt: artifact.created.publishedAt,
        versionDigest: versionDigest(artifact.created.statement),
      };
      if (latest.versionDigest === current) continue;
    } else if (latest.versionDigest === current) {
      unchanged += 1;
      continue;
    }
    if (!(Date.parse(artifact.changedAt) > Date.parse(latest.publishedAt))) {
      undatable.push(sourceId);
      continue;
    }
    items.push({ ...artifact.item, sourceId, publishedAt: artifact.changedAt });
  }
  return { items, unchanged, undatable };
}

export function githubEvidence(items: readonly GrokEvidenceItem[]): ClaimEvidence {
  const lines: JobClaimLine[] = items.map((item, index) => ({
    id: `G${index}`,
    statement: item.statement,
    publishedAt: item.publishedAt,
  }));
  const itemByLine = new Map(lines.map((line, index) => [line.id, items[index]]));
  const itemFor = (line: JobClaimLine): GrokEvidenceItem => {
    const item = itemByLine.get(line.id);
    if (item === undefined) throw new Error(`github line ${line.id} has no item`);
    return item;
  };
  const datesFor = (line: JobClaimLine): JobDateFields => {
    const artifactDate = itemFor(line).publishedAt;
    const day = /^\d{4}-\d{2}-\d{2}/.exec(artifactDate)?.[0] ?? null;
    return { startedAt: day, endedAt: day, publishedAt: artifactDate };
  };
  return {
    lines,
    source: "github",
    author: "system",
    // GitHub ownership is not verified yet (a later step), so the claim is only self_reported.
    evidenceTier: "self_reported",
    jobDatesFor: (_claim, line) => datesFor(line),
    evidenceItemFor(claim, line) {
      const item = itemFor(line);
      const contentHash = [
        versionDigest(item.statement),
        claimDigest(claim, datesFor(line)).slice(0, 16),
      ].join(VERSION_SEPARATOR);
      return { ...item, contentHash };
    },
  };
}
