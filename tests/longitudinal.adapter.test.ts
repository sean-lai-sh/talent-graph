/**
 * The Club-side TypeSafe/Jev adapter, typed against the real SDK.
 *
 * The double below is a plain object that satisfies `JevClient` — the narrow
 * port the adapter actually calls — and every payload it answers with is
 * checked against `SystemOneResult<...>` for the question set it is answering.
 * There is no `as unknown as` anywhere in this file: a cast through `unknown`
 * type-checks against anything, so the old double would have kept compiling
 * against an SDK whose response shape had moved. This one stops compiling, and
 * `bun run typecheck` / `bun run club:typecheck` go red (#54 T8).
 *
 * `TypeSafeClient` itself is a class with private members, so no object
 * literal can be one. That is why the adapter's dependency is the port rather
 * than the class; `realClientIsAPort` below pins that the real client still
 * satisfies it, so narrowing the dependency cannot drift into accepting
 * something the SDK would not.
 */

import { describe, expect, test } from "bun:test";
import type {
  Questions,
  SystemOneRequest,
  SystemOneResult,
  TypeSafeClient,
  WithResponse,
} from "@typesafe-ai/sdk";
import type {
  JevClaimQuestions,
  JevClient,
  JevIdentityQuestions,
} from "../apps/club/lib/longitudinal/jev.ts";
import {
  createJevClient,
  createJevJudgmentService,
  JEV_CLIENT_DEFAULTS,
} from "../apps/club/lib/longitudinal/jev.ts";
import { CAREER_EVIDENCE_V1_0_0 } from "../src/index.ts";
import { CAREER_EVIDENCE_DIMENSIONS } from "../src/longitudinal/dimensions.ts";
import type { CareerEvidenceDimension } from "../src/longitudinal/types.ts";
import { evidence, identity } from "./helpers/longitudinal.ts";

/**
 * The real client is still a `JevClient`: narrowing the adapter's dependency
 * cannot drift into accepting something `TypeSafeClient` is not. Type-level
 * only — nothing is constructed, so no API key is needed to pin it.
 */
type Assignable<TTarget, _TSource extends TTarget> = true;
export type RealClientIsAPort = Assignable<JevClient, TypeSafeClient>;

/** The rubric text the model reports having used, keyed by level. */
const legendFor = (dimension: CareerEvidenceDimension): Record<number, string> =>
  Object.fromEntries(CAREER_EVIDENCE_V1_0_0.levels[dimension].map((text, index) => [index, text]));

/** One dimension's answer: the same numbers the pre-split fake answered with. */
const scoreAnswer = (dimension: CareerEvidenceDimension, score: 2 | 3) =>
  score === 3
    ? {
        type: "score" as const,
        score: 3,
        probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 },
        confidence: 0.8,
        legend: legendFor(dimension),
      }
    : {
        type: "score" as const,
        score: 2,
        probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
        confidence: 1,
        legend: legendFor(dimension),
      };

const identityData = {
  model: "jev-test",
  usage: { input_tokens: 11, output_tokens: 3 },
  answers: {
    decision: {
      type: "choice",
      choice: "same",
      confidence: 0.91,
      // Every label the question offered: the SDK types the map by criteria.
      probabilities: { same: 0.91, review: 0.06, different: 0.03 },
    },
    same_name: { type: "noul", noul: 0.95 },
    same_affiliation: { type: "noul", noul: 0.8 },
    same_handle: { type: "noul", noul: 1 },
  },
} satisfies SystemOneResult<JevIdentityQuestions>;

const claimData = {
  model: "jev-test",
  usage: { input_tokens: 42, output_tokens: 7 },
  answers: {
    event_kind: {
      type: "choice",
      choice: "shipped_product",
      confidence: 0.88,
      probabilities: {
        shipped_product: 0.88,
        selective_role_transition: 0.02,
        open_source_contribution: 0.02,
        research_output: 0.02,
        venture_traction: 0.02,
        grant_or_award: 0.02,
        community_or_craft_contribution: 0.01,
        no_supported_event: 0.01,
      },
    },
    difficulty: scoreAnswer("difficulty", 3),
    ownership: scoreAnswer("ownership", 3),
    external_impact: scoreAnswer("external_impact", 2),
    originality: scoreAnswer("originality", 3),
    peer_validation: scoreAnswer("peer_validation", 2),
  },
} satisfies SystemOneResult<JevClaimQuestions>;

describe("the TypeSafe/Jev adapter", () => {
  test("maps Jev typed answers into identity and career-evidence judgments", async () => {
    let requestCount = 0;
    // Overloads, then an implementation signature: the two overloads are what
    // `JevClient` requires and what a shape change breaks; the implementation
    // is the runtime dispatch, and needs no cast because the payloads above
    // are already checked against the SDK's result type.
    function systemOne(request: SystemOneRequest<JevIdentityQuestions>): {
      withResponse(): Promise<WithResponse<SystemOneResult<JevIdentityQuestions>>>;
    };
    function systemOne(request: SystemOneRequest<JevClaimQuestions>): {
      withResponse(): Promise<WithResponse<SystemOneResult<JevClaimQuestions>>>;
    };
    function systemOne(request: SystemOneRequest<Questions>): {
      withResponse(): Promise<WithResponse<SystemOneResult<Questions>>>;
    } {
      requestCount++;
      const data = "decision" in request.questions ? identityData : claimData;
      return {
        async withResponse() {
          return { data, response: new Response(null), requestId: "req-1" };
        },
      };
    }
    const client: JevClient = { systemOne };

    const service = createJevJudgmentService(client);
    const judged = await service.assessIdentity(identity, evidence("x", 30));
    expect(judged.assessment.decision).toBe("same");
    // The record is the observation the assessment was projected from.
    expect(judged.record.kind).toBe("identity");
    expect(judged.record.respondedModel).toBe("jev-test");
    expect(judged.record.requestId).toBe("req-1");
    expect(judged.record.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    const claim = await service.assessClaim(evidence("x", 30), identity.personId);
    expect(claim.assessment.eventKind).toBe("shipped_product");
    expect(claim.assessment.dimensions).toHaveLength(5);
    expect(claim.record.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(requestCount).toBe(2);
  });

  test("the claim question set covers every dimension the rubric names", () => {
    expect(Object.keys(claimData.answers).sort()).toEqual(
      ["event_kind", ...CAREER_EVIDENCE_DIMENSIONS].sort(),
    );
  });
});

describe("transport policy at the client", () => {
  test("createJevClient applies the timeout and retry defaults it documents", () => {
    // The key is explicit, never read from the environment by this test.
    const client = createJevClient({ apiKey: "test-key" });
    expect(client.timeout).toBe(JEV_CLIENT_DEFAULTS.timeout);
    expect(client.retry.maxRetries).toBe(JEV_CLIENT_DEFAULTS.retry.maxRetries);
    expect(client.retry.respectRetryAfter).toBe(true);
    expect(client.retry.httpStatuses.has(429)).toBe(true);
    expect(client.retry.httpStatuses.has(503)).toBe(true);
  });

  test("an explicit transport policy overrides the defaults", () => {
    const client = createJevClient({
      apiKey: "test-key",
      timeout: 1234,
      retry: { maxRetries: 0 },
    });
    expect(client.timeout).toBe(1234);
    expect(client.retry.maxRetries).toBe(0);
  });
});
