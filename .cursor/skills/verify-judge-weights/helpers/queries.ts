/**
 * Live admin-only gate: every public query, as a member and as an admin.
 * Weight-returning queries must reject the member. Every member response
 * is scanned for weight keys.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanWeightKeys, type WeightHit } from "./scan.ts";

export type PublicQuery = {
  module: string;
  name: string;
  ref: string;
  argsEmpty: boolean;
};

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

export function listPublicQueries(repo: string): PublicQuery[] {
  const dir = join(repo, "apps/club/convex");
  const found: PublicQuery[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.startsWith("_")) continue;
    const moduleName = file.slice(0, -3);
    const source = readFileSync(join(dir, file), "utf8");
    for (const match of source.matchAll(/export const (\w+) = query\(/g)) {
      const name = match[1] ?? "";
      const start = match.index ?? 0;
      const rest = source.slice(start);
      const next = rest.search(/\nexport /);
      const body = next < 0 ? rest : rest.slice(0, next);
      const argsEmpty = /args:\s*\{\s*\}/.test(body);
      found.push({ module: moduleName, name, ref: `${moduleName}:${name}`, argsEmpty });
    }
  }
  found.sort((a, b) => a.ref.localeCompare(b.ref));
  return found;
}

function handlerReturnsWeights(repo: string, query: PublicQuery): boolean {
  const source = readFileSync(join(repo, "apps/club/convex", `${query.module}.ts`), "utf8");
  const marker = `export const ${query.name} = query(`;
  const start = source.indexOf(marker);
  if (start < 0) return false;
  const rest = source.slice(start);
  const next = rest.search(/\nexport /);
  const body = next < 0 ? rest : rest.slice(0, next);
  return (
    body.includes("computeView") ||
    body.includes("judgeWeight") ||
    body.includes("admissionCredit") ||
    body.includes("accuracyCredit") ||
    body.includes("movementCredit")
  );
}

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

function isRejection(result: CallResult): boolean {
  if (!result.ok) return true;
  if (result.value === null || result.value === undefined) return true;
  if (typeof result.value === "object" && !Array.isArray(result.value)) {
    const keys = Object.keys(result.value);
    if (keys.length > 0 && keys.every((key) => key === "ok" || key === "error")) return true;
  }
  return false;
}

export type QueryScan = {
  ref: string;
  weightReturning: boolean;
  memberRejected: boolean;
  hits: WeightHit[];
  memberPreview: string;
};

export async function scanMemberQueries(input: {
  repo: string;
  appUrl: string;
  convexUrl: string;
  email: string;
  password: string;
  adminEmail: string;
}): Promise<{ scans: QueryScan[]; hits: WeightHit[]; failures: string[] }> {
  const queries = listPublicQueries(input.repo);
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
    const adminHits = adminResult.ok ? scanWeightKeys(adminResult.value) : [];
    const weightReturning = handlerReturnsWeights(input.repo, query) || adminHits.length > 0;
    const memberResult = await callQuery(input.convexUrl, memberToken, query.ref, args);
    const memberHits = memberResult.ok ? scanWeightKeys(memberResult.value) : [];
    for (const hit of memberHits) {
      hits.push({ path: `${query.ref}.${hit.path}`, key: hit.key });
    }
    const memberRejected = isRejection(memberResult);
    if (weightReturning && !memberRejected) {
      failures.push(`${query.ref} returns weights and the member was not rejected`);
    }
    if (memberHits.length > 0) {
      failures.push(
        `${query.ref} member payload has weight keys: ${memberHits.map((hit) => hit.path).join(", ")}`,
      );
    }
    const preview = memberResult.ok
      ? JSON.stringify(memberResult.value).slice(0, 240)
      : `rejected: ${memberResult.error.slice(0, 240)}`;
    scans.push({
      ref: query.ref,
      weightReturning,
      memberRejected,
      hits: memberHits,
      memberPreview: preview,
    });
  }
  return { scans, hits, failures };
}
