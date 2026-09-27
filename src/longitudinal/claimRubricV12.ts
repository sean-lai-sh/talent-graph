import {
  CAREER_EVIDENCE_V1_2_0,
  careerEvidenceV12RubricHash,
} from "../models/careerEvidenceV12.ts";
import {
  assertSpec,
  type CareerEvidenceLevelText,
  type CareerEvidenceRoleChoice,
  type CareerEvidenceV12Spec,
  specId,
} from "../models/spec.ts";
import {
  type AtomicClaim,
  type ClaimFacts,
  type DatedClaim,
  extractFacts,
  type JobClaimLine,
  type JobDateFields,
  preprocessJobClaims,
  type SplitClaim,
  selectionOutputHalves,
} from "./claimPreprocess.ts";
import { inRange, unit } from "./ranges.ts";
import { JudgmentInvariantError } from "./records.ts";
import type { SourceKind } from "./types.ts";

export type RoleChoice = CareerEvidenceRoleChoice;

const ROLE_VERBS: readonly { role: RoleChoice; pattern: RegExp }[] = [
  { role: "original_author", pattern: /\b(?:founded|created|owned|led)\b/gi },
  { role: "major_contributor", pattern: /\b(?:built|developed|designed)\b/gi },
  { role: "maintainer", pattern: /\bmaintained\b/gi },
  { role: "minor_part", pattern: /\b(?:contributed|assisted|helped)\b/gi },
];

export function roleSeedFor(text: string): RoleChoice | null {
  let best: { index: number; role: RoleChoice } | null = null;
  for (const entry of ROLE_VERBS) {
    entry.pattern.lastIndex = 0;
    for (const match of text.matchAll(entry.pattern)) {
      if (match.index === undefined) continue;
      if (best === null || match.index < best.index) {
        best = { index: match.index, role: entry.role };
      }
    }
  }
  return best?.role ?? null;
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

export interface RoleDistribution {
  choice: RoleChoice;
  confidence: number;
  probabilities: Record<RoleChoice, number>;
}

export type ClaimV12ReviewReason = "class_low_confidence" | "dimension_low_confidence";

interface ScoredClaimBase {
  id: string;
  parentId: string;
  text: string;
  statement: string;
  classProbabilities: ClassDistribution["probabilities"];
  classConfidence: number;
  status: "accepted" | "review";
  reviewReasons: ClaimV12ReviewReason[];
  rubricId: string;
  rubricHash: string;
  titleHint: string | null;
  jobDates: JobDateFields;
}

export type ScoredClaimV12 =
  | (ScoredClaimBase & {
      claimClass: "selection";
      selectivity: LevelDistribution;
      pool_strength: LevelDistribution;
    })
  | (ScoredClaimBase & {
      claimClass: "output";
      difficulty: LevelDistribution;
      scale: LevelDistribution;
      role: RoleDistribution;
      roleSeed: RoleChoice | null;
    });

interface ClassQuestions {
  claim_class: {
    instructions: string;
    criteria: { selection: string; output: string; both: string };
  };
}

interface SelectionQuestions extends ClassQuestions {
  selectivity: { instructions: string; criteria: CareerEvidenceLevelText };
  pool_strength: { instructions: string; criteria: CareerEvidenceLevelText };
}

interface OutputQuestions extends ClassQuestions {
  difficulty: { instructions: string; criteria: CareerEvidenceLevelText };
  scale: { instructions: string; criteria: CareerEvidenceLevelText };
  role: {
    instructions: string;
    criteria: Record<RoleChoice, string>;
  };
}

interface StateBase {
  source: SourceKind;
  text: string;
  selection_rate: number | null;
  selection_rate_upper_bound: boolean;
  title_hint: string | null;
}

export type ClaimRubricV12Request =
  | { state: StateBase; questions: ClassQuestions }
  | { state: StateBase; questions: SelectionQuestions }
  | { state: StateBase & { role_seed: RoleChoice | null }; questions: OutputQuestions };

export interface ClaimRubricCatalog {
  claim_class: ClassQuestions["claim_class"];
  selectivity: SelectionQuestions["selectivity"];
  pool_strength: SelectionQuestions["pool_strength"];
  difficulty: OutputQuestions["difficulty"];
  scale: OutputQuestions["scale"];
  role: OutputQuestions["role"];
}

type Ask = "class" | "selection" | "output";

interface ParsedSelection {
  claim_class: ClassDistribution;
  selectivity: LevelDistribution;
  pool_strength: LevelDistribution;
}

interface ParsedOutput {
  claim_class: ClassDistribution;
  difficulty: LevelDistribution;
  scale: LevelDistribution;
  role: RoleDistribution;
}

export function claimRubricCatalog(spec: CareerEvidenceV12Spec): ClaimRubricCatalog {
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
    pool_strength: {
      instructions: spec.pool_strength.question,
      criteria: spec.pool_strength.levels,
    },
    difficulty: {
      instructions: spec.difficulty.question,
      criteria: spec.difficulty.levels,
    },
    scale: {
      instructions: spec.scale.question,
      criteria: spec.scale.levels,
    },
    role: {
      instructions: spec.role.question,
      criteria: {
        original_author: spec.role.original_author,
        major_contributor: spec.role.major_contributor,
        maintainer: spec.role.maintainer,
        minor_part: spec.role.minor_part,
      },
    },
  };
}

