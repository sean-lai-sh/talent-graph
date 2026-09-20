import type { CanonicalIdentity, GrokEvidencePacket } from "../../../../src/longitudinal/types.ts";

export interface GrokRoutineRequest {
  schemaVersion: "1";
  person: {
    personId: string;
    name: string;
    aliases: string[];
    knownIdentities: Array<{ source: string; externalId: string; url: string }>;
  };
  from: string;
  cutoffAt: string;
  callbackUrl: string;
  instructions: string;
}

export function buildGrokRoutineRequest(input: {
  identity: CanonicalIdentity;
  from: Date;
  cutoffAt: Date;
  callbackUrl: string;
}): GrokRoutineRequest {
  return {
    schemaVersion: "1",
    person: {
      personId: input.identity.personId,
      name: input.identity.name,
      aliases: [...input.identity.aliases],
      knownIdentities: input.identity.externalIdentities.map((entry) => ({
        source: entry.source,
        externalId: entry.externalId,
        url: entry.url,
      })),
    },
    from: input.from.toISOString(),
    cutoffAt: input.cutoffAt.toISOString(),
    callbackUrl: input.callbackUrl,
    instructions:
      "Use web_search and x_search only for the named person and known identities. " +
      "Return dated, cited evidence; do not infer outcomes from engagement or self-description. " +
      "POST a GrokEvidencePacket schemaVersion 1 to callbackUrl. Exclude evidence after cutoffAt.",
  };
}

/**
 * Trigger a saved Grok Bot routine. HTTP 200 means accepted, not completed;
 * completion arrives separately at the evidence callback.
 */
export async function triggerGrokRoutine(
  webhookUrl: string,
  bearerKey: string,
  request: GrokRoutineRequest,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(webhookUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Grok routine rejected: ${response.status}`);
  }
}

export interface GrokCallbackEnvelope {
  packet: GrokEvidencePacket;
  signature?: string;
}
