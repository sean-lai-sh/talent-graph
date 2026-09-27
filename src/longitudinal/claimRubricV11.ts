import {
  CAREER_EVIDENCE_V1_1_0,
  careerEvidenceV11RubricHash,
} from "../models/careerEvidenceV11.ts";
import {
  assertSpec,
  type CareerEvidenceLevelText,
  type CareerEvidenceV11Spec,
  specId,
} from "../models/spec.ts";
import {
  type AtomicClaim,
  type ClaimFacts,
  extractFacts,
  type OwnershipTier,
  preprocessClaims,
  selectionOutputHalves,
} from "./claimPreprocess.ts";
import { inRange, unit } from "./ranges.ts";
import { JudgmentInvariantError } from "./records.ts";
import type { SourceKind } from "./types.ts";

export type OwnershipSeed = "led" | "core_contributor" | "supporting";

const OWNERSHIP_SEED = {
  led: "led",
  built: "core_contributor",
  contributed: "supporting",
} as const satisfies Record<OwnershipTier, OwnershipSeed>;

export function ownershipSeedFor(tier: OwnershipTier | null): OwnershipSeed | null {
  if (tier === null) return null;
  return OWNERSHIP_SEED[tier];
}

export interface LevelDistribution {
  score: number;
  confidence: number;
  probabilities: readonly [number, number, number, number, number];
}

export interface ClassDistribution {
  choice: "selection" | "output" | "both";
  confidence: number;
  probabilities: { selection: number; output: number; both: number };
}

export interface OwnershipDistribution {
  choice: OwnershipSeed;
  confidence: number;
  probabilities: Record<OwnershipSeed, number>;
}

export type ClaimV11ReviewReason = "class_low_confidence" | "dimension_low_confidence";

interface ScoredClaimBase {
  id: string;
  parentId: string;
  text: string;
  statement: string;
  classProbabilities: ClassDistribution["probabilities"];
  classConfidence: number;
  ownership: OwnershipDistribution;
  ownershipSeed: OwnershipSeed | null;
  status: "accepted" | "review";
  reviewReasons: ClaimV11ReviewReason[];
  rubricId: string;
  rubricHash: string;
}

export type ScoredClaimV11 =
  | (ScoredClaimBase & { claimClass: "selection"; selectivity: LevelDistribution })
  | (ScoredClaimBase & {
      claimClass: "output";
      difficulty: LevelDistribution;
      generalized_impact: LevelDistribution;
    });

export interface ClaimRubricQuestions {
  claim_class: {
    instructions: string;
    criteria: { selection: string; output: string; both: string };
  };
  selectivity: { instructions: string; criteria: CareerEvidenceLevelText };
  difficulty: { instructions: string; criteria: CareerEvidenceLevelText };
  generalized_impact: { instructions: string; criteria: CareerEvidenceLevelText };
  ownership: {
    instructions: string;
    criteria: { led: string; core_contributor: string; supporting: string };
  };
}

export interface ClaimRubricState {
  source: SourceKind;
  text: string;
  selection_rate: number | null;
  selection_rate_upper_bound: boolean;
  ownership_seed: OwnershipSeed | null;
}

export interface ClaimRubricRequest {
  state: ClaimRubricState;
  questions: ClaimRubricQuestions;
}

interface ParsedResponse {
  claim_class: ClassDistribution;
  selectivity: LevelDistribution;
  difficulty: LevelDistribution;
  generalized_impact: LevelDistribution;
  ownership: OwnershipDistribution;
}

export function claimRubricQuestions(spec: CareerEvidenceV11Spec): ClaimRubricQuestions {
  return {
    claim_class: {
      instructions: spec.claimClass.question,
      criteria: {
        selection: spec.claimClass.selection,
        output: spec.claimClass.output,
        both: spec.claimClass.both,
      },
    },
    selectivity: {
      instructions: spec.selectivity.question,
      criteria: spec.selectivity.levels,
    },
    difficulty: {
      instructions: spec.difficulty.question,
      criteria: spec.difficulty.levels,
    },
    generalized_impact: {
      instructions: spec.generalized_impact.question,
      criteria: spec.generalized_impact.levels,
    },
    ownership: {
      instructions: spec.ownership.question,
      criteria: {
        led: spec.ownership.led,
        core_contributor: spec.ownership.core_contributor,
        supporting: spec.ownership.supporting,
      },
    },
  };
}

