import type { JevClaimQuestionsV11 } from "../apps/club/lib/longitudinal/jevClient.ts";
import { claimQuestionsV11, createJevClient } from "../apps/club/lib/longitudinal/jevClient.ts";
import {
  type AtomicClaim,
  preprocessClaims,
  selectionOutputHalves,
} from "../src/longitudinal/claimPreprocess.ts";
import {
  type ClaimRubricState,
  claimRubricRequest,
  halfClaim,
  parseClaimRubricResponse,
  type ScoredClaimV11,
  scoreClaimRubric,
} from "../src/longitudinal/claimRubricV11.ts";
import {
  CLAIM_VALUE_V1_1_0,
  type ClaimValueSubject,
  claimValueConfigHash,
  claimValueConfigId,
  scoreClaimValue,
} from "../src/longitudinal/claimValue.ts";
import { DEFAULT_EVIDENCE_CONCURRENCY } from "../src/longitudinal/policy.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import {
  CAREER_EVIDENCE_V1_1_0,
  careerEvidenceV11RubricHash,
} from "../src/models/careerEvidenceV11.ts";
import type { CareerEvidenceV11Spec } from "../src/models/spec.ts";
import { specId } from "../src/models/spec.ts";
import type { SmokeItem } from "./jev-claim-smoke.ts";

export const V11_JSONL_NAME = "claims.jsonl";
export const V11_SUMMARY_NAME = "summary.md";

const BACKING_TIER = "self_reported" as const;
const SCORED_DIMENSIONS = ["selectivity", "difficulty", "generalized_impact"] as const;

type ScoredDimension = (typeof SCORED_DIMENSIONS)[number];

const PARSER_OWNERSHIP = {
  choice: "supporting" as const,
  confidence: 0,
  probabilities: { led: 0, core_contributor: 0, supporting: 0 },
};

export interface V11JevClient {
  systemOne(request: { state: ClaimRubricState; questions: JevClaimQuestionsV11 }): {
    withResponse(): Promise<{ data: { model: string; answers: unknown } }>;
  };
}

interface LevelCell {
  score: number;
  confidence: number;
  probabilities: readonly number[];
}

interface OwnershipCell {
  choice: string;
  confidence: number;
  probabilities: { led: number; core_contributor: number; supporting: number };
}

interface AnsweredV11Row {
  outcome: "answered";
  rubricId: string;
  rubricHash: string;
  configId: string;
  configHash: string;
  sourceId: string;
  parentId: string;
  childId: string;
  resume: SmokeItem["resume"];
  pair: string | null;
  respondedModel: string;
  claimClass: "selection" | "output";
  classProbabilities: { selection: number; output: number; both: number };
  classConfidence: number;
  selectivity: LevelCell | null;
  curvedSelectivity: number | null;
  selectionRate: number | null;
  difficulty: LevelCell | null;
  generalizedImpact: LevelCell | null;
  curvedDifficulty: number | null;
  curvedGeneralizedImpact: number | null;
  ownership: OwnershipCell | null;
  ownershipMultiplier: number;
  ownershipNullFallback: boolean;
  backingTier: typeof BACKING_TIER;
  backingMultiplier: number;
  classValue: number;
  claimValue: number;
  status: "accepted" | "review" | "rejected";
  reviewReasons: string[];
}

interface FailedV11Row {
  outcome: "unavailable" | "invariant";
  rubricId: string;
  rubricHash: string;
  configId: string;
  configHash: string;
  sourceId: string;
  parentId: string;
  childId: string;
  resume: SmokeItem["resume"];
  pair: string | null;
  respondedModel: null;
  error: string;
}

type V11Row = AnsweredV11Row | FailedV11Row;

export interface V11SmokeReport {
  rubricId: string;
  rubricHash: string;
  configId: string;
  configHash: string;
  rows: V11Row[];
  calls: number;
  answered: number;
  unavailable: number;
  invariant: number;
  accepted: number;
  review: number;
  rejected: number;
  respondedModels: string[];
}

