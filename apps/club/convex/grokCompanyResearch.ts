import { v } from "convex/values";
import {
  checkGrokCallbackToken,
  GROK_CALLBACK_MAX_BYTES,
  GROK_CALLBACK_TOKEN_HEADER,
} from "../lib/longitudinal/grokCallback.ts";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";

export const store = internalMutation({
  args: { runId: v.string(), body: v.string() },
  handler: async (ctx, { runId, body }) => {
    const existing = await ctx.db
      .query("grokCompanyResearch")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    const row = { runId, body, receivedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("grokCompanyResearch", row);
  },
});

export const reply = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const row = await ctx.db
      .query("grokCompanyResearch")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    return row?.body ?? null;
  },
});

function reject(status: number, reason: string, runId: string | null): Response {
  console.warn(`grok company research ${status} runId=${runId ?? "-"}: ${reason}`);
  return new Response(reason, { status });
}

async function authorizedRunId(
  request: Request,
  purpose: "post" | "read",
): Promise<{ runId: string } | Response> {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return reject(400, "missing runId", null);
  const masterKey = process.env.GROK_CALLBACK_MASTER_KEY ?? "";
  if (masterKey.length === 0) return reject(500, "callback master key is not set", runId);
  const presented = request.headers.get(GROK_CALLBACK_TOKEN_HEADER);
  if (!(await checkGrokCallbackToken(masterKey, runId, purpose, presented))) {
    return reject(401, "bad callback token", runId);
  }
  return { runId };
}

export const post = httpAction(async (ctx, request) => {
  const auth = await authorizedRunId(request, "post");
  if (auth instanceof Response) return auth;
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > GROK_CALLBACK_MAX_BYTES) return reject(413, "body too large", auth.runId);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > GROK_CALLBACK_MAX_BYTES) {
    return reject(413, "body too large", auth.runId);
  }
  await ctx.runMutation(internal.grokCompanyResearch.store, { runId: auth.runId, body });
  return new Response(null, { status: 200 });
});

export const get = httpAction(async (ctx, request) => {
  const auth = await authorizedRunId(request, "read");
  if (auth instanceof Response) return auth;
  const body = await ctx.runQuery(internal.grokCompanyResearch.reply, { runId: auth.runId });
  if (body === null) return new Response(null, { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
});
