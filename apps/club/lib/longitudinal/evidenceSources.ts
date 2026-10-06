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
 * GitHub claims, one line per fetched artifact.
 *
 * A GitHub line has no job header, so its job dates come from `publishedAt`,
 * and `publishedAt` must be the artifact's own date: the repository's
 * creation, the release, or the push (`fetchGitHubEvidence` reads
 * `created_at` off the repo or the event). Never the date it was fetched.
 * The daily check refetches every candidate's GitHub; a fetch-time date would
 * re-date old work as new at every snapshot and manufacture movement.
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
      // `updated_at`), which changes between fetches; the claim's digest does not.
      return { ...item, contentHash: claimDigest(claim, datesFor(line)) };
    },
  };
}