export function claimRubricRequest(
  spec: CareerEvidenceV11Spec,
  claim: AtomicClaim,
  source: SourceKind,
): ClaimRubricRequest {
  const signal = selectionSignal(claim.facts);
  return {
    state: {
      source,
      text: claim.text,
      selection_rate: signal?.rate ?? null,
      selection_rate_upper_bound: signal?.upperBound ?? false,
      ownership_seed: ownershipSeedFor(claim.facts.ownership),
    },
    questions: claimRubricQuestions(spec),
  };
}

export function parseClaimRubricResponse(value: unknown): ParsedResponse {
  const record = asRecord(value, "claim response");
  return {
    claim_class: classDistribution(record.claim_class),
    selectivity: levelDistribution(record.selectivity, "selectivity"),
    difficulty: levelDistribution(record.difficulty, "difficulty"),
    generalized_impact: levelDistribution(record.generalized_impact, "generalized_impact"),
    ownership: ownershipDistribution(record.ownership),
  };
}

export function scoreClaimRubric(
  input: {
    statement: string;
    parentId: string;
    source: SourceKind;
    respond: (request: ClaimRubricRequest) => unknown;
  },
  spec: CareerEvidenceV11Spec = CAREER_EVIDENCE_V1_1_0,
): ScoredClaimV11[] {
  assertSpec(spec);
  const atomic = preprocessClaims(input.statement, input.parentId);
  const splitterSplit = atomic.length > 1;
  const scored: ScoredClaimV11[] = [];
  for (const claim of atomic) {
    const request = claimRubricRequest(spec, claim, input.source);
    const parsed = parseClaimRubricResponse(input.respond(request));
    const resolved = resolveClass(parsed, claim, splitterSplit);
    if (resolved === "both") {
      const classConfidence = confidenceFor(parsed, "both");
      if (classConfidence < spec.thresholds.classConfidence) {
        const halves = selectionOutputHalves(claim.text);
        if (halves) {
          scored.push(
            scoreHalf(spec, input, claim, halves[0], "selection"),
            scoreHalf(spec, input, claim, halves[1], "output"),
          );
          continue;
        }
      }
      scored.push(
        materialize(
          spec,
          claim,
          parsed,
          "selection",
          `${claim.parentId}#selection`,
          classConfidence,
        ),
      );
      scored.push(
        materialize(spec, claim, parsed, "output", `${claim.parentId}#output`, classConfidence),
      );
      continue;
    }
    scored.push(
      materialize(spec, claim, parsed, resolved, claim.id, confidenceFor(parsed, resolved)),
    );
  }
  return scored;
}

export function halfClaim(
  parent: AtomicClaim,
  text: string,
  role: "selection" | "output",
): AtomicClaim {
  if (text.trim().length === 0) {
    throw new JudgmentInvariantError("claim half was empty");
  }
  return {
    id: `${parent.parentId}#${role}`,
    parentId: parent.parentId,
    text,
    statement: parent.statement,
    facts: extractFacts(text),
  };
}

function scoreHalf(
  spec: CareerEvidenceV11Spec,
  input: {
    source: SourceKind;
    respond: (request: ClaimRubricRequest) => unknown;
  },
  parent: AtomicClaim,
  text: string,
  role: "selection" | "output",
): ScoredClaimV11 {
  const claim = halfClaim(parent, text, role);
  const parsed = parseClaimRubricResponse(
    input.respond(claimRubricRequest(spec, claim, input.source)),
  );
  const resolved = resolveClass(parsed, claim, true);
  if (resolved === "both") {
    throw new JudgmentInvariantError("a split half resolved to both");
  }
  return materialize(
    spec,
    claim,
    parsed,
    resolved,
    `${parent.parentId}#${resolved}`,
    confidenceFor(parsed, resolved),
  );
}

function selectionSignal(facts: ClaimFacts): { rate: number; upperBound: boolean } | null {
  let best: { rate: number; upperBound: boolean } | null = null;
  for (const selection of facts.selections) {
    const upperBound = selection.kind === "ratio" && selection.poolLowerBound;
    if (best === null || selection.rate < best.rate) best = { rate: selection.rate, upperBound };
  }
  return best;
}

function resolveClass(
  parsed: ParsedResponse,
  claim: AtomicClaim,
  splitterSplit: boolean,
): "selection" | "output" | "both" {
  const choice = parsed.claim_class.choice;
  if (choice === "both" && !splitterSplit) return "both";
  if (choice === "selection" || choice === "output") return choice;
  const { selection, output } = parsed.claim_class.probabilities;
  if (selection > output) return "selection";
  if (output > selection) return "output";
  return claim.facts.selections.length > 0 ? "selection" : "output";
}

