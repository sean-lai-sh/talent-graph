/**
 * The career-evidence rubric as a registered spec.
 *
 * The wording *is* the spec: a reworded level description changes what an
 * answer means, so `CAREER_EVIDENCE_V1_0_0` carries the text that shipped and
 * these tests pin it three ways — the rubric hash, the id derived from it, and
 * the requests the Club adapter actually sends, captured from the adapter
 * before it took the spec as an argument.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import { DEFAULT_EVIDENCE_POLICY } from "../src/longitudinal/pipeline.ts";
import type { CanonicalIdentity, GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { CAREER_EVENT_KINDS } from "../src/longitudinal/types.ts";
import {
  CAREER_EVIDENCE_V1_0_0,
  careerEvidenceRubricHash,
  careerEvidenceSpecId,
} from "../src/models/careerEvidence.ts";
import { isRegisteredSpec } from "../src/models/registry.ts";
import type { CareerEvidenceSpec } from "../src/models/spec.ts";
import { validateSpec } from "../src/models/spec.ts";

const ROOT = join(import.meta.dir, "..");

/**
 * The hash of the wording that shipped. If this line has to change, every
 * career event already stamped `career-evidence@1.0.0` has become
 * unreproducible — ship a new spec version instead of editing this one.
 */
const PINNED_RUBRIC_HASH = "6290bc28b1a9b5a61ecab7dc389203daf1d4527a5b1b5c7d20866a34e26bac97";

const spec = CAREER_EVIDENCE_V1_0_0;

/** A structurally-typed clone of the frozen spec, safe to mutate in a test. */
function mutableSpec(): CareerEvidenceSpec {
  return structuredClone(spec) as CareerEvidenceSpec;
}

/** The clone's `levels`, seen as the mutable map a broken spec would carry. */
function levelsOf(candidate: CareerEvidenceSpec): Record<string, string[]> {
  return candidate.levels as unknown as Record<string, string[]>;
}

function errorsOf(candidate: CareerEvidenceSpec): string[] {
  const result = validateSpec(candidate);
  return result.ok ? [] : result.errors;
}

describe("CareerEvidenceSpec: registration", () => {
  test("the registered spec validates and is registered by id and by value", () => {
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(isRegisteredSpec(spec)).toBe(true);
  });

  test("the rubric hash is the wording that shipped", () => {
    expect(careerEvidenceRubricHash(spec)).toBe(PINNED_RUBRIC_HASH);
  });

  test("the spec id carries the version and the first eight hash digits", () => {
    expect(careerEvidenceSpecId(spec)).toBe(
      `career_evidence@1.0.0:${PINNED_RUBRIC_HASH.slice(0, 8)}`,
    );
  });

  test("editing one character of one level description changes the spec id", () => {
    const edited = mutableSpec();
    const rubric = levelsOf(edited).ownership as string[];
    const original = rubric[0] as string;
    rubric[0] = `${original.slice(0, -1)}!`;
    expect(rubric[0]).not.toBe(original);
    expect(rubric[0]).toHaveLength(original.length);
    expect(careerEvidenceSpecId(edited)).not.toBe(careerEvidenceSpecId(spec));
    // The version did not move; only the hash caught it.
    expect(edited.version).toBe(spec.version);
  });

  test("the spec is deeply frozen, so a level cannot be edited in place", () => {
    expect(Object.isFrozen(spec.levels.difficulty)).toBe(true);
    expect(Object.isFrozen(spec.eventCriteria)).toBe(true);
    expect(Object.isFrozen(spec.thresholds)).toBe(true);
  });

  test("the shared 0..MAX_LEVEL scale is the rubric length, for every dimension", () => {
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(spec.levels[dimension]).toHaveLength(MAX_LEVEL + 1);
    }
  });

  test("docs/models/CHANGELOG.md carries the career_evidence@1.0.0 entry", () => {
    const changelog = readFileSync(join(ROOT, "docs/models/CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## career_evidence@1.0.0");
    expect(changelog).toContain("- **Drift:**");
  });
});