export function claimRubricRequestV12(
  spec: CareerEvidenceV12Spec,
  claim: SplitClaim | AtomicClaim,
  source: SourceKind,
  ask: Ask,
): ClaimRubricV12Request {
  const catalog = claimRubricCatalog(spec);
  const signal = selectionSignal(claim.facts);
  const state: StateBase = {
    source,
    text: claim.text,
    selection_rate: signal?.rate ?? null,
    selection_rate_upper_bound: signal?.upperBound ?? false,
    title_hint: titleOf(claim),
  };
  if (ask === "class") return { state, questions: { claim_class: catalog.claim_class } };
  if (ask === "selection") {
    return {
      state,
      questions: {
        claim_class: catalog.claim_class,
        selectivity: catalog.selectivity,
        pool_strength: catalog.pool_strength,
      },
    };
  }
  return {
    state: { ...state, role_seed: roleSeedFor(claim.text) },
    questions: {
      claim_class: catalog.claim_class,
      difficulty: catalog.difficulty,
      scale: catalog.scale,
      role: catalog.role,
    },
  };
}

export function scoreClaimRubricV12(
  input: {
    lines: readonly JobClaimLine[];
    source: SourceKind;
    respond: (request: ClaimRubricV12Request) => unknown;
  },
  spec: CareerEvidenceV12Spec = CAREER_EVIDENCE_V1_2_0,
): ScoredClaimV12[] {
  assertSpec(spec);
  const scored: ScoredClaimV12[] = [];
  for (const claim of preprocessJobClaims(input.lines, { version: "1.2.0" })) {
    if (isDated(claim) && claim.noWorkDescribed === true) continue;
    if (isDated(claim)) {
      scored.push(scoreKnown(spec, input, claim, claim.claimClass));
      continue;
    }
    scored.push(...scoreOpen(spec, input, claim));
  }
  return scored;
}

function scoreOpen(
  spec: CareerEvidenceV12Spec,
  input: {
    source: SourceKind;
    respond: (request: ClaimRubricV12Request) => unknown;
  },
  claim: AtomicClaim,
): ScoredClaimV12[] {
  const probed = classDistribution(
    asRecord(
      input.respond(claimRubricRequestV12(spec, claim, input.source, "class")),
      "claim response",
    ).claim_class,
  );
  const resolved = probed.choice === "both" ? "both" : probed.choice;
  if (resolved === "both") {
    if (probed.confidence < spec.thresholds.classConfidence) {
      const halves = selectionOutputHalves(claim.text);
      if (halves) {
        return [
          scoreKnown(spec, input, child(claim, halves[0], "selection"), "selection"),
          scoreKnown(spec, input, child(claim, halves[1], "output"), "output"),
        ];
      }
    }
    return [
      scoreKnown(spec, input, child(claim, claim.text, "selection"), "selection"),
      scoreKnown(spec, input, child(claim, claim.text, "output"), "output"),
    ];
  }
  return [scoreKnown(spec, input, claim, resolved)];
}

function child(claim: AtomicClaim, text: string, role: "selection" | "output"): AtomicClaim {
  return {
    id: `${claim.id}#${role}`,
    parentId: claim.parentId,
    text,
    statement: claim.statement,
    facts: extractFacts(text),
  };
}

function scoreKnown(
  spec: CareerEvidenceV12Spec,
  input: {
    source: SourceKind;
    respond: (request: ClaimRubricV12Request) => unknown;
  },
  claim: SplitClaim,
  claimClass: "selection" | "output",
): ScoredClaimV12 {
  const raw = input.respond(claimRubricRequestV12(spec, claim, input.source, claimClass));
  if (claimClass === "selection") {
    return materialize(spec, claim, parseResponse(raw, "selection"), "selection", claim.id);
  }
  return materialize(spec, claim, parseResponse(raw, "output"), "output", claim.id);
}

