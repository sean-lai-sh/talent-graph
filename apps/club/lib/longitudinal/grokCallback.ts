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
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}:${runId}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkGrokCallbackToken(
  masterKey: string,
  runId: string,
  purpose: GrokTokenPurpose,
  presented: string | null,
): Promise<boolean> {
  if (masterKey.length === 0 || presented === null) return false;
  // The routine is an LLM agent echoing the token; tolerate case and padding.
  const token = presented.trim().toLowerCase();
  const expected = await grokCallbackToken(masterKey, runId, purpose);
  if (token.length !== expected.length) return false;
  // node:crypto's timingSafeEqual is unavailable in the Convex default runtime.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export type GrokCallbackAuth =
  | { ok: true; runId: string }
  | { ok: false; status: 400 | 401 | 500; reason: string; runId: string | null };

/** The route's decision for a request to `GROK_CALLBACK_PATH`, before any body is read. */
export async function authorizeGrokCallback(
  requestUrl: string,
  presented: string | null,
  masterKey: string,
  purpose: GrokTokenPurpose,
): Promise<GrokCallbackAuth> {
  const runId = new URL(requestUrl).searchParams.get("runId");
  if (!runId) return { ok: false, status: 400, reason: "missing runId", runId: null };
  if (masterKey.length === 0) {
    return { ok: false, status: 500, reason: "callback master key is not set", runId };
  }
  if (!(await checkGrokCallbackToken(masterKey, runId, purpose, presented))) {
    return { ok: false, status: 401, reason: "bad callback token", runId };
  }
  return { ok: true, runId };
}

export function grokCallbackUrl(siteUrl: string, runId: string): string {
  const url = new URL(GROK_CALLBACK_PATH, siteUrl);
  url.searchParams.set("runId", runId);
  return url.toString();
}