/**
 * The longitudinal signal must never reach Referral Signal or capability code.
 * `src/models/registry.ts` side-effect-imports the model definitions, which
 * pull `scoring/`, `inference/` and `judges/` in behind them — so a
 * longitudinal module importing the registry drags the whole model graph into
 * the pipeline and into the Club (Next/Convex) bundle, transitively crossing a
 * boundary nothing crosses directly. The spec constant lives in a leaf module
 * for exactly this reason; these checks are textual, like tests/invariants.test.ts.
 */
describe("CareerEvidenceSpec: the spec module is a leaf", () => {
  const listTs = (dir: string): string[] => {
    const glob = new Bun.Glob("**/*.ts");
    return [...glob.scanSync({ cwd: join(ROOT, dir), absolute: true })].sort();
  };

  /** Strip block and line comments so prose never trips an import rule. */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const importsPath = (source: string, needle: string): boolean =>
    new RegExp(`from\\s+["'][^"']*${needle}[^"']*["']`).test(stripComments(source));

  const LONGITUDINAL = [...listTs("src/longitudinal"), ...listTs("apps/club/lib/longitudinal")];

  test("no longitudinal module imports the model registry or the definitions", () => {
    expect(LONGITUDINAL.length).toBeGreaterThan(0);
    for (const file of LONGITUDINAL) {
      const source = readFileSync(file, "utf8");
      const name = relative(ROOT, file);
      expect(importsPath(source, "models/registry"), `${name} imports models/registry`).toBe(false);
      expect(importsPath(source, "models/definitions"), `${name} imports models/definitions`).toBe(
        false,
      );
    }
  });

  test("the career-evidence spec module pulls in no model, scoring or inference code", () => {
    const source = readFileSync(join(ROOT, "src/models/careerEvidence.ts"), "utf8");
    for (const needle of [
      "scoring/",
      "inference/",
      "judges/",
      "models/registry",
      "./registry.ts",
      "models/definitions",
      "./definitions",
    ]) {
      expect(importsPath(source, needle), `careerEvidence.ts imports ${needle}`).toBe(false);
    }
  });

  test("at least one longitudinal module reads the spec, so the rule has teeth", () => {
    const pipeline = readFileSync(join(ROOT, "src/longitudinal/pipeline.ts"), "utf8");
    const adapter = readFileSync(join(ROOT, "apps/club/lib/longitudinal/jev.ts"), "utf8");
    expect(importsPath(pipeline, "models/careerEvidence")).toBe(true);
    expect(importsPath(adapter, "models/careerEvidence")).toBe(true);
  });
});

