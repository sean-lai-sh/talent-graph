/**
 * Evidence collection: what reaches the pipeline, and under what proof.
 *
 * The Grok callback's signature, run binding and dedupe, the GitHub and ORCID
 * adapters' windowing, and the bounds of the routine request. Nothing here
 * judges anything — the judgment suites start where this one stops.
 */

import { describe, expect, test } from "bun:test";
import {
  buildGrokRoutineRequest,
  signGrokCallbackBody,
} from "../apps/club/lib/longitudinal/grok.ts";
import {
  createInMemoryGrokIngestStore,
  fetchGitHubEvidence,
  fetchOrcidEvidence,
  ingestGrokEvidenceCallback,
} from "../apps/club/lib/longitudinal/sources.ts";
import type { GrokEvidencePacket } from "../src/index.ts";
import { validateGrokEvidencePacket } from "../src/index.ts";
import { day, evidence, identity } from "./helpers/longitudinal.ts";

describe("longitudinal source ingestion", () => {
  test("Grok callbacks require a signature, stored run binding, and durable dedupe", async () => {
    const packet: GrokEvidencePacket = {
      schemaVersion: "1",
      personId: "p-1",
      runId: "run-1",
      retrievedAt: day(100).toISOString(),
      cutoffAt: day(90).toISOString(),
      items: [evidence("late", 91)],
    };
    expect(validateGrokEvidencePacket(packet)).toEqual({
      ok: false,
      errors: ["items[0].publishedAt exceeds cutoffAt"],
    });

    const valid: GrokEvidencePacket = {
      ...packet,
      items: [evidence("valid", 80), evidence("valid", 80)],
    };
    const rawBody = JSON.stringify(valid);
    const signingSecret = "per-run-test-secret";
    const expected = {
      personId: "p-1",
      runId: "default-store",
      cutoffAt: day(90),
      signingSecret,
    };
    const boundPacket = JSON.stringify({ ...valid, runId: expected.runId });
    const signature = signGrokCallbackBody(boundPacket, signingSecret);
    const store = createInMemoryGrokIngestStore();
    expect(await ingestGrokEvidenceCallback(boundPacket, signature, expected, store)).toHaveLength(
      1,
    );
    expect(await ingestGrokEvidenceCallback(boundPacket, signature, expected, store)).toHaveLength(
      0,
    );
    await expect(
      ingestGrokEvidenceCallback(boundPacket, "sha256=bad", expected, store),
    ).rejects.toThrow("invalid Grok callback signature");
    await expect(
      ingestGrokEvidenceCallback(
        rawBody,
        signGrokCallbackBody(rawBody, signingSecret),
        expected,
        createInMemoryGrokIngestStore(),
      ),
    ).rejects.toThrow("Grok callback run mismatch");
  });

  test("GitHub adapter retains only evidence inside the requested window", async () => {
    const calls: string[] = [];
    const fetched = await fetchGitHubEvidence("avery", day(0), day(90), async (url) => {
      calls.push(url);
      if (url.includes("/repos?")) {
        return [
          {
            full_name: "avery/new-work",
            html_url: "https://github.com/avery/new-work",
            created_at: day(50).toISOString(),
            description: "A difficult compiler.",
            fork: false,
          },
          {
            full_name: "avery/too-new",
            html_url: "https://github.com/avery/too-new",
            created_at: day(95).toISOString(),
            description: "After cutoff.",
            fork: false,
          },
          {
            full_name: "avery/old-fork",
            html_url: "https://github.com/avery/old-fork",
            created_at: day(50).toISOString(),
            updated_at: day(60).toISOString(),
            description: "Not authored work.",
            fork: true,
          },
        ];
      }
      return [
        {
          id: "event-1",
          type: "ReleaseEvent",
          created_at: day(60).toISOString(),
          repo: { name: "avery/new-work" },
        },
        {
          id: "event-2",
          type: "WatchEvent",
          created_at: day(61).toISOString(),
          repo: { name: "avery/someone-elses-work" },
        },
      ];
    });
    expect(calls).toHaveLength(2);
    expect(fetched.map((item) => item.sourceId)).toEqual(["repo:avery/new-work", "event:event-1"]);
  });

  test("ORCID adapter rejects incomplete publication dates", async () => {
    const fetched = await fetchOrcidEvidence(
      "0000-0000-0000-0001",
      day(0),
      day(180),
      "token",
      async () => ({
        group: [
          {
            "work-summary": [
              {
                "put-code": 1,
                title: { title: { value: "Year only" } },
                "publication-date": { year: { value: "2026" } },
              },
              {
                "put-code": 2,
                title: { title: { value: "Fully dated work" } },
                "publication-date": {
                  year: { value: "2026" },
                  month: { value: "03" },
                  day: { value: "01" },
                },
                url: { value: "https://example.com/work" },
              },
            ],
          },
        ],
      }),
    );
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.sourceId).toBe("work:2");
    expect(fetched[0]?.url).toBe("https://example.com/work");
  });

  test("Grok routine request is bounded to person, identities, and cutoff", () => {
    const request = buildGrokRoutineRequest({
      runId: "run-1",
      identity,
      from: day(0),
      cutoffAt: day(90),
      callbackUrl: "https://example.com/api/evidence",
      callbackSigningSecret: "per-run-secret",
    });
    expect(request.runId).toBe("run-1");
    expect(request.person.knownIdentities[0]?.externalId).toBe("avery");
    expect(request.cutoffAt).toBe(day(90).toISOString());
    expect(request.instructions).toContain("Exclude evidence after cutoffAt");
  });
});
