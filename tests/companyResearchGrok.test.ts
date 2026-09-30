import { describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkGrokCallbackToken,
  GROK_CALLBACK_TOKEN_HEADER,
} from "../apps/club/lib/longitudinal/grokCallback.ts";
import { main, type ResearchDeps } from "../scripts/jev-company-worklist.ts";
import { parseGrokResearchResponse } from "../src/longitudinal/companyResearch.ts";
import { parseProjectConfig, projectConfigPath } from "../src/projectConfig/load.ts";
import { hashInputs } from "../src/provenance/hash.ts";

const PROPOSALS = join(import.meta.dir, "fixtures/company-research.proposals.json");
const ITEMS = join(import.meta.dir, "fixtures/jev-claim-smoke-v12.items.json");
const PIN = join(import.meta.dir, "../src/projectConfig/companySeedPin.ts");
const ENV = {
  GROK_ROUTINE_WEBHOOK_URL: "https://grok.invalid/routine",
  GROK_ROUTINE_KEY: "k-test",
  GROK_CALLBACK_MASTER_KEY: "master-test",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://club.invalid",
};

async function quarry(): Promise<Record<string, unknown>> {
  const [entry] = JSON.parse(await readFile(PROPOSALS, "utf8")) as Record<string, unknown>[];
  if (!entry) throw new Error("expected the Quarry fixture");
  return entry;
}

async function workspace(): Promise<{ dir: string; config: string; pin: string }> {
  const dir = await mkdtemp(join(tmpdir(), "grok-research-"));
  const config = join(dir, "config.yml");
  const pin = join(dir, "companySeedPin.ts");
  await copyFile(projectConfigPath(), config);
  await copyFile(PIN, pin);
  return { dir, config, pin };
}

type Call = {
  url: string;
  auth: string | null;
  body: {
    runId: string;
    worklist: { org: string }[];
    callbackUrl: string;
    callbackToken: string;
    delivery: string;
  };
};

/**
 * The routine and the Convex callback in one fetcher. A trigger stores
 * `reply(call)` as if the routine had POSTed it with the token it was given,
 * `postAfterMs` later; a read returns it only for the matching read token.
 * `reply` returning undefined means the routine never posts. Sleeping
 * advances the clock.
 */
function fakeGrok(
  reply: (call: Call) => unknown,
  postAfterMs = 0,
): {
  deps: ResearchDeps;
  calls: Call[];
  reads: number[];
} {
  const calls: Call[] = [];
  const reads: number[] = [];
  const posted = new Map<string, { body: string; at: number }>();
  let clock = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (url === ENV.GROK_ROUTINE_WEBHOOK_URL) {
      const call: Call = {
        url,
        auth: headers.get("Authorization"),
        body: JSON.parse(String(init?.body)) as Call["body"],
      };
      calls.push(call);
      const { runId, callbackToken } = call.body;
      const answer = reply(call);
      if (answer === undefined) return Response.json({ success: true, runUuid: `uuid-${runId}` });
      if (
        !(await checkGrokCallbackToken(ENV.GROK_CALLBACK_MASTER_KEY, runId, "post", callbackToken))
      ) {
        throw new Error("the trigger carried a token the callback rejects");
      }
      posted.set(call.body.callbackUrl, { body: JSON.stringify(answer), at: clock + postAfterMs });
      return Response.json({ success: true, runUuid: `uuid-${runId}` });
    }
    reads.push(clock);
    const runId = new URL(url).searchParams.get("runId") ?? "";
    const token = headers.get(GROK_CALLBACK_TOKEN_HEADER);
    if (!(await checkGrokCallbackToken(ENV.GROK_CALLBACK_MASTER_KEY, runId, "read", token))) {
      return new Response("bad callback token", { status: 401 });
    }
    const entry = posted.get(url);
    return entry === undefined || entry.at > clock
      ? new Response(null, { status: 404 })
      : new Response(entry.body);
  }) as unknown as typeof fetch;
  let runs = 0;
  const deps: ResearchDeps = {
    fetcher,
    env: ENV,
    runId: () => `run-${++runs}`,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, reads };
}

