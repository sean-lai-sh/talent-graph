import { createHmac, timingSafeEqual } from "node:crypto";
import type { CanonicalIdentity, GrokEvidencePacket } from "../../../../src/longitudinal/types.ts";

export interface GrokRoutineRequest {
  schemaVersion: "1";
  runId: string;
  person: {
    personId: string;
    name: string;
    aliases: string[];
    knownIdentities: Array<{ source: string; externalId: string; url: string }>;
  };
  from: string;
  cutoffAt: string;
  callbackUrl: string;
  /** Per-run secret. Never reuse this as an application-wide credential. */
  callbackSigningSecret: string;
  instructions: string;
}

export function buildGrokRoutineRequest(input: {
  runId: string;
  identity: CanonicalIdentity;
  from: Date;
  cutoffAt: Date;
  callbackUrl: string;
  callbackSigningSecret: string;
}): GrokRoutineRequest {
  return {
    schemaVersion: "1",
    runId: input.runId,
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
    callbackSigningSecret: input.callbackSigningSecret,
    instructions:
      "Use web_search and x_search only for the named person and known identities. " +
      "Return dated, cited evidence; do not infer outcomes from engagement or self-description. " +
      "POST a GrokEvidencePacket schemaVersion 1 to callbackUrl. Exclude evidence after cutoffAt. " +
      "Set X-Grok-Signature to sha256=<lowercase HMAC-SHA256 hex of the exact raw JSON body> " +
      "using callbackSigningSecret.",
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
  signature: string;
}

export function signGrokCallbackBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyGrokCallbackSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith("sha256=") || secret.length === 0) return false;
  const expected = Buffer.from(signGrokCallbackBody(rawBody, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
