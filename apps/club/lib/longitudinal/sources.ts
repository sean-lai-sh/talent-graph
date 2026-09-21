import { contentFingerprint } from "../../../../src/longitudinal/provenance.ts";
import type {
  CanonicalIdentity,
  CareerEventKind,
  GrokEvidenceItem,
  GrokEvidencePacket,
  SourceKind,
} from "../../../../src/longitudinal/types.ts";
import { validateGrokEvidencePacket } from "../../../../src/longitudinal/validate.ts";
import { verifyGrokCallbackSignature } from "./grok.ts";

export type JsonFetcher = (url: string, init?: RequestInit) => Promise<unknown>;

export const defaultJsonFetcher: JsonFetcher = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`source request failed: ${response.status} ${url}`);
  return response.json();
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function insideWindow(iso: string, from: Date, cutoff: Date): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time > from.getTime() && time <= cutoff.getTime();
}

function item(input: {
  source: SourceKind;
  sourceId: string;
  url: string;
  publisher: string;
  publishedAt: string;
  quotedText: string;
  statement: string;
  proposedEventKind: CareerEventKind | null;
  raw: unknown;
}): GrokEvidenceItem {
  return {
    source: input.source,
    sourceId: input.sourceId,
    url: input.url,
    publisher: input.publisher,
    publishedAt: input.publishedAt,
    quotedText: input.quotedText,
    contentHash: contentFingerprint(input.raw),
    statement: input.statement,
    proposedEventKind: input.proposedEventKind,
  };
}

export async function fetchGitHubEvidence(
  username: string,
  from: Date,
  cutoff: Date,
  fetchJson: JsonFetcher = defaultJsonFetcher,
): Promise<GrokEvidenceItem[]> {
  const headers = { Accept: "application/vnd.github+json" };
  const [reposValue, eventsValue] = await Promise.all([
    fetchJson(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=public&sort=updated&per_page=100`,
      { headers },
    ),
    fetchJson(
      `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
      { headers },
    ),
  ]);

  const evidence: GrokEvidenceItem[] = [];
  if (Array.isArray(reposValue)) {
    for (const raw of reposValue) {
      const repo = record(raw);
      if (!repo) continue;
      const createdAt = string(repo.created_at);
      const url = string(repo.html_url);
      const name = string(repo.full_name) ?? string(repo.name);
      if (
        !createdAt ||
        !url ||
        !name ||
        repo.fork === true ||
        !insideWindow(createdAt, from, cutoff)
      ) {
        continue;
      }
      const description = string(repo.description) ?? "No repository description.";
      evidence.push(
        item({
          source: "github",
          sourceId: `repo:${name}`,
          url,
          publisher: username,
          publishedAt: createdAt,
          quotedText: description,
          statement: `${username} created the public repository ${name}: ${description}`,
          proposedEventKind: "open_source_contribution",
          raw,
        }),
      );
    }
  }

  if (Array.isArray(eventsValue)) {
    for (const raw of eventsValue) {
      const event = record(raw);
      if (!event) continue;
      const createdAt = string(event.created_at);
      const id = string(event.id);
      const type = string(event.type);
      const repo = record(event.repo);
      const repoName = repo ? string(repo.name) : null;
      const payload = record(event.payload);
      const contribution = githubContributionDescription(type, payload, repoName);
      if (
        !createdAt ||
        !id ||
        !repoName ||
        contribution === null ||
        !insideWindow(createdAt, from, cutoff)
      ) {
        continue;
      }
      evidence.push(
        item({
          source: "github",
          sourceId: `event:${id}`,
          url: `https://github.com/${repoName}`,
          publisher: username,
          publishedAt: createdAt,
          quotedText: contribution,
          statement: `${username} ${contribution}.`,
          proposedEventKind: "open_source_contribution",
          raw,
        }),
      );
    }
  }
  return evidence;
}

function githubContributionDescription(
  type: string | null,
  payload: Record<string, unknown> | null,
  repoName: string | null,
): string | null {
  if (!type || !repoName) return null;
  if (type === "ReleaseEvent") return `published a release in ${repoName}`;
  if (type === "PushEvent") return `pushed commits to ${repoName}`;
  if (type === "CreateEvent" && string(payload?.ref_type) === "tag") {
    return `created a release tag in ${repoName}`;
  }
  if (type === "PullRequestEvent") {
    const pullRequest = record(payload?.pull_request);
    if (string(payload?.action) === "closed" && string(pullRequest?.merged_at)) {
      return `merged a pull request in ${repoName}`;
    }
  }
  return null;
}

