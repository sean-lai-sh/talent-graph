/**
 * The rubric, the evidence and the SDK doubles the judgment-record suites share.
 *
 * The doubles are typed against the real SDK through `JevClient`, the narrow
 * port the adapter calls, and every body they answer with is checked against
 * `SystemOneResult<...>` for the question set it answers. No `as unknown as`:
 * a cast through `unknown` type-checks against anything, so a double behind one
 * keeps compiling while the SDK's shape moves under it (#54 T8).
 *
 * Every spec here is explicit — the registered constant, or a spread of it with
 * one field changed. Nothing reads `process.env`.
 */

import type { Questions, SystemOneRequest, SystemOneResult, WithResponse } from "@typesafe-ai/sdk";
import type {
  createJevJudgmentService,
  JevClaimQuestions,
  JevClient,
  JevIdentityQuestions,
} from "../../apps/club/lib/longitudinal/jev.ts";
import type { CAREER_EVIDENCE_DIMENSIONS } from "../../src/longitudinal/dimensions.ts";
import { processEvidence } from "../../src/longitudinal/pipeline.ts";
import { contentFingerprint } from "../../src/longitudinal/provenance.ts";
import type { InMemoryJevJudgmentStore } from "../../src/longitudinal/store.ts";
import type { CanonicalIdentity, GrokEvidenceItem } from "../../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0 } from "../../src/models/careerEvidence.ts";
import type { CareerEvidenceSpec } from "../../src/models/spec.ts";

export const spec = CAREER_EVIDENCE_V1_0_0;
export const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

/**
 * The same rubric with different gate thresholds, as a *test* fixture: a spec
 * version that is not registered and never ships, so the re-derivation below
 * cannot be confused with a released rubric change.
 */
export const STRICTER: CareerEvidenceSpec = {
  ...spec,
  version: "1.0.1+test",
  thresholds: { ...spec.thresholds, dimensionConfidence: 0.9 },
};

export const identity: CanonicalIdentity = {
  personId: "p-1",
  name: "Avery Chen",
  aliases: [],
  externalIdentities: [
    { source: "github", externalId: "avery", url: "https://github.com/avery", verifiedAt: day(0) },
  ],
  createdAt: day(0),
  updatedAt: day(0),
};

export function evidence(id: string, observedDay: number): GrokEvidenceItem {
  return {
    source: "github",
    sourceId: id,
    url: `https://github.com/avery/${id}`,
    publisher: "avery",
    publishedAt: day(observedDay).toISOString(),
    quotedText: `Released ${id} with implementation details.`,
    contentHash: contentFingerprint(id),
    statement: `Avery released ${id}.`,
    proposedEventKind: "open_source_contribution",
  };
}

export const items = [evidence("work", 40), evidence("more", 50)];

/** A score answer as the SDK sends one: keyed by level, plus the legend. */
export function scoreAnswer(
  score: number,
  confidence: number,
  probabilities: Record<string, number>,
  dimension: (typeof CAREER_EVIDENCE_DIMENSIONS)[number],
) {
  return {
    type: "score" as const,
    score,
    confidence,
    probabilities,
    legend: Object.fromEntries(spec.levels[dimension].map((text, index) => [index, text])),
  };
}

export interface FakeClientOptions {
  /** What the API reports having answered with; the adapter must keep it. */
  model?: string;
  requestId?: string | undefined;
  /** Per-dimension score, so a fractional score can be asserted un-rounded. */
  score?: number;
  /** Probability keys in a deliberately scrambled order. */
  scrambleProbabilityKeys?: boolean;
}

