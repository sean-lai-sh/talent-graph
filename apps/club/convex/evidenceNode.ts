"use node";

import { v } from "convex/values";
import { GROK_COMPANY_RESEARCH_DELIVERY, triggerGrokRoutine } from "../lib/longitudinal/grok.ts";
import { grokCallbackToken, grokCallbackUrl } from "../lib/longitudinal/grokCallback.ts";
import { extractPdfText } from "../lib/longitudinal/resumePdf.ts";
import { fetchGitHubArtifacts, type JsonFetcher } from "../lib/longitudinal/sources.ts";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// unpdf's pdf.js fails in the default Convex runtime ("structuredClone with transfer not supported").

export const extractResumeText = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<string | null> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) return null;
    return await extractPdfText(new Uint8Array(await blob.arrayBuffer()));
  },
});

// Dates are each artifact's own (`created_at` / `updated_at`, the event's date), never the fetch date.
export const fetchGitHub = internalAction({
  args: { username: v.string() },
  handler: async (_ctx, { username }) => {
    const token = process.env.GITHUB_TOKEN;
    const fetchJson: JsonFetcher = async (url, init) => {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${url}`);
      return response.json();
    };
    return await fetchGitHubArtifacts(username, new Date(0), new Date(), fetchJson);
  },
});

const BATCH = 10;

const workItem = v.object({
  org: v.string(),
  titles: v.array(v.string()),
  startedAt: v.union(v.string(), v.null()),
});

export const requestCompanyResearch = internalAction({
  args: { worklist: v.array(workItem) },
  handler: async (ctx, { worklist }) => {
    const webhookUrl = process.env.GROK_ROUTINE_WEBHOOK_URL;
    const key = process.env.GROK_ROUTINE_KEY;
    const masterKey = process.env.GROK_CALLBACK_MASTER_KEY;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!webhookUrl || !key || !masterKey || !siteUrl) {
      console.warn("company research: Grok routine env is not set; nothing requested");
      return { runs: 0 };
    }
    let runs = 0;
    for (let start = 0; start < worklist.length; start += BATCH) {
      const batch = worklist.slice(start, start + BATCH);
      const runId = crypto.randomUUID();
      await triggerGrokRoutine(webhookUrl, key, {
        runId,
        worklist: batch,
        callbackUrl: grokCallbackUrl(siteUrl, runId),
        callbackToken: await grokCallbackToken(masterKey, runId, "post"),
        delivery: GROK_COMPANY_RESEARCH_DELIVERY,
      });
      await ctx.runMutation(internal.evidence.recordCompanyResearch, {
        runId,
        orgs: batch.map((item) => item.org),
      });
      runs += 1;
    }
    return { runs };
  },
});
