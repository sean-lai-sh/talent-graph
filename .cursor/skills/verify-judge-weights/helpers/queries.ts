/**
 * Live admin-only gate. Public queries are already classified. Admin-only
 * queries must reject the member. Every member response is scanned for
 * weight keys, and a member-facing query whose admin payload has a weight
 * key fails too.
 */

import type { GatedQuery } from "./classify.ts";
import { scanWeightKeys, type WeightHit } from "./scan.ts";

const KNOWN_ARGS: Record<string, Record<string, unknown>> = {
  "auth:getCurrentUser": {},
  "club:getOrganization": {},
  "club:getBoard": {},
  "club:getMyRole": {},
  "club:listPosts": {},
  "club:listMembers": {},
  "club:listMyFeedback": {},
  "referral:lookupReferralContact": { contact: "edd.pike@example.test" },
  "referral:referralStatus": { token: "verify-judge-weights" },
  "comparisonStep:getComparisonStep": { personId: "ex-app-edd" },
};

export async function sessionToken(
  appUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const signIn = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appUrl },
    body: JSON.stringify({ email, password }),
  });
  const signInBody = await signIn.text();
  if (!signIn.ok) {
    throw new Error(`sign-in failed HTTP ${signIn.status}: ${signInBody.slice(0, 180)}`);
  }
  const setCookie = signIn.headers.getSetCookie?.() ?? [];
  const cookie = setCookie
    .map((item) => item.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
  if (cookie === "") throw new Error("sign-in returned no session cookie");
  const tokenRes = await fetch(`${appUrl}/api/auth/convex/token`, {
    headers: { cookie, origin: appUrl },
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok)
    throw new Error(`convex token HTTP ${tokenRes.status}: ${tokenText.slice(0, 180)}`);
  const parsed = JSON.parse(tokenText) as { token?: string };
  if (!parsed.token) throw new Error("convex token missing");
  return parsed.token;
}

type CallResult = { ok: true; value: unknown } | { ok: false; error: string };

async function callQuery(
  convexUrl: string,
  token: string,
  ref: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const response = await fetch(`${convexUrl}/api/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: ref, args, format: "json" }),
  });
  const text = await response.text();
  let parsed: { status?: string; value?: unknown; errorMessage?: string };
  try {
    parsed = JSON.parse(text) as { status?: string; value?: unknown; errorMessage?: string };
  } catch {
    return { ok: false, error: text.slice(0, 240) };
  }
  if (parsed.status === "success") return { ok: true, value: parsed.value ?? null };
  if (parsed.status === "error") {
    return { ok: false, error: parsed.errorMessage ?? text.slice(0, 240) };
  }
  return { ok: false, error: text.slice(0, 240) };
}

export function isRejection(result: CallResult): boolean {
  if (!result.ok) return true;
  if (result.value === null || result.value === undefined) return true;
  if (typeof result.value !== "object" || Array.isArray(result.value)) return false;
  const record = result.value as { ok?: unknown; error?: unknown };
  const keys = Object.keys(record);
  if (keys.length === 0 || !keys.every((key) => key === "ok" || key === "error")) return false;
  if (
    record.ok === true &&
    (record.error === undefined || record.error === null || record.error === "")
  ) {
    return false;
  }
  return true;
}

export function probeFailures(
  query: { ref: string; audience: "member" | "admin" },
  adminResult: CallResult,
  memberResult: CallResult,
): string[] {
  const failures: string[] = [];
  if (!adminResult.ok) {
    failures.push(`${query.ref} admin call failed: ${adminResult.error.slice(0, 240)}`);
  }
  if (query.audience === "member" && !memberResult.ok) {
    failures.push(`${query.ref} member call failed: ${memberResult.error.slice(0, 240)}`);
  }
  const adminHits = adminResult.ok ? scanWeightKeys(adminResult.value) : [];
  const memberHits = memberResult.ok ? scanWeightKeys(memberResult.value) : [];
  if (query.audience === "admin" && !isRejection(memberResult)) {
    failures.push(`${query.ref} is admin-only and the member was not rejected`);
  }
  if (query.audience === "member" && adminHits.length > 0) {
    failures.push(
      `${query.ref} is member-facing but the admin payload has weight keys: ${adminHits.map((hit) => hit.path).join(", ")}`,
    );
  }
  if (memberHits.length > 0) {
    failures.push(
      `${query.ref} member payload has weight keys: ${memberHits.map((hit) => hit.path).join(", ")}`,
    );
  }
  return failures;
}

export type QueryScan = {
  ref: string;
  audience: "member" | "admin";
  memberRejected: boolean;
  hits: WeightHit[];
  memberPreview: string;
};

export async function scanMemberQueries(input: {
  appUrl: string;
  convexUrl: string;
  email: string;
  password: string;
  adminEmail: string;
  queries: readonly GatedQuery[];
}): Promise<{ scans: QueryScan[]; hits: WeightHit[]; failures: string[] }> {
  const queries = input.queries.filter(
    (query): query is GatedQuery & { audience: "member" | "admin" } =>
      query.audience === "member" || query.audience === "admin",
  );
  const failures: string[] = [];
  for (const query of queries) {
    if (!(query.ref in KNOWN_ARGS) && !query.argsEmpty) {
      failures.push(`uncatalogued public query ${query.ref}`);
    }
  }
  if (failures.length > 0) return { scans: [], hits: [], failures };

  const adminToken = await sessionToken(input.appUrl, input.adminEmail, input.password);
  const memberToken = await sessionToken(input.appUrl, input.email, input.password);

  const scans: QueryScan[] = [];
  const hits: WeightHit[] = [];
  for (const query of queries) {
    const args = KNOWN_ARGS[query.ref] ?? {};
    const adminResult = await callQuery(input.convexUrl, adminToken, query.ref, args);
    const memberResult = await callQuery(input.convexUrl, memberToken, query.ref, args);
    const memberHits = memberResult.ok ? scanWeightKeys(memberResult.value) : [];
    for (const hit of memberHits) {
      hits.push({ path: `${query.ref}.${hit.path}`, key: hit.key });
    }
    const memberRejected = isRejection(memberResult);
    failures.push(...probeFailures(query, adminResult, memberResult));
    const preview = memberResult.ok
      ? JSON.stringify(memberResult.value).slice(0, 240)
      : `rejected: ${memberResult.error.slice(0, 240)}`;
    scans.push({
      ref: query.ref,
      audience: query.audience,
      memberRejected,
      hits: memberHits,
      memberPreview: preview,
    });
  }
  return { scans, hits, failures };
}