interface Attempt {
  id: string;
  parentId: string;
  text: string;
  selectionRate: number | null;
  answered: { model: string; answers: unknown; nullOwnership: boolean } | null;
  failure: { outcome: "unavailable" | "invariant"; error: string } | null;
}

function pointLevel(score: number) {
  return {
    score,
    confidence: 1,
    probabilities: { 0: score === 0 ? 1 : 0, 1: 0, 2: 0, 3: 0, 4: 0 },
  };
}

const DUMMY_ANSWER = {
  claim_class: {
    choice: "output",
    confidence: 1,
    probabilities: { selection: 0, output: 1, both: 0 },
  },
  selectivity: pointLevel(0),
  difficulty: pointLevel(0),
  generalized_impact: pointLevel(0),
  ownership: PARSER_OWNERSHIP,
};

export function liveV11Client(): V11JevClient {
  const client = createJevClient();
  return {
    systemOne(request) {
      return client.systemOne({
        state: {
          source: request.state.source,
          text: request.state.text,
          selection_rate: request.state.selection_rate,
          selection_rate_upper_bound: request.state.selection_rate_upper_bound,
          ownership_seed: request.state.ownership_seed,
        },
        questions: request.questions,
      });
    },
  };
}

export async function runV11ClaimSmoke(
  items: readonly SmokeItem[],
  client: V11JevClient,
  spec: CareerEvidenceV11Spec = CAREER_EVIDENCE_V1_1_0,
): Promise<V11SmokeReport> {
  const questions = claimQuestionsV11(spec);
  const stamped = stamp(spec);
  const outcomes = await mapWithConcurrency(items, DEFAULT_EVIDENCE_CONCURRENCY, (item) =>
    judgeItem(item, client, spec, questions, stamped),
  );
  const rows = outcomes.flatMap((outcome) => outcome.rows);
  const respondedModels: string[] = [];
  let calls = 0;
  let answered = 0;
  let unavailable = 0;
  let invariant = 0;
  for (const outcome of outcomes) {
    calls += outcome.calls;
    answered += outcome.answered;
    unavailable += outcome.unavailable;
    invariant += outcome.invariant;
    for (const model of outcome.models) {
      if (!respondedModels.includes(model)) respondedModels.push(model);
    }
  }
  let accepted = 0;
  let review = 0;
  let rejected = 0;
  for (const row of rows) {
    if (row.outcome !== "answered") continue;
    if (row.status === "accepted") accepted += 1;
    else if (row.status === "review") review += 1;
    else rejected += 1;
  }
  return {
    ...stamped,
    rows,
    calls,
    answered,
    unavailable,
    invariant,
    accepted,
    review,
    rejected,
    respondedModels,
  };
}