/** A TypeSafe client whose `systemOne(...).withResponse()` counts its calls. */
export function fakeClient(options: FakeClientOptions = {}): {
  client: JevClient;
  calls: () => number;
} {
  let calls = 0;
  const score = options.score ?? 3;
  const straight: Record<string, number> = { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 };
  const scrambled: Record<string, number> = { 3: 0.8, 0: 0, 4: 0, 2: 0.2, 1: 0 };
  const probabilities = options.scrambleProbabilityKeys ? scrambled : straight;
  const identityData = {
    model: options.model ?? "jev-2026-01",
    usage: { input_tokens: 120, output_tokens: 34 },
    answers: {
      decision: {
        type: "choice",
        choice: "same",
        confidence: 0.98,
        probabilities: { same: 0.98, review: 0.015, different: 0.005 },
      },
      same_name: { type: "noul", noul: 0.99 },
      same_affiliation: { type: "noul", noul: 0.8 },
      same_handle: { type: "noul", noul: 1 },
    },
  } satisfies SystemOneResult<JevIdentityQuestions>;
  const claimData = {
    model: options.model ?? "jev-2026-01",
    usage: { input_tokens: 120, output_tokens: 34 },
    answers: {
      event_kind: {
        type: "choice",
        choice: "open_source_contribution",
        confidence: 0.92,
        probabilities: {
          open_source_contribution: 0.92,
          no_supported_event: 0.08,
          selective_role_transition: 0,
          shipped_product: 0,
          research_output: 0,
          venture_traction: 0,
          grant_or_award: 0,
          community_or_craft_contribution: 0,
        },
      },
      difficulty: scoreAnswer(score, 0.8, probabilities, "difficulty"),
      ownership: scoreAnswer(score, 0.8, probabilities, "ownership"),
      external_impact: scoreAnswer(score, 0.8, probabilities, "external_impact"),
      originality: scoreAnswer(score, 0.8, probabilities, "originality"),
      peer_validation: scoreAnswer(score, 0.8, probabilities, "peer_validation"),
    },
  } satisfies SystemOneResult<JevClaimQuestions>;

  function systemOne(request: SystemOneRequest<JevIdentityQuestions>): {
    withResponse(): Promise<WithResponse<SystemOneResult<JevIdentityQuestions>>>;
  };
  function systemOne(request: SystemOneRequest<JevClaimQuestions>): {
    withResponse(): Promise<WithResponse<SystemOneResult<JevClaimQuestions>>>;
  };
  function systemOne(request: SystemOneRequest<Questions>): {
    withResponse(): Promise<WithResponse<SystemOneResult<Questions>>>;
  } {
    const data = "decision" in request.questions ? identityData : claimData;
    return {
      async withResponse() {
        calls += 1;
        return { data, response: new Response(null), requestId: options.requestId };
      },
    };
  }
  return { client: { systemOne }, calls: () => calls };
}

/** The fake client above, wrapped so the per-call options are observable. */
export function capturingClient(): {
  client: JevClient;
  signals: () => (AbortSignal | undefined)[];
} {
  const inner = fakeClient();
  const seen: (AbortSignal | undefined)[] = [];
  function systemOne(
    request: SystemOneRequest<JevIdentityQuestions>,
    options?: { signal?: AbortSignal },
  ): { withResponse(): Promise<WithResponse<SystemOneResult<JevIdentityQuestions>>> };
  function systemOne(
    request: SystemOneRequest<JevClaimQuestions>,
    options?: { signal?: AbortSignal },
  ): { withResponse(): Promise<WithResponse<SystemOneResult<JevClaimQuestions>>> };
  function systemOne(
    request: SystemOneRequest<Questions>,
    options?: { signal?: AbortSignal },
  ): { withResponse(): Promise<WithResponse<SystemOneResult<Questions>>> } {
    seen.push(options?.signal);
    return inner.client.systemOne(request as SystemOneRequest<JevIdentityQuestions>);
  }
  return { client: { systemOne }, signals: () => [...seen] };
}

export const run = (
  judgments: ReturnType<typeof createJevJudgmentService>,
  store?: InMemoryJevJudgmentStore,
  used: CareerEvidenceSpec = spec,
) =>
  processEvidence({
    identity,
    evidence: items,
    cutoffAt: day(90),
    retrievedAt: day(100),
    pipelineVersion: "1",
    judgments,
    spec: used,
    ...(store === undefined ? {} : { runtime: { store } }),
  });

/** Dates are the only non-JSON value; ISO keeps the comparison textual. */
export const isoDates = (_key: string, value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : value;

/**
 * The typed client above, wrapped so every request it is handed is captured.
 *
 * The bodies it answers with are `fakeClient`'s, so they are still checked
 * against the SDK's result type; what this adds is the request, byte for byte,
 * which is what the spec's question tests read.
 */
export function recordingClient(requests: unknown[]): JevClient {
  const inner = fakeClient();
  function systemOne(request: SystemOneRequest<JevIdentityQuestions>): {
    withResponse(): Promise<WithResponse<SystemOneResult<JevIdentityQuestions>>>;
  };
  function systemOne(request: SystemOneRequest<JevClaimQuestions>): {
    withResponse(): Promise<WithResponse<SystemOneResult<JevClaimQuestions>>>;
  };
  function systemOne(request: SystemOneRequest<Questions>): {
    withResponse(): Promise<WithResponse<SystemOneResult<Questions>>>;
  } {
    requests.push(request);
    return inner.client.systemOne(request as SystemOneRequest<JevIdentityQuestions>);
  }
  return { systemOne };
}
