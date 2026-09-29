import { createHmac, timingSafeEqual } from "node:crypto";
import type { CanonicalIdentity, GrokEvidencePacket } from "../../../../src/longitudinal/types.ts";
import { GROK_CALLBACK_TOKEN_HEADER } from "./grokCallback.ts";

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
 * The routine follows this from the trigger body even when its saved text
 * says to answer in chat (probe run 610a2442…, 2026-09-29).
 */
export const GROK_COMPANY_RESEARCH_DELIVERY =
  "When done, send the result JSON with an HTTP POST to callbackUrl, Content-Type " +
  `application/json, and header ${GROK_CALLBACK_TOKEN_HEADER}: <callbackToken>. ` +
  "The POST is the delivery; a chat reply alone is not enough.";

/** Trigger body for the company-research routine (SEA-75). It POSTs its reply to `callbackUrl`. */
export interface GrokCompanyResearchRequest {
  runId: string;
  worklist: Array<{ org: string; titles: string[]; startedAt: string | null }>;
  callbackUrl: string;
  /** Per-run token the routine echoes in `X-Grok-Callback-Token`. */
  callbackToken: string;
  delivery: string;
}

/**
 * Trigger a saved Grok Bot routine and return its run UUID. HTTP 200 means
 * accepted, not completed; completion arrives separately at the callback.
 */
export async function triggerGrokRoutine(
  webhookUrl: string,
  bearerKey: string,
  request: GrokRoutineRequest | GrokCompanyResearchRequest,
  fetcher: typeof fetch = fetch,
): Promise<string> {
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
  const accepted = (await response.json().catch(() => null)) as {
    success?: unknown;
    runUuid?: unknown;
  } | null;
  if (accepted?.success !== true || typeof accepted.runUuid !== "string") {
    throw new Error(`Grok routine did not start a run: ${JSON.stringify(accepted)}`);
  }
  return accepted.runUuid;
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