export function renderV11Jsonl(report: V11SmokeReport): string {
  return `${report.rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

export function renderV11Summary(report: V11SmokeReport): string {
  const models = report.respondedModels.length === 0 ? "none" : report.respondedModels.join(", ");
  const lines = [
    "# Jev claim smoke",
    "",
    `Rubric ${report.rubricId}.`,
    `Rubric hash ${report.rubricHash}.`,
    `Claim value ${report.configId}.`,
    `Claim value hash ${report.configHash}.`,
    `Backing ${BACKING_TIER}.`,
    "Identity was not judged.",
    `Calls ${report.calls}. Answered ${report.answered}. judgment_unavailable ${report.unavailable}. Invariant failures ${report.invariant}.`,
    `Claims accepted ${report.accepted}. Review ${report.review}. Rejected ${report.rejected}.`,
    `respondedModel ${models}.`,
    "",
    "## Items",
    "",
    `| ${TABLE_HEADER.join(" | ")} |`,
    `| ${TABLE_HEADER.map(() => "---").join(" | ")} |`,
    ...report.rows.map(tableRow),
    "",
    ...pairLines(report.rows),
    "## Failures",
    "",
  ];
  const failures = report.rows.filter((row) => row.outcome !== "answered");
  if (failures.length === 0) lines.push("None.");
  else {
    for (const row of failures) {
      const label = row.outcome === "unavailable" ? "judgment_unavailable" : "invariant";
      lines.push(`${row.sourceId} ${row.childId} ${label} ${row.error}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function stamp(spec: CareerEvidenceV11Spec): {
  rubricId: string;
  rubricHash: string;
  configId: string;
  configHash: string;
} {
  return {
    rubricId: specId(spec),
    rubricHash: careerEvidenceV11RubricHash(spec),
    configId: claimValueConfigId(CLAIM_VALUE_V1_1_0),
    configHash: claimValueConfigHash(CLAIM_VALUE_V1_1_0),
  };
}

async function judgeItem(
  item: SmokeItem,
  client: V11JevClient,
  spec: CareerEvidenceV11Spec,
  questions: JevClaimQuestionsV11,
  stamped: ReturnType<typeof stamp>,
): Promise<{
  rows: V11Row[];
  calls: number;
  answered: number;
  unavailable: number;
  invariant: number;
  models: string[];
}> {
  const atomic = preprocessClaims(item.statement, item.id);
  const splitterSplit = atomic.length > 1;
  const attempts: Attempt[] = [];
  let calls = 0;
  let answered = 0;
  let unavailable = 0;
  let invariant = 0;
  const models: string[] = [];

  async function ask(claim: AtomicClaim): Promise<Attempt> {
    const request = claimRubricRequest(spec, claim, "resume");
    calls += 1;
    const attempt: Attempt = {
      id: claim.id,
      parentId: claim.parentId,
      text: claim.text,
      selectionRate: request.state.selection_rate,
      answered: null,
      failure: null,
    };
    try {
      const { data } = await client.systemOne({ state: request.state, questions }).withResponse();
      const nullOwnership = hasNullOwnership(data.answers);
      const answers = ownershipForParser(data.answers);
      parseClaimRubricResponse(answers);
      if (data.model.length === 0) {
        throw new JudgmentInvariantError(`claim ${claim.id} responded without a model`);
      }
      attempt.answered = { model: data.model, answers, nullOwnership };
      answered += 1;
      if (!models.includes(data.model)) models.push(data.model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = error instanceof JudgmentInvariantError ? "invariant" : "unavailable";
      attempt.failure = { outcome, error: message };
      if (outcome === "invariant") invariant += 1;
      else unavailable += 1;
    }
    return attempt;
  }

  for (const claim of atomic) {
    attempts.push(await ask(claim));
  }
  const parent = atomic[0];
  const first = attempts[0];
  if (!splitterSplit && parent && first?.answered) {
    const parsed = parseClaimRubricResponse(first.answered.answers);
    if (
      parsed.claim_class.choice === "both" &&
      parsed.claim_class.confidence < spec.thresholds.classConfidence
    ) {
      const halves = selectionOutputHalves(parent.text);
      if (halves) {
        attempts.push(await ask(halfClaim(parent, halves[0], "selection")));
        attempts.push(await ask(halfClaim(parent, halves[1], "output")));
      }
    }
  }

  const scored = scoreAttempts(item.statement, item.id, spec, splitterSplit, attempts);
  const rows: V11Row[] = [];
  for (const attempt of attempts) {
    if (attempt.failure !== null) {
      rows.push(failedRow(item, attempt, attempt.failure, stamped));
      continue;
    }
    const claimRows = scored.filter((claim) => claim.text === attempt.text);
    const answer = attempt.answered;
    if (answer === null) {
      throw new Error(`claim ${attempt.id} was not scored`);
    }
    if (claimRows.length === 0) {
      const superseded = scored.some(
        (claim) => claim.statement === attempt.text && claim.text !== attempt.text,
      );
      if (superseded) continue;
      throw new Error(`claim ${attempt.id} was not scored`);
    }
    for (const claim of claimRows) {
      rows.push(answeredRow(item, attempt, answer, claim, stamped));
    }
  }

  return { rows, calls, answered, unavailable, invariant, models };
}

function scoreAttempts(
  statement: string,
  parentId: string,
  spec: CareerEvidenceV11Spec,
  splitterSplit: boolean,
  attempts: readonly Attempt[],
): ScoredClaimV11[] {
  if (attempts.every((attempt) => attempt.answered === null)) return [];
  const byText = new Map(attempts.map((attempt) => [attempt.text, attempt]));
  const scored = scoreClaimRubric(
    {
      statement,
      parentId,
      source: "resume",
      respond(request) {
        const attempt = byText.get(request.state.text);
        if (attempt?.answered) return attempt.answered.answers;
        return DUMMY_ANSWER;
      },
    },
    spec,
  );
  return scored.filter((claim) => {
    const byText = attempts.find((entry) => entry.text === claim.text);
    if (byText) return byText.answered !== null;
    const attempt = attempts.find((entry) => entry.id === atomicId(claim, splitterSplit));
    return attempt?.answered !== null && attempt !== undefined;
  });
}

function answeredRow(
  item: SmokeItem,
  attempt: Attempt,
  answer: NonNullable<Attempt["answered"]>,
  claim: ScoredClaimV11,
  stamped: ReturnType<typeof stamp>,
): AnsweredV11Row {
  const subject = subjectOf(claim, answer.nullOwnership);
  const value = scoreClaimValue(subject, BACKING_TIER);
  const selection = claim.claimClass === "selection";
  return {
    outcome: "answered",
    ...stamped,
    sourceId: item.id,
    parentId: claim.parentId,
    childId: claim.id,
    resume: item.resume,
    pair: item.pair,
    respondedModel: answer.model,
    claimClass: claim.claimClass,
    classProbabilities: claim.classProbabilities,
    classConfidence: claim.classConfidence,
    selectivity: selection ? claim.selectivity : null,
    curvedSelectivity: value.curved.selectivity,
    selectionRate: selection ? attempt.selectionRate : null,
    difficulty: selection ? null : claim.difficulty,
    generalizedImpact: selection ? null : claim.generalized_impact,
    curvedDifficulty: value.curved.difficulty,
    curvedGeneralizedImpact: value.curved.generalizedImpact,
    ownership: answer.nullOwnership ? null : claim.ownership,
    ownershipMultiplier: value.ownershipMultiplier,
    ownershipNullFallback: answer.nullOwnership,
    backingTier: BACKING_TIER,
    backingMultiplier: value.backingMultiplier,
    classValue: value.classValue,
    claimValue: value.claimValue,
    status: claim.status,
    reviewReasons: claim.reviewReasons,
  };
}

function failedRow(
  item: SmokeItem,
  attempt: Attempt,
  failure: NonNullable<Attempt["failure"]>,
  stamped: ReturnType<typeof stamp>,
): FailedV11Row {
  return {
    outcome: failure.outcome,
    ...stamped,
    sourceId: item.id,
    parentId: attempt.parentId,
    childId: attempt.id,
    resume: item.resume,
    pair: item.pair,
    respondedModel: null,
    error: failure.error,
  };
}

function subjectOf(claim: ScoredClaimV11, nullOwnership: boolean): ClaimValueSubject {
  const ownership = nullOwnership ? null : claim.ownership;
  if (claim.claimClass === "selection") {
    return { claimClass: "selection", selectivity: claim.selectivity, ownership };
  }
  return {
    claimClass: "output",
    difficulty: claim.difficulty,
    generalized_impact: claim.generalized_impact,
    ownership,
  };
}

function atomicId(claim: { id: string; parentId: string }, splitterSplit: boolean): string {
  if (!splitterSplit && (claim.id.endsWith("#selection") || claim.id.endsWith("#output"))) {
    return claim.parentId;
  }
  return claim.id;
}

function hasNullOwnership(answers: unknown): boolean {
  return isRecord(answers) && answers.ownership === null;
}

function ownershipForParser(answers: unknown): unknown {
  if (!hasNullOwnership(answers) || !isRecord(answers)) return answers;
  return { ...answers, ownership: PARSER_OWNERSHIP };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const TABLE_HEADER = [
  "sourceId",
  "childId",
  "resume",
  "class",
  "classConfidence",
  "selectivity",
  "difficulty",
  "generalized_impact",
  "ownershipMultiplier",
  "nullOwnership",
  "classValue",
  "claimValue",
  "status",
  "reasons",
];

function tableRow(row: V11Row): string {
  if (row.outcome !== "answered") {
    const cells = [
      row.sourceId,
      row.childId,
      row.resume,
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      row.outcome,
      row.error,
    ];
    return `| ${cells.join(" | ")} |`;
  }
  const cells = [
    row.sourceId,
    row.childId,
    row.resume,
    row.claimClass,
    fmt(row.classConfidence),
    fmt(row.selectivity?.score ?? null),
    fmt(row.difficulty?.score ?? null),
    fmt(row.generalizedImpact?.score ?? null),
    fmt(row.ownershipMultiplier),
    row.ownershipNullFallback ? "yes" : "no",
    fmt(row.classValue),
    fmt(row.claimValue),
    row.status,
    row.reviewReasons.join(",") || "none",
  ];
  return `| ${cells.join(" | ")} |`;
}

function pairLines(rows: readonly V11Row[]): string[] {
  const order: string[] = [];
  const groups = new Map<string, { A: V11Row[]; B: V11Row[] }>();
  for (const row of rows) {
    if (row.pair === null) continue;
    let group = groups.get(row.pair);
    if (group === undefined) {
      group = { A: [], B: [] };
      groups.set(row.pair, group);
      order.push(row.pair);
    }
    group[row.resume].push(row);
  }
  const lines = [
    "## Pairs",
    "",
    "Max absolute difference of expected level, resume B against resume A, zipped in input order.",
    "",
  ];
  if (order.length === 0) {
    lines.push("No paired items.", "");
    return lines;
  }
  for (const pair of order) {
    const group = groups.get(pair);
    lines.push(`### ${pair}`, "");
    if (group === undefined || group.A.length === 0 || group.B.length === 0) {
      lines.push(
        group !== undefined && group.A.length > 0 ? "resume B is missing" : "resume A is missing",
        "",
      );
      continue;
    }
    for (const dimension of SCORED_DIMENSIONS) {
      const delta = maxAbsExpected(group.A, group.B, dimension);
      lines.push(`${dimension} ${delta === null ? "n/a" : fmt(delta)}`);
    }
    lines.push("");
  }
  return lines;
}

function maxAbsExpected(
  left: readonly V11Row[],
  right: readonly V11Row[],
  dimension: ScoredDimension,
): number | null {
  const a = expectedLevels(left, dimension);
  const b = expectedLevels(right, dimension);
  if (a.length === 0 || b.length === 0) return null;
  const count = Math.min(a.length, b.length);
  let max = 0;
  for (let index = 0; index < count; index++) {
    const first = a[index];
    const second = b[index];
    if (first === undefined || second === undefined) continue;
    max = Math.max(max, Math.abs(second - first));
  }
  return max;
}

function expectedLevels(rows: readonly V11Row[], dimension: ScoredDimension): number[] {
  const levels: number[] = [];
  for (const row of rows) {
    if (row.outcome !== "answered") continue;
    const level =
      dimension === "selectivity"
        ? row.selectivity?.score
        : dimension === "difficulty"
          ? row.difficulty?.score
          : row.generalizedImpact?.score;
    if (level !== undefined) levels.push(level);
  }
  return levels;
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const drain = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) throw new Error(`missing item ${index}`);
      results[index] = await worker(item);
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => drain()));
  return results;
}