export async function fetchOrcidEvidence(
  orcid: string,
  from: Date,
  cutoff: Date,
  accessToken: string,
  fetchJson: JsonFetcher = defaultJsonFetcher,
): Promise<GrokEvidenceItem[]> {
  const value = await fetchJson(`https://pub.orcid.org/v3.0/${encodeURIComponent(orcid)}/works`, {
    headers: {
      Accept: "application/vnd.orcid+json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const root = record(value);
  const groups = root?.group;
  if (!Array.isArray(groups)) return [];

  const evidence: GrokEvidenceItem[] = [];
  for (const raw of groups) {
    const group = record(raw);
    const summaries = group?.["work-summary"];
    if (!Array.isArray(summaries)) continue;
    for (const summaryRaw of summaries) {
      const summary = record(summaryRaw);
      if (!summary) continue;
      const titleOuter = record(summary.title);
      const titleInner = record(titleOuter?.title);
      const title = string(titleInner?.value);
      const putCode = summary["put-code"];
      const date = record(summary["publication-date"]);
      const year = string(record(date?.year)?.value);
      const month = string(record(date?.month)?.value);
      const day = string(record(date?.day)?.value);
      if (
        !title ||
        (typeof putCode !== "number" && typeof putCode !== "string") ||
        !year ||
        !month ||
        !day
      ) {
        continue;
      }
      const publishedAt = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`;
      if (!insideWindow(publishedAt, from, cutoff)) continue;
      const workUrl = string(record(summary.url)?.value) ?? `https://orcid.org/${orcid}`;
      evidence.push(
        item({
          source: "orcid",
          sourceId: `work:${putCode}`,
          url: workUrl,
          publisher: orcid,
          publishedAt,
          quotedText: title,
          statement: `ORCID lists the research work “${title}”.`,
          proposedEventKind: "research_output",
          raw: summaryRaw,
        }),
      );
      break;
    }
  }
  return evidence;
}

export interface GrokIngestStore {
  /**
   * Atomically claim a packet and its evidence keys.
   * Return null for a replayed run, otherwise the newly claimed item keys.
   */
  claimPacket(runId: string, itemKeys: readonly string[]): Promise<readonly string[] | null>;
}

export interface ExpectedGrokRun {
  personId: string;
  runId: string;
  cutoffAt: Date;
  signingSecret: string;
}

export function grokEvidenceItemKey(
  personId: string,
  item: Pick<GrokEvidenceItem, "sourceId" | "publishedAt" | "contentHash">,
): string {
  return `${personId}\u0000${item.sourceId}\u0000${item.publishedAt}\u0000${item.contentHash}`;
}

export async function ingestGrokEvidenceCallback(
  rawBody: string,
  signature: string,
  expected: ExpectedGrokRun,
  store: GrokIngestStore,
): Promise<GrokEvidenceItem[]> {
  if (!verifyGrokCallbackSignature(rawBody, signature, expected.signingSecret)) {
    throw new Error("invalid Grok callback signature");
  }
  const parsed: unknown = JSON.parse(rawBody);
  if (!isGrokEvidencePacket(parsed)) throw new Error("invalid Grok evidence packet");
  const packet = parsed;
  const validation = validateGrokEvidencePacket(packet);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  if (packet.personId !== expected.personId) throw new Error("Grok callback person mismatch");
  if (packet.runId !== expected.runId) throw new Error("Grok callback run mismatch");
  if (packet.cutoffAt !== expected.cutoffAt.toISOString()) {
    throw new Error("Grok callback cutoff mismatch");
  }
  const byKey = new Map(
    packet.items.map((candidate) => [grokEvidenceItemKey(packet.personId, candidate), candidate]),
  );
  const claimed = await store.claimPacket(packet.runId, [...byKey.keys()]);
  if (claimed === null) return [];
  return claimed.flatMap((key) => {
    const candidate = byKey.get(key);
    return candidate ? [candidate] : [];
  });
}

function isGrokEvidencePacket(value: unknown): value is GrokEvidencePacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const packet = value as Record<string, unknown>;
  return (
    packet.schemaVersion === "1" &&
    typeof packet.personId === "string" &&
    typeof packet.runId === "string" &&
    typeof packet.retrievedAt === "string" &&
    typeof packet.cutoffAt === "string" &&
    Array.isArray(packet.items)
  );
}

/** Test/local adapter. Production callbacks must use a durable transactional store. */
export function createInMemoryGrokIngestStore(): GrokIngestStore {
  const runIds = new Set<string>();
  const itemKeys = new Set<string>();
  return {
    async claimPacket(runId, keys) {
      if (runIds.has(runId)) return null;
      runIds.add(runId);
      const claimed = keys.filter((key) => !itemKeys.has(key));
      for (const key of claimed) itemKeys.add(key);
      return claimed;
    },
  };
}

export function knownHandle(identity: CanonicalIdentity, source: SourceKind): string | null {
  return identity.externalIdentities.find((entry) => entry.source === source)?.externalId ?? null;
}