describe("CareerEvidenceSpec: validateSpec rejections", () => {
  test("a missing dimension is rejected", () => {
    const broken = mutableSpec();
    delete levelsOf(broken).peer_validation;
    expect(errorsOf(broken)).toContain(
      "levels.peer_validation is missing; every dimension needs a rubric",
    );
  });

  test("a missing dimension question is rejected", () => {
    const broken = mutableSpec();
    delete (broken.questions.dimensions as Record<string, unknown>).originality;
    expect(errorsOf(broken)).toContain(
      "questions.dimensions.originality must be a non-empty string",
    );
  });

  test("a one-level rubric is rejected", () => {
    const broken = mutableSpec();
    levelsOf(broken).difficulty = [spec.levels.difficulty[0]];
    expect(errorsOf(broken)).toContain("levels.difficulty must have at least 2 levels (got 1)");
  });

  test("unequal level counts across dimensions are rejected", () => {
    const broken = mutableSpec();
    levelsOf(broken).ownership = [...spec.levels.ownership].slice(0, 3);
    expect(errorsOf(broken)).toContain(
      "levels.ownership has 3 levels; every dimension must share one scale (5)",
    );
  });

  test("a rubric that is not the shared 0..MAX_LEVEL scale is rejected, even when every dimension agrees", () => {
    // Six levels everywhere: the ">= 2" and "equal across dimensions" rules
    // both pass, so only the exact-length rule can catch it. `progressVector`
    // still divides by the fixed MAX_LEVEL, so a level 5 would normalise to
    // 1.25 — a value outside [0, 1] that no downstream reader expects.
    const broken = mutableSpec();
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      levelsOf(broken)[dimension] = [...spec.levels[dimension], "A sixth level."];
    }
    expect(errorsOf(broken)).toContain(
      `levels.difficulty has 6 levels; the shared scale is 0..${MAX_LEVEL}, so it must have ${MAX_LEVEL + 1}`,
    );
  });

  test("a two-level rubric on every dimension is rejected for the same reason", () => {
    // Structurally fine under the generic rules; normalised scores would never
    // exceed 0.25 because the divisor is still the fixed MAX_LEVEL.
    const broken = mutableSpec();
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      levelsOf(broken)[dimension] = [...spec.levels[dimension]].slice(0, 2);
    }
    const errors = errorsOf(broken);
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(errors).toContain(
        `levels.${dimension} has 2 levels; the shared scale is 0..${MAX_LEVEL}, so it must have ${MAX_LEVEL + 1}`,
      );
    }
  });

  test("an event taxonomy missing no_supported_event is rejected", () => {
    const broken = mutableSpec();
    delete (broken.eventCriteria as Record<string, unknown>).no_supported_event;
    expect(errorsOf(broken)).toContain(
      "eventCriteria.no_supported_event must be a non-empty string",
    );
  });

  test("an event taxonomy missing a career event kind is rejected", () => {
    const broken = mutableSpec();
    delete (broken.eventCriteria as Record<string, unknown>).grant_or_award;
    expect(errorsOf(broken)).toContain("eventCriteria.grant_or_award must be a non-empty string");
  });

  test("a threshold outside [0, 1] is rejected, on either side", () => {
    const above = mutableSpec();
    above.thresholds.eventConfidence = 1.5;
    expect(errorsOf(above)).toContain("thresholds.eventConfidence must be in [0, 1] (got 1.5)");

    const below = mutableSpec();
    below.thresholds.identityContradiction = -0.1;
    expect(errorsOf(below)).toContain(
      "thresholds.identityContradiction must be in [0, 1] (got -0.1)",
    );
  });

  test("a non-finite threshold is rejected rather than read as zero", () => {
    const broken = mutableSpec();
    (broken.thresholds as Record<string, unknown>).dimensionConfidence = undefined;
    expect(errorsOf(broken)).toContain("thresholds.dimensionConfidence must be a finite number");
  });

  test("an unknown key in the levels or the taxonomy is rejected", () => {
    const broken = mutableSpec();
    levelsOf(broken).charisma = ["a", "b", "c", "d", "e"];
    (broken.eventCriteria as Record<string, unknown>).went_viral = "no";
    const errors = errorsOf(broken);
    expect(errors).toContain("unknown dimension in levels: charisma");
    expect(errors).toContain("unknown event kind in eventCriteria: went_viral");
  });

  test("a non-semver version is rejected", () => {
    const broken = mutableSpec();
    broken.version = "one";
    expect(errorsOf(broken).join("; ")).toContain("version must be a semver string");
  });
});

describe("CareerEvidenceSpec: the pipeline policy reads the spec", () => {
  test("DEFAULT_EVIDENCE_POLICY thresholds are the spec's, and the stamp is unchanged", () => {
    expect(DEFAULT_EVIDENCE_POLICY).toEqual({
      identityConfidence: 0.75,
      identityContradiction: 0.25,
      eventConfidence: 0.65,
      dimensionConfidence: 0.5,
      questionVersion: "career-evidence@1.0.0",
      model: "jev",
    });
    expect(spec.thresholds).toEqual({
      identityConfidence: 0.75,
      identityContradiction: 0.25,
      eventConfidence: 0.65,
      dimensionConfidence: 0.5,
    });
  });
});

/**
 * Records every request the adapter sends, and answers plausibly.
 *
 * The adapter reads its answers through `withResponse()` now, so the fake
 * client hands back the request id and the parsed body the same way the SDK
 * does; what is captured here is still the request, byte for byte.
 */
