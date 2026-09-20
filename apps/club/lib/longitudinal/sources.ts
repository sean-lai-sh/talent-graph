import { contentFingerprint } from "../../../../src/longitudinal/provenance.ts";
import type {
  CanonicalIdentity,
  CareerEventKind,
  GrokEvidenceItem,
  GrokEvidencePacket,
  SourceKind,
} from "../../../../src/longitudinal/types.ts";
import { validateGrokEvidencePacket } from "../../../../src/longitudinal/validate.ts";

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
      const updatedAt = string(repo.updated_at);
      const url = string(repo.html_url);
      const name = string(repo.full_name) ?? string(repo.name);
      if (!updatedAt || !url || !name || !insideWindow(updatedAt, from, cutoff)) continue;
      const description = string(repo.description) ?? "No repository description.";
      evidence.push(
        item({
          source: "github",
          sourceId: `repo:${name}`,
          url,
          publisher: username,
          publishedAt: updatedAt,
          quotedText: description,
          statement: `${username} maintained or published ${name}: ${description}`,
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
      if (!createdAt || !id || !type || !repoName || !insideWindow(createdAt, from, cutoff)) {
        continue;
      }
      evidence.push(
        item({
          source: "github",
          sourceId: `event:${id}`,
          url: `https://github.com/${repoName}`,
          publisher: username,
          publishedAt: createdAt,
          quotedText: `${type} in ${repoName}`,
          statement: `${username} had a public ${type} event in ${repoName}.`,
          proposedEventKind: "open_source_contribution",
          raw,
        }),
      );
    }
  }
  return evidence;
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
      const month = string(record(date?.month)?.value) ?? "01";
      const day = string(record(date?.day)?.value) ?? "01";
      if (!title || (typeof putCode !== "number" && typeof putCode !== "string") || !year) continue;
      const publishedAt = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`;
      if (!insideWindow(publishedAt, from, cutoff)) continue;
      evidence.push(
        item({
          source: "orcid",
          sourceId: `work:${putCode}`,
          url: `https://orcid.org/${orcid}`,
          publisher: orcid,
          publishedAt,
          quotedText: title,
          statement: `ORCID lists the research work “${title}”.`,
          proposedEventKind: "research_output",
          raw: summaryRaw,
        }),
      );
    }
  }
  return evidence;
}

export function ingestGrokEvidencePacket(packet: GrokEvidencePacket): GrokEvidenceItem[] {
  const validation = validateGrokEvidencePacket(packet);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const seen = new Set<string>();
  return packet.items.filter((candidate) => {
    const key = `${packet.personId}\u0000${candidate.sourceId}\u0000${candidate.publishedAt}\u0000${candidate.contentHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function knownHandle(identity: CanonicalIdentity, source: SourceKind): string | null {
  return identity.externalIdentities.find((entry) => entry.source === source)?.externalId ?? null;
}
