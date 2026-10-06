/**
 * The two evidence sources intake scores (SEA-81): resume lines, written by
 * the candidate, and public GitHub artifacts, gathered by the system. Each
 * says who wrote its claims, how well they are backed, and which evidence a
 * scored claim is about, for its evidence key.
 */

import type { JobClaimLine, JobDateFields } from "../../../../src/longitudinal/claimPreprocess.ts";
import type { ScoredClaimV12 } from "../../../../src/longitudinal/claimRubricV12.ts";
import { contentFingerprint } from "../../../../src/longitudinal/provenance.ts";
import type { GrokEvidenceItem } from "../../../../src/longitudinal/types.ts";
import type { ClaimEvidence } from "./claimJudgmentV12.ts";
import type { GitHubArtifact } from "./sources.ts";

/** What makes two claims the same evidence: text, class and dates, not where the line sat. */
function claimDigest(claim: ScoredClaimV12, jobDates: JobDateFields): string {
  return contentFingerprint({
    text: claim.text,
    claimClass: claim.claimClass,
    titleHint: claim.titleHint,
    startedAt: jobDates.startedAt,
    endedAt: jobDates.endedAt,
  }).slice(0, 32);
}

/**
 * Resume claims. The evidence key leaves out the resume version and its
 * upload date, so a line repeated in a later upload is the same evidence
 * and is not scored or counted twice.
 */
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

/** `https://github.com/<user>[/...]`, `github.com/<user>` or a bare handle → the username. */
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

/**
 * What counts as a material change to a GitHub artifact: a change in the text
 * Jev is shown (the claim line's statement, which carries every fact passed
 * to the model: repository name, description, event kind) once case,
 * Unicode form, punctuation and whitespace are ignored. Stars, forks and
 * `updated_at` are never shown to Jev, so they never make a new version.
 */
export function materialText(statement: string): string {
  return statement
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The digest of a statement's material text; equal digests are the same version. */
export function versionDigest(statement: string): string {
  return contentFingerprint(materialText(statement)).slice(0, 16);
}

/**
 * Joins a GitHub evidence key's `contentHash` from the version digest and the
 * claim digest. Keys stored before versioning have no separator; their whole
 * hash reads as a version digest no current statement matches.
 */
const VERSION_SEPARATOR = ".";

/** The parts of an evidence key (`evidenceKeyFor`): what it is about, and which version. */
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

/** The latest stored version of each GitHub artifact, by artifact id. */
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

/**
 * The GitHub artifact versions to score: new artifacts, and ones whose text
 * changed materially since their latest stored version. Each comes back as an
 * evidence item keyed by the artifact's identity and dated at its version:
 *
 * - the creation-time version of a new artifact (`created`: a repository's
 *   name, an event) by the artifact's own creation date (the repository's
 *   `created_at`, the event's date);
 * - every later version, by the artifact's own date of the change
 *   (`changedAt`: the repository's `updated_at`). A repository's description
 *   is one of these even the first time it is seen: GitHub serves only the
 *   current description, which may have been written long after
 *   `created_at`, so dating it at creation would let an edit made after a
 *   cutoff into that cutoff's snapshot. Dated at `updated_at`, it counts only
 *   from the first cutoff on or after that date (`claimsAtCutoff` takes the
 *   latest version dated on or before a cutoff), and earlier cutoffs keep the
 *   creation-time version.
 *
 * Never the fetch time: the daily check refetches every candidate's GitHub,
 * and a fetch-time date would re-date old work as new at every snapshot and
 * manufacture movement. A version whose own change date is not after the
 * version before it (a description whose `updated_at` is not after
 * `created_at`, or an edit whose `updated_at` is not after the stored
 * version) cannot be dated at the change, so it is left out (`undatable`)
 * rather than given a made-up date.
 */
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

/**
 * GitHub claims, one line per artifact version from `githubVersionsToScore`.
 *
 * A GitHub line has no job header, so its job dates come from the item's
 * `publishedAt`: the version's own date, never the date it was fetched.
 *
 * The evidence key is the artifact's identity (`sourceId`), the version date,
 * and a hash of the version's material text plus the claim's digest (a line
 * can split into several claims). Editing a description cosmetically leaves
 * the version as it is; a material edit adds a version with a new key, and
 * the old record stays.
 */
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
    // The artifact is fetched from GitHub, but the link to the candidate is
    // only the handle they typed into their profile: nothing shows the account
    // is theirs. Until ownership is verified (GitHub OAuth, or an identity
    // match; a later step), the claim is backed no better than the candidate's
    // own word: `self_reported`, the lowest tier (backing 0.6, against 1 for
    // `externally_verified`). The author stays "system": the system wrote it.
    evidenceTier: "self_reported",
    jobDatesFor: (_claim, line) => datesFor(line),
    evidenceItemFor(claim, line) {
      const item = itemFor(line);
      // The fetched item's own hash covers the whole API object (stars,
      // `updated_at`), which changes between fetches; neither digest here does.
      const contentHash = [
        versionDigest(item.statement),
        claimDigest(claim, datesFor(line)).slice(0, 16),
      ].join(VERSION_SEPARATOR);
      return { ...item, contentHash };
    },
  };
}