describe("Grok company research", () => {
  for (const name of Object.keys(ENV)) {
    test(`a missing ${name} fails by name before any network call`, async () => {
      const { deps, calls } = fakeGrok(() => ({}));
      const ws = await workspace();
      await expect(
        main(["--research", ITEMS, "--out", join(ws.dir, "p.json")], ws, undefined, {
          ...deps,
          env: { ...ENV, [name]: "" },
        }),
      ).rejects.toThrow(`set ${name} (Doppler talent-graph/dev)`);
      expect(calls).toHaveLength(0);
    });
  }

  test("a valid reply becomes a proposals file that --apply merges and check:config accepts", async () => {
    const company = await quarry();
    const { deps, calls } = fakeGrok((call) => ({
      runId: call.body.runId,
      companies: [company],
      investors: [{ name: "Ferry Capital" }],
      unresolved: [{ org: "Nowhere Labs", reason: "no identifiable company" }],
    }));
    const ws = await workspace();
    const out = join(ws.dir, "p.json");
    const report = await main(["--research", ITEMS, "--out", out], ws, undefined, deps);
    expect(calls[0]?.url).toBe(ENV.GROK_ROUTINE_WEBHOOK_URL);
    expect(calls[0]?.auth).toBe("Bearer k-test");
    expect(calls[0]?.body.worklist.length).toBeGreaterThan(0);
    expect(report).toContain("Nowhere Labs: no identifiable company");
    expect(report).toContain("Ferry Capital");
    expect(report).not.toContain("k-test");
    expect(calls[0]?.body.callbackUrl).toBe(
      `${ENV.NEXT_PUBLIC_CONVEX_SITE_URL}/grok/company-research?runId=run-1`,
    );
    expect(report).not.toContain(calls[0]?.body.callbackToken);
    expect(String(calls[0]?.body.delivery)).toContain("POST to callbackUrl");
    await main(["--apply", out], ws);
    const seed = parseProjectConfig(await readFile(ws.config, "utf8")).company_seed;
    expect(seed.companies.map((company) => company.name)).toContain("Quarry");
    expect(await readFile(ws.pin, "utf8")).toContain(hashInputs(seed));
  });

  test("an unsourced fact is rejected by org and kept out of the file", async () => {
    const good = await quarry();
    const bad = { ...(await quarry()), name: "Shoal", aliases: [], source: "http://shoal.invalid" };
    const parsed = parseGrokResearchResponse(
      { runId: "r", companies: [good, bad], investors: [], unresolved: [] },
      "r",
    );
    expect(parsed.companies.map((company) => company.name)).toEqual(["Quarry"]);
    expect(parsed.rejected.map((entry) => entry.org)).toEqual(["Shoal"]);
  });

  test("an empty labels list is rejected", async () => {
    const company = await quarry();
    const rate = {
      rate: 0.02,
      upperBound: false,
      labels: [],
      source: "https://quarry.invalid/rate",
    };
    const parsed = parseGrokResearchResponse(
      {
        runId: "r",
        companies: [{ ...company, publishedRate: rate }],
        investors: [],
        unresolved: [],
      },
      "r",
    );
    expect(parsed.companies).toHaveLength(0);
    expect(parsed.rejected[0]?.org).toBe("Quarry");
  });

  test("a reply for another run fails", () => {
    expect(() =>
      parseGrokResearchResponse(
        { runId: "other", companies: [], investors: [], unresolved: [] },
        "mine",
      ),
    ).toThrow("runId");
  });

  test("a long worklist is sent in batches of ten and merged", async () => {
    const statements = Array.from({ length: 23 }, (_, i) => ({
      id: `job-${i}`,
      resume: "A",
      org: `Org ${i}`,
      role: "Engineer",
      dates: "Jan 2023 - Dec 2023",
      statement: `Engineer at Org ${i} (Jan 2023 - Dec 2023)\n- Built a thing`,
      pair: null,
      publishedAt: "2024-01-01T00:00:00.000Z",
    }));
    const ws = await workspace();
    const items = join(ws.dir, "items.json");
    await writeFile(items, JSON.stringify(statements));
    const { deps, calls } = fakeGrok((call) => ({
      runId: call.body.runId,
      companies: [],
      investors: [],
      unresolved: call.body.worklist.map((work) => ({ org: work.org, reason: "none" })),
    }));
    const report = await main(
      ["--research", items, "--out", join(ws.dir, "p.json")],
      ws,
      undefined,
      deps,
    );
    expect(calls.map((call) => call.body.worklist.length)).toEqual([10, 10, 3]);
    expect(new Set(calls.map((call) => call.body.runId)).size).toBe(3);
    expect(report).toContain("Org 22: none");
  });

  test("--from validates a pasted reply offline", async () => {
    const ws = await workspace();
    const pasted = join(ws.dir, "grok.json");
    const out = join(ws.dir, "p.json");
    await writeFile(
      pasted,
      JSON.stringify({ runId: "any", companies: [await quarry()], investors: [], unresolved: [] }),
    );
    const { deps, calls } = fakeGrok(() => ({}));
    await main(["--from", pasted, "--out", out], ws, undefined, deps);
    expect(calls).toHaveLength(0);
    const written = JSON.parse(await readFile(out, "utf8")) as { name: string }[];
    expect(written.map((company) => company.name)).toEqual(["Quarry"]);
  });
  test("a failed batch keeps the batches before it and says where it stopped", async () => {
    const statements = Array.from({ length: 12 }, (_, i) => ({
      id: `job-${i}`,
      resume: "A",
      org: `Org ${i}`,
      role: "Engineer",
      dates: "Jan 2023 - Dec 2023",
      statement: `Engineer at Org ${i} (Jan 2023 - Dec 2023)\n- Built a thing`,
      pair: null,
      publishedAt: "2024-01-01T00:00:00.000Z",
    }));
    const ws = await workspace();
    const items = join(ws.dir, "items.json");
    const out = join(ws.dir, "p.json");
    await writeFile(items, JSON.stringify(statements));
    const company = { ...(await quarry()), aliases: ["Org 0"] };
    const fake = fakeGrok((call) => ({
      runId: call.body.runId,
      companies: [company],
      investors: [],
      unresolved: [],
    }));
    const deps: ResearchDeps = {
      ...fake.deps,
      fetcher: (async (url: string, init?: RequestInit) =>
        fake.calls.length > 0 && url === ENV.GROK_ROUTINE_WEBHOOK_URL
          ? new Response("denied", { status: 401 })
          : fake.deps.fetcher(url, init)) as unknown as typeof fetch,
    };
    await expect(main(["--research", items, "--out", out], ws, undefined, deps)).rejects.toThrow(
      "stopped at batch 2: Grok routine rejected: 401",
    );
    const written = JSON.parse(await readFile(out, "utf8")) as { name: string }[];
    expect(written.map((entry) => entry.name)).toEqual(["Quarry"]);
  });

  test("the reply is read once the routine posts it, minutes after the trigger", async () => {
    const company = await quarry();
    const { deps, reads } = fakeGrok(
      (call) => ({ runId: call.body.runId, companies: [company], investors: [], unresolved: [] }),
      5 * 60_000,
    );
    const ws = await workspace();
    const out = join(ws.dir, "p.json");
    await main(["--research", ITEMS, "--out", out], ws, undefined, deps);
    expect(reads.at(-1)).toBeGreaterThanOrEqual(5 * 60_000);
    const written = JSON.parse(await readFile(out, "utf8")) as { name: string }[];
    expect(written.map((entry) => entry.name)).toEqual(["Quarry"]);
  });

  test("a routine that never posts times out and keeps nothing", async () => {
    const { deps, reads } = fakeGrok(() => undefined);
    const ws = await workspace();
    const out = join(ws.dir, "p.json");
    await expect(main(["--research", ITEMS, "--out", out], ws, undefined, deps)).rejects.toThrow(
      "stopped at batch 1: no reply for run run-1 (Grok run uuid-run-1) after 30 min (nothing posted)",
    );
    expect(reads.at(-1)).toBeLessThanOrEqual(30 * 60_000);
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual([]);
  });

  test("a trigger the routine does not accept fails at once instead of polling", async () => {
    const fake = fakeGrok(() => undefined);
    const deps: ResearchDeps = {
      ...fake.deps,
      fetcher: (async () => Response.json({ success: false })) as unknown as typeof fetch,
    };
    const ws = await workspace();
    await expect(
      main(["--research", ITEMS, "--out", join(ws.dir, "p.json")], ws, undefined, deps),
    ).rejects.toThrow("stopped at batch 1: Grok routine did not start a run");
    expect(fake.reads).toHaveLength(0);
  });

  test("failed reads and an unparseable body are retried until the real reply", async () => {
    const company = await quarry();
    const fake = fakeGrok((call) => ({
      runId: call.body.runId,
      companies: [company],
      investors: [],
      unresolved: [],
    }));
    const glitches: (() => Promise<Response>)[] = [
      async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
      async () => new Response("upstream", { status: 502 }),
      async () => new Response("slow down", { status: 429 }),
      async () =>
        ({
          status: 200,
          ok: true,
          text: () => Promise.reject(new Error("socket hang up")),
        }) as unknown as Response,
      async () => new Response("{ half a reply"),
    ];
    const deps: ResearchDeps = {
      ...fake.deps,
      fetcher: (async (url: string, init?: RequestInit) => {
        const glitch = url === ENV.GROK_ROUTINE_WEBHOOK_URL ? undefined : glitches.shift();
        return glitch ? glitch() : fake.deps.fetcher(url, init);
      }) as unknown as typeof fetch,
    };
    const ws = await workspace();
    const out = join(ws.dir, "p.json");
    await main(["--research", ITEMS, "--out", out], ws, undefined, deps);
    const written = JSON.parse(await readFile(out, "utf8")) as { name: string }[];
    expect(written.map((entry) => entry.name)).toEqual(["Quarry"]);
  });

  test("a rejected read token stops the batch instead of polling for 30 minutes", async () => {
    const fake = fakeGrok(() => undefined);
    const deps: ResearchDeps = {
      ...fake.deps,
      env: { ...ENV, GROK_CALLBACK_MASTER_KEY: "wrong" },
    };
    const ws = await workspace();
    await expect(
      main(["--research", ITEMS, "--out", join(ws.dir, "p.json")], ws, undefined, deps),
    ).rejects.toThrow("stopped at batch 1: callback read rejected: 401");
    expect(fake.reads).toHaveLength(1);
  });

  test("a worklist org no returned company names is reported as unmatched", async () => {
    const { deps } = fakeGrok((call) => ({
      runId: call.body.runId,
      companies: [],
      investors: [],
      unresolved: [],
    }));
    const ws = await workspace();
    const report = await main(
      ["--research", ITEMS, "--out", join(ws.dir, "p.json")],
      ws,
      undefined,
      deps,
    );
    expect(report).toMatch(/unmatched Harborline: no returned company has this name or alias/);
  });
});