function recordingClient(requests: unknown[]): Parameters<typeof createJevJudgmentService>[0] {
  const legend = Object.fromEntries(
    CAREER_EVIDENCE_V1_0_0.levels.difficulty.map((text, index) => [index, text]),
  );
  const level = {
    score: 3,
    probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 },
    confidence: 0.8,
    legend,
  };
  return {
    systemOne(request: unknown) {
      requests.push(request);
      return {
        async withResponse() {
          return {
            data: {
              model: "jev-test",
              usage: { input_tokens: 10, output_tokens: 5 },
              answers: {
                decision: { choice: "same", confidence: 0.98, probabilities: {} },
                same_name: { noul: 0.99 },
                same_affiliation: { noul: 0.8 },
                same_handle: { noul: 1 },
                event_kind: { choice: "shipped_product", confidence: 0.9, probabilities: {} },
                difficulty: level,
                ownership: level,
                external_impact: level,
                originality: level,
                peer_validation: level,
              },
            },
            response: new Response(null),
            requestId: undefined,
          };
        },
      };
    },
  } as unknown as Parameters<typeof createJevJudgmentService>[0];
}

const identity: CanonicalIdentity = {
  personId: "person-1",
  name: "Avery Chen",
  aliases: ["A. Chen"],
  externalIdentities: [
    {
      source: "github",
      externalId: "averyc",
      url: "https://github.com/averyc",
      verifiedAt: null,
    },
  ],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const evidence: GrokEvidenceItem = {
  source: "github",
  sourceId: "item-1",
  url: "https://github.com/averyc/toolkit/releases/tag/v2.0.0",
  publisher: "averyc",
  publishedAt: "2026-02-01T00:00:00.000Z",
  quotedText: "v2.0.0 ships the streaming planner.",
  contentHash: "hash-item-1",
  statement: "Avery Chen released v2.0.0 of the toolkit.",
  proposedEventKind: "shipped_product",
};

async function capture(): Promise<{ identity: unknown; claim: unknown }> {
  const requests: unknown[] = [];
  const service = createJevJudgmentService(recordingClient(requests));
  await service.assessIdentity(identity, evidence);
  await service.assessClaim(evidence, identity.personId);
  expect(requests).toHaveLength(2);
  return { identity: requests[0], claim: requests[1] };
}

describe("CareerEvidenceSpec: the adapter builds its questions from the spec", () => {
  test("every question the adapter sends matches the spec field-for-field", async () => {
    const sent = (await capture()) as {
      identity: { questions: Record<string, { instructions: string; criteria?: unknown }> };
      claim: { questions: Record<string, { instructions: string; criteria?: unknown }> };
    };
    const iq = sent.identity.questions;
    const cq = sent.claim.questions;

    expect(iq.decision?.instructions).toBe(spec.questions.identityDecision);
    expect(iq.decision?.criteria).toEqual({
      different: spec.questions.identity[0],
      review: spec.questions.identity[1],
      same: spec.questions.identity[2],
    });
    expect(iq.same_name?.instructions).toBe(spec.questions.identityFields.name);
    expect(iq.same_affiliation?.instructions).toBe(spec.questions.identityFields.affiliation);
    expect(iq.same_handle?.instructions).toBe(spec.questions.identityFields.handle);
    // Order is part of what is sent: the identity questions in this order.
    expect(Object.keys(iq)).toEqual(["decision", "same_name", "same_affiliation", "same_handle"]);

    expect(cq.event_kind?.instructions).toBe(spec.questions.eventKind);
    expect(cq.event_kind?.criteria).toEqual(spec.eventCriteria);
    expect(Object.keys(cq.event_kind?.criteria as object)).toEqual([
      ...CAREER_EVENT_KINDS,
      "no_supported_event",
    ]);
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(cq[dimension]?.instructions).toBe(spec.questions.dimensions[dimension]);
      expect(cq[dimension]?.criteria).toEqual(spec.levels[dimension] as unknown as string[]);
    }
    expect(Object.keys(cq)).toEqual(["event_kind", ...CAREER_EVIDENCE_DIMENSIONS]);
  });

  test("the requests are byte-identical to the ones captured before the refactor", async () => {
    const recorded = readFileSync(
      join(ROOT, "tests/fixtures/longitudinal-jev-request.json"),
      "utf8",
    );
    // Compact, order-sensitive: `toBe` on the one-line form compares the key
    // order the SDK is handed, not just the set of keys a deep-equal would.
    expect(JSON.stringify(await capture())).toBe(JSON.stringify(JSON.parse(recorded)));
  });
});