function confidenceFor(parsed: ParsedResponse, resolved: "selection" | "output" | "both"): number {
  if (resolved === "both" || parsed.claim_class.choice === resolved) {
    return parsed.claim_class.confidence;
  }
  return parsed.claim_class.probabilities[resolved];
}

function materialize(
  spec: CareerEvidenceV11Spec,
  claim: AtomicClaim,
  parsed: ParsedResponse,
  resolved: "selection" | "output",
  id: string,
  classConfidence: number,
): ScoredClaimV11 {
  const shared = {
    id,
    parentId: claim.parentId,
    text: claim.text,
    statement: claim.statement,
    classProbabilities: parsed.claim_class.probabilities,
    classConfidence,
    ownership: parsed.ownership,
    ownershipSeed: ownershipSeedFor(claim.facts.ownership),
    rubricId: specId(spec),
    rubricHash: careerEvidenceV11RubricHash(spec),
  };
  if (resolved === "selection") {
    return {
      ...shared,
      ...gate(classConfidence, [parsed.selectivity], spec),
      claimClass: "selection",
      selectivity: parsed.selectivity,
    };
  }
  return {
    ...shared,
    ...gate(classConfidence, [parsed.difficulty, parsed.generalized_impact], spec),
    claimClass: "output",
    difficulty: parsed.difficulty,
    generalized_impact: parsed.generalized_impact,
  };
}

function gate(
  classConfidence: number,
  dimensions: readonly LevelDistribution[],
  spec: CareerEvidenceV11Spec,
): { status: "accepted" | "review"; reviewReasons: ClaimV11ReviewReason[] } {
  const reviewReasons: ClaimV11ReviewReason[] = [];
  if (classConfidence < spec.thresholds.classConfidence) {
    reviewReasons.push("class_low_confidence");
  }
  if (dimensions.some((dimension) => dimension.confidence < spec.thresholds.dimensionConfidence)) {
    reviewReasons.push("dimension_low_confidence");
  }
  return { status: reviewReasons.length === 0 ? "accepted" : "review", reviewReasons };
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JudgmentInvariantError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function levelDistribution(value: unknown, what: string): LevelDistribution {
  const record = asRecord(value, what);
  const keyed = asRecord(record.probabilities, `${what}.probabilities`);
  const levels = [0, 1, 2, 3, 4].map((level) =>
    unit(keyed[String(level)], `${what}.probabilities[${level}]`),
  );
  const [p0, p1, p2, p3, p4] = levels;
  if (
    p0 === undefined ||
    p1 === undefined ||
    p2 === undefined ||
    p3 === undefined ||
    p4 === undefined
  ) {
    throw new JudgmentInvariantError(`${what}.probabilities must cover levels 0..4`);
  }
  return {
    score: inRange(record.score, 0, 4, `${what}.score`),
    confidence: unit(record.confidence, `${what}.confidence`),
    probabilities: [p0, p1, p2, p3, p4],
  };
}

function classDistribution(value: unknown): ClassDistribution {
  const record = asRecord(value, "claim_class");
  const choice = record.choice;
  if (choice !== "selection" && choice !== "output" && choice !== "both") {
    throw new JudgmentInvariantError(
      `claim_class.choice must be selection, output, or both (got ${String(choice)})`,
    );
  }
  const keyed = asRecord(record.probabilities, "claim_class.probabilities");
  return {
    choice,
    confidence: unit(record.confidence, "claim_class.confidence"),
    probabilities: {
      selection: unit(keyed.selection, "claim_class.probabilities.selection"),
      output: unit(keyed.output, "claim_class.probabilities.output"),
      both: unit(keyed.both, "claim_class.probabilities.both"),
    },
  };
}

function ownershipDistribution(value: unknown): OwnershipDistribution {
  const record = asRecord(value, "ownership");
  const choice = record.choice;
  if (choice !== "led" && choice !== "core_contributor" && choice !== "supporting") {
    throw new JudgmentInvariantError(
      `ownership.choice must be led, core_contributor, or supporting (got ${String(choice)})`,
    );
  }
  const keyed = asRecord(record.probabilities, "ownership.probabilities");
  return {
    choice,
    confidence: unit(record.confidence, "ownership.confidence"),
    probabilities: {
      led: unit(keyed.led, "ownership.probabilities.led"),
      core_contributor: unit(keyed.core_contributor, "ownership.probabilities.core_contributor"),
      supporting: unit(keyed.supporting, "ownership.probabilities.supporting"),
    },
  };
}
