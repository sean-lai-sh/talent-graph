/**
 * Per-run tokens for the Grok company-research callback (SEA-75). The routine
 * is an LLM agent, so it echoes a token header instead of signing the body.
 * Both tokens derive from one master key and the runId, so nothing is stored
 * before a run and only runs the script issued can post or be read.
 */

export const GROK_CALLBACK_PATH = "/grok/company-research";
export const GROK_CALLBACK_TOKEN_HEADER = "X-Grok-Callback-Token";
export const GROK_CALLBACK_MAX_BYTES = 256 * 1024;

export type GrokTokenPurpose = "post" | "read";

export async function grokCallbackToken(
  masterKey: string,
  runId: string,
  purpose: GrokTokenPurpose,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = purpose === "post" ? runId : `read:${runId}`;
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkGrokCallbackToken(
  masterKey: string,
  runId: string,
  purpose: GrokTokenPurpose,
  presented: string | null,
): Promise<boolean> {
  if (masterKey.length === 0 || presented === null) return false;
  const expected = await grokCallbackToken(masterKey, runId, purpose);
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}

export function grokCallbackUrl(siteUrl: string, runId: string): string {
  const url = new URL(GROK_CALLBACK_PATH, siteUrl);
  url.searchParams.set("runId", runId);
  return url.toString();
}