function parseResponse(value: unknown, claimClass: "selection"): ParsedSelection;
function parseResponse(value: unknown, claimClass: "output"): ParsedOutput;
function parseResponse(
  value: unknown,
  claimClass: "selection" | "output",
): ParsedSelection | ParsedOutput {
  const record = asRecord(value, "claim response");
  if (claimClass === "selection") {
    return {
      claim_class: classDistribution(record.claim_class),
      selectivity: levelDistribution(record.selectivity, "selectivity"),
      pool_strength: levelDistribution(record.pool_strength, "pool_strength"),
    };
  }
  return {
    claim_class: classDistribution(record.claim_class),
    difficulty: levelDistribution(record.difficulty, "difficulty"),
    scale: levelDistribution(record.scale, "scale"),
    role: roleDistribution(record.role),
  };
}

function materialize(
  spec: CareerEvidenceV12Spec,
  claim: SplitClaim,
  parsed: ParsedSelection | ParsedOutput,
  claimClass: "selection" | "output",
  id: string,
): ScoredClaimV12 {
  const classConfidence = confidenceFor(parsed.claim_class, claimClass);
  const shared = {
    id,
    parentId: claim.parentId,
    text: claim.text,
    statement: claim.statement,
    classProbabilities: parsed.claim_class.probabilities,
    classConfidence,
    rubricId: specId(spec),
    rubricHash: careerEvidenceV12RubricHash(spec),
    titleHint: titleOf(claim),
    jobDates: jobDatesOf(claim),
  };
  if (claimClass === "selection") {
    if (!("pool_strength" in parsed)) {
      throw new JudgmentInvariantError("selection response did not include pool_strength");
    }
    const selection = parsed;
    return {
      ...shared,
      ...gate(classConfidence, [selection.selectivity, selection.pool_strength], spec),
      claimClass: "selection",
      selectivity: selection.selectivity,
      pool_strength: selection.pool_strength,
    };
  }
  if (!("role" in parsed)) {
    throw new JudgmentInvariantError("output response did not include role");
  }
  const output = parsed;
  return {
    ...shared,
    ...gate(classConfidence, [output.difficulty, output.scale], spec),
    claimClass: "output",
    difficulty: output.difficulty,
    scale: output.scale,
    role: output.role,
    roleSeed: roleSeedFor(claim.text),
  };
}

function confidenceFor(parsed: ClassDistribution, resolved: "selection" | "output"): number {
  if (parsed.choice === resolved) return parsed.confidence;
  return parsed.probabilities[resolved];
}

function gate(
  classConfidence: number,
  dimensions: readonly LevelDistribution[],
  spec: CareerEvidenceV12Spec,
): { status: "accepted" | "review"; reviewReasons: ClaimV12ReviewReason[] } {
  const reviewReasons: ClaimV12ReviewReason[] = [];
  if (classConfidence < spec.thresholds.classConfidence) {
    reviewReasons.push("class_low_confidence");
  }
  if (dimensions.some((dimension) => dimension.confidence < spec.thresholds.dimensionConfidence)) {
    reviewReasons.push("dimension_low_confidence");
  }
  return { status: reviewReasons.length === 0 ? "accepted" : "review", reviewReasons };
}

function isDated(claim: SplitClaim): claim is DatedClaim {
  return "claimClass" in claim;
}

function titleOf(claim: SplitClaim | AtomicClaim): string | null {
  if (!isDated(claim)) return null;
  return claim.title;
}

function jobDatesOf(claim: SplitClaim): JobDateFields {
  if (!isDated(claim)) return { startedAt: null, endedAt: null, publishedAt: null };
  return {
    startedAt: claim.startedAt,
    endedAt: claim.endedAt,
    publishedAt: claim.publishedAt,
  };
}

function selectionSignal(facts: ClaimFacts): { rate: number; upperBound: boolean } | null {
  let best: { rate: number; upperBound: boolean } | null = null;
  for (const selection of facts.selections) {
    const upperBound = selection.kind === "ratio" && selection.poolLowerBound;
    if (best === null || selection.rate < best.rate) best = { rate: selection.rate, upperBound };
  }
  return best;
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

function roleDistribution(value: unknown): RoleDistribution {
  const record = asRecord(value, "role");
  const choice = record.choice;
  if (
    choice !== "original_author" &&
    choice !== "major_contributor" &&
    choice !== "maintainer" &&
    choice !== "minor_part"
  ) {
    throw new JudgmentInvariantError(
      `role.choice must be original_author, major_contributor, maintainer, or minor_part (got ${String(choice)})`,
    );
  }
  const keyed = asRecord(record.probabilities, "role.probabilities");
  return {
    choice,
    confidence: unit(record.confidence, "role.confidence"),
    probabilities: {
      original_author: unit(keyed.original_author, "role.probabilities.original_author"),
      major_contributor: unit(keyed.major_contributor, "role.probabilities.major_contributor"),
      maintainer: unit(keyed.maintainer, "role.probabilities.maintainer"),
      minor_part: unit(keyed.minor_part, "role.probabilities.minor_part"),
    },
  };
}
