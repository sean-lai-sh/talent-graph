"use node";

import { v } from "convex/values";
import { GROK_COMPANY_RESEARCH_DELIVERY, triggerGrokRoutine } from "../lib/longitudinal/grok.ts";
import { grokCallbackToken, grokCallbackUrl } from "../lib/longitudinal/grokCallback.ts";
import { fetchGitHubEvidence, type JsonFetcher } from "../lib/longitudinal/sources.ts";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Node-runtime actions for evidence intake (SEA-81): `lib/longitudinal/grok.ts`
 * imports `node:crypto`, and `sources.ts` imports it in turn.
 */

/**
 * Public GitHub artifacts for one username, every one up to now. Each item is
 * dated by the artifact's own date (repo creation, release or push), which
 * `githubEvidence` turns into job dates; never the fetch date.
 */
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
      if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${url}`);
      return response.json();
    };
    return await fetchGitHubEvidence(username, new Date(0), new Date(), fetchJson);
  },
});

/**
 * Trigger the SEA-75 company-research routine for employers intake found with
 * no seed entry.
 *
 * The reply posts back to `grokCompanyResearch` (the callback route) and stays
 * there: merging it into `config.yml` is still done by hand
 * (`scripts/jev-company-worklist.ts --from` / `--apply`). Scoring reads only
 * what is merged, and each Jev record stores the config hash it was scored
 * under.
 */

/** The routine's batch size, as in `scripts/jev-company-worklist.ts`. */
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
