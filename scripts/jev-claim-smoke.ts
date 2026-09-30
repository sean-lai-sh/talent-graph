#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createJevClient,
  createJevJudgmentService,
  type JevClient,
} from "../apps/club/lib/longitudinal/jev.ts";
import type {
  ClaimAssessment,
  IdentityAssessment,
  JevJudgment,
  JevJudgmentService,
} from "../src/longitudinal/judgments.ts";
import { DEFAULT_EVIDENCE_CONCURRENCY } from "../src/longitudinal/policy.ts";
import { contentFingerprint } from "../src/longitudinal/provenance.ts";
import type {
  JevChoiceAnswer,
  JevJudgmentRecord,
  JevRawScoreAnswer,
} from "../src/longitudinal/records.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import { decideStatus } from "../src/longitudinal/stages.ts";
import type { ClaimStatus, GrokEvidenceItem, ReviewReason } from "../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0, careerEvidenceRubricHash } from "../src/models/careerEvidence.ts";
import { CAREER_EVIDENCE_V1_1_0 } from "../src/models/careerEvidenceV11.ts";
import { CAREER_EVIDENCE_V1_2_0 } from "../src/models/careerEvidenceV12.ts";
import { type CareerEvidenceSpec, specId } from "../src/models/spec.ts";
import {
  liveV11Client,
  renderV11Jsonl,
  renderV11Summary,
  runV11ClaimSmoke,
  V11_JSONL_NAME,
  V11_SUMMARY_NAME,
  type V11JevClient,
} from "./jev-claim-smoke-v11.ts";
import {
  liveV12Client,
  renderV12Jobs,
  renderV12Jsonl,
  renderV12Summary,
  runV12ClaimSmoke,
  type V12JevClient,
} from "./jev-claim-smoke-v12.ts";

export const SOURCE_URL_PLACEHOLDER = "https://example.invalid/resume-source-placeholder";

export const UNLINKED_PERSON_ID = "sea-35-unlinked";

const CALIBRATION_DIMENSIONS = ["difficulty", "external_impact", "peer_validation"] as const;

type CalibrationDimension = (typeof CALIBRATION_DIMENSIONS)[number];

export interface SmokeItem {
  id: string;
  resume: "A" | "B";
  org: string;
  role: string;
  dates: string;
  statement: string;
  pair: string | null;
  publishedAt: string;
}

interface DimensionCell {
  expected: number;
  argmax: number;
  confidence: number;
  probabilities: number[];
}

interface AnsweredRow {
  kind: "answered";
  item: SmokeItem;
  judgment: JevJudgment<ClaimAssessment>;
  eventKind: string;
  eventConfidence: number;
  eventTop2: { label: string; probability: number }[];
  dimensions: Record<CalibrationDimension, DimensionCell>;
  status: ClaimStatus;
  reasons: ReviewReason[];
  respondedModel: string;
}

interface FailedRow {
  kind: "unavailable" | "invariant";
  item: SmokeItem;
  error: string;
  status: ClaimStatus;
  reasons: ReviewReason[];
}

type ItemRow = AnsweredRow | FailedRow;

export interface SmokeReport {
  rubricId: string;
  rubricHash: string;
  rows: ItemRow[];
  calls: number;
  answered: number;
  unavailable: number;
  invariant: number;
  respondedModels: string[];
}

const PASSED_IDENTITY_GATE: IdentityAssessment = {
  decision: "same",
  confidence: 1,
  fieldMatches: { name: 1, affiliation: 1, handle: 1 },
};

function claimCutoff(
  assessment: ClaimAssessment | null,
  spec: CareerEvidenceSpec,
): {
  status: ClaimStatus;
  reasons: ReviewReason[];
} {
  return decideStatus(PASSED_IDENTITY_GATE, assessment, spec.thresholds);
}

export function parseSmokeItems(raw: unknown): SmokeItem[] {
  if (!Array.isArray(raw)) throw new Error("items file must be a JSON array");
  const ids = new Set<string>();
  const pairs = new Set<string>();
  return raw.map((entry, index) => parseItem(entry, index, ids, pairs));
}

function parseItem(entry: unknown, index: number, ids: Set<string>, pairs: Set<string>): SmokeItem {
  const where = `items[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${where} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const id = requiredString(record, "id", where);
  if (id.includes("|")) throw new Error(`${where}.id contains "|"`);
  if (ids.has(id)) throw new Error(`${where}.id duplicates ${id}`);
  ids.add(id);
  const resume = record.resume;
  if (resume !== "A" && resume !== "B") {
    throw new Error(`${where}.resume must be "A" or "B"`);
  }
  const pair = record.pair;
  if (pair !== null && typeof pair !== "string") {
    throw new Error(`${where}.pair must be a string or null`);
  }
  if (typeof pair === "string") {
    if (pair.length === 0 || pair.includes("|")) {
      throw new Error(`${where}.pair must be a non-empty string`);
    }
    const key = `${pair}\0${resume}`;
    if (pairs.has(key))
      throw new Error(`${where}.pair ${pair} is already used by resume ${resume}`);
    pairs.add(key);
  }
  const publishedAt = requiredString(record, "publishedAt", where);
  if (publishedAt.includes("|") || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error(`${where}.publishedAt must be an instant`);
  }
  return {
    id,
    resume,
    org: requiredString(record, "org", where),
    role: requiredString(record, "role", where),
    dates: requiredString(record, "dates", where),
    statement: requiredString(record, "statement", where),
    pair,
    publishedAt,
  };
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

export function toEvidence(item: SmokeItem): GrokEvidenceItem {
  return {
    source: "resume",
    sourceId: item.id,
    url: SOURCE_URL_PLACEHOLDER,
    publisher: item.org,
    publishedAt: item.publishedAt,
    quotedText: item.statement,
    contentHash: contentFingerprint(item.statement),
    statement: item.statement,
    proposedEventKind: null,
  };
}

function isScoreAnswer(answer: unknown): answer is JevRawScoreAnswer {
  if (answer === null || typeof answer !== "object") return false;
  const record = answer as { score?: unknown; probabilities?: unknown; confidence?: unknown };
  return (
    typeof record.score === "number" &&
    typeof record.confidence === "number" &&
    Array.isArray(record.probabilities)
  );
}

function isChoiceAnswer(answer: unknown): answer is JevChoiceAnswer {
  if (answer === null || typeof answer !== "object") return false;
  const record = answer as { choice?: unknown; confidence?: unknown; probabilities?: unknown };
  return (
    typeof record.choice === "string" &&
    typeof record.confidence === "number" &&
    record.probabilities !== null &&
    typeof record.probabilities === "object" &&
    !Array.isArray(record.probabilities)
  );
}

function argmax(probabilities: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < probabilities.length; index++) {
    const probability = probabilities[index];
    const leader = probabilities[best];
    if (probability !== undefined && leader !== undefined && probability > leader) best = index;
  }
  return best;
}

function top2(probabilities: Record<string, number>): { label: string; probability: number }[] {
  return Object.entries(probabilities)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([label, probability]) => ({ label, probability }));
}

function dimensionCell(record: JevJudgmentRecord, dimension: CalibrationDimension): DimensionCell {
  const answer = record.answers[dimension];
  if (!isScoreAnswer(answer)) {
    throw new JudgmentInvariantError(`claim record ${record.id} has no ${dimension} score`);
  }
  return {
    expected: answer.score,
    argmax: argmax(answer.probabilities),
    confidence: answer.confidence,
    probabilities: [...answer.probabilities],
  };
}

function answeredRow(
  item: SmokeItem,
  judgment: JevJudgment<ClaimAssessment>,
  spec: CareerEvidenceSpec,
): AnsweredRow {
  const event = judgment.record.answers.event_kind;
  if (!isChoiceAnswer(event)) {
    throw new JudgmentInvariantError(`claim record ${judgment.record.id} has no event_kind choice`);
  }
  const decision = claimCutoff(judgment.assessment, spec);
  const dimensions = {} as Record<CalibrationDimension, DimensionCell>;
  for (const dimension of CALIBRATION_DIMENSIONS) {
    dimensions[dimension] = dimensionCell(judgment.record, dimension);
  }
  return {
    kind: "answered",
    item,
    judgment,
    eventKind: event.choice,
    eventConfidence: event.confidence,
    eventTop2: top2(event.probabilities),
    dimensions,
    status: decision.status,
    reasons: decision.reasons,
    respondedModel: judgment.record.respondedModel,
  };
}

function failedRow(
  item: SmokeItem,
  kind: FailedRow["kind"],
  error: string,
  spec: CareerEvidenceSpec,
): FailedRow {
  const decision = claimCutoff(null, spec);
  return { kind, item, error, status: decision.status, reasons: decision.reasons };
}

async function judgeOne(
  service: JevJudgmentService,
  item: SmokeItem,
  spec: CareerEvidenceSpec,
): Promise<ItemRow> {
  try {
    const judgment = await service.assessClaim(toEvidence(item), UNLINKED_PERSON_ID);
    return answeredRow(item, judgment, spec);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof JudgmentInvariantError) return failedRow(item, "invariant", message, spec);
    return failedRow(item, "unavailable", message, spec);
  }
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

export async function runClaimSmoke(
  items: readonly SmokeItem[],
  service: JevJudgmentService,
  spec: CareerEvidenceSpec = CAREER_EVIDENCE_V1_0_0,
): Promise<SmokeReport> {
  const rows = await mapWithConcurrency(items, DEFAULT_EVIDENCE_CONCURRENCY, (item) =>
    judgeOne(service, item, spec),
  );
  const respondedModels: string[] = [];
  let answered = 0;
  let unavailable = 0;
  let invariant = 0;
  for (const row of rows) {
    if (row.kind === "answered") {
      answered += 1;
      if (!respondedModels.includes(row.respondedModel)) respondedModels.push(row.respondedModel);
    } else if (row.kind === "unavailable") {
      unavailable += 1;
    } else {
      invariant += 1;
    }
  }
  return {
    rubricId: specId(spec),
    rubricHash: careerEvidenceRubricHash(spec),
    rows,
    calls: rows.length,
    answered,
    unavailable,
    invariant,
    respondedModels,
  };
}

function fmt(value: number): string {
  return value.toFixed(4);
}

function probabilityList(values: readonly number[]): string {
  return values.map((value) => fmt(value)).join(",");
}

function eventTop2Cell(row: AnsweredRow): string {
  return row.eventTop2.map((entry) => `${entry.label} ${fmt(entry.probability)}`).join(", ");
}

function tableRow(row: ItemRow): string {
  const id = row.item.id;
  const resume = row.item.resume;
  if (row.kind !== "answered") {
    const blank = Array.from({ length: 15 }, () => "n/a");
    const status = row.kind === "invariant" ? "n/a" : row.status;
    const reasons = row.kind === "invariant" ? "invariant" : row.reasons.join(",");
    return `| ${[id, resume, ...blank, status, reasons].join(" | ")} |`;
  }
  const cells = [id, resume, row.eventKind, fmt(row.eventConfidence), eventTop2Cell(row)];
  for (const dimension of CALIBRATION_DIMENSIONS) {
    const cell = row.dimensions[dimension];
    cells.push(
      fmt(cell.expected),
      String(cell.argmax),
      fmt(cell.confidence),
      probabilityList(cell.probabilities),
    );
  }
  cells.push(row.status, row.reasons.join(","));
  return `| ${cells.join(" | ")} |`;
}

const TABLE_HEADER = [
  "id",
  "resume",
  "event_kind",
  "event_confidence",
  "event_top2",
  "difficulty_ev",
  "difficulty_argmax",
  "difficulty_confidence",
  "difficulty_probabilities",
  "external_impact_ev",
  "external_impact_argmax",
  "external_impact_confidence",
  "external_impact_probabilities",
  "peer_validation_ev",
  "peer_validation_argmax",
  "peer_validation_confidence",
  "peer_validation_probabilities",
  "status",
  "reasons",
];

function pairLines(rows: readonly ItemRow[]): string[] {
  const order: string[] = [];
  const byPair = new Map<string, { A?: ItemRow; B?: ItemRow }>();
  for (const row of rows) {
    const pair = row.item.pair;
    if (pair === null) continue;
    let group = byPair.get(pair);
    if (group === undefined) {
      group = {};
      byPair.set(pair, group);
      order.push(pair);
    }
    group[row.item.resume] = row;
  }
  const lines = ["## Identical pairs", "", "Deltas are B minus A.", ""];
  if (order.length === 0) {
    lines.push("No paired items.");
    return lines;
  }
  for (const pair of order) {
    const group = byPair.get(pair);
    lines.push(`### ${pair}`, "");
    const left = group?.A;
    const right = group?.B;
    if (left === undefined || right === undefined) {
      lines.push(left === undefined ? "resume A is missing" : "resume B is missing", "");
      continue;
    }
    if (left.kind !== "answered" || right.kind !== "answered") {
      const side = left.kind !== "answered" ? "A" : "B";
      const failed = left.kind !== "answered" ? left : right;
      lines.push(`judgment_unavailable on ${side} (${failed.kind})`, "");
      continue;
    }
    lines.push(`event_kind A ${left.eventKind} B ${right.eventKind}`);
    lines.push(
      `event_confidence A ${fmt(left.eventConfidence)} B ${fmt(right.eventConfidence)} delta ${fmt(right.eventConfidence - left.eventConfidence)}`,
    );
    for (const dimension of CALIBRATION_DIMENSIONS) {
      const a = left.dimensions[dimension].expected;
      const b = right.dimensions[dimension].expected;
      lines.push(`${dimension} A ${fmt(a)} B ${fmt(b)} delta ${fmt(b - a)}`);
    }
    lines.push(`status A ${left.status} B ${right.status}`, "");
  }
  return lines;
}

export function renderSummary(report: SmokeReport): string {
  const models = report.respondedModels.length === 0 ? "none" : report.respondedModels.join(", ");
  const header = [
    "# Jev claim smoke",
    "",
    `Rubric ${report.rubricId}.`,
    `Rubric hash ${report.rubricHash}.`,
    "Identity was not judged. Status is decideStatus after a passed identity gate, for reference only.",
    `The source_url on every item is ${SOURCE_URL_PLACEHOLDER}. That URL is a placeholder.`,
    `Calls ${report.calls}. Answered ${report.answered}. judgment_unavailable ${report.unavailable}. Invariant failures ${report.invariant}.`,
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
  const failures = report.rows.filter((row) => row.kind !== "answered");
  if (failures.length === 0) header.push("None.");
  else {
    for (const row of failures) {
      const label = row.kind === "unavailable" ? "judgment_unavailable" : "invariant";
      header.push(`${row.item.id} ${label} ${row.error}`);
    }
  }
  header.push("");
  return header.join("\n");
}

export function renderJsonl(report: SmokeReport): string {
  const lines = report.rows.map((row) => {
    const rubric = { rubricId: report.rubricId, rubricHash: report.rubricHash };
    if (row.kind === "answered") {
      return JSON.stringify({
        ...rubric,
        id: row.item.id,
        resume: row.item.resume,
        pair: row.item.pair,
        outcome: "answered",
        respondedModel: row.respondedModel,
        judgment: row.judgment,
      });
    }
    return JSON.stringify({
      ...rubric,
      id: row.item.id,
      resume: row.item.resume,
      pair: row.item.pair,
      outcome: row.kind === "unavailable" ? "judgment_unavailable" : "invariant",
      error: row.error,
    });
  });
  return `${lines.join("\n")}\n`;
}

export async function runClaimSmokeFiles(options: {
  itemsPath: string;
  jsonlPath: string;
  summaryPath: string;
  service: JevJudgmentService;
  spec?: CareerEvidenceSpec;
}): Promise<SmokeReport> {
  const raw: unknown = JSON.parse(await readFile(options.itemsPath, "utf8"));
  const items = parseSmokeItems(raw);
  if (items.length === 0) throw new Error("items file is empty");
  const report = await runClaimSmoke(
    items,
    options.service,
    options.spec ?? CAREER_EVIDENCE_V1_0_0,
  );
  await mkdir(dirname(options.jsonlPath), { recursive: true });
  await mkdir(dirname(options.summaryPath), { recursive: true });
  await writeFile(options.jsonlPath, renderJsonl(report));
  await writeFile(options.summaryPath, renderSummary(report));
  return report;
}

export function liveJudgmentService(
  spec: CareerEvidenceSpec = CAREER_EVIDENCE_V1_0_0,
  client: JevClient = createJevClient(),
): JevJudgmentService {
  return createJevJudgmentService(client, spec);
}

function rubricFor(name: string | undefined): CareerEvidenceSpec {
  if (
    name === undefined ||
    name === specId(CAREER_EVIDENCE_V1_0_0) ||
    name === "CAREER_EVIDENCE_V1_0_0"
  ) {
    return CAREER_EVIDENCE_V1_0_0;
  }
  throw new Error(`unknown rubric ${name}`);
}

const USAGE =
  "usage: bun run scripts/jev-claim-smoke.ts --items <path> (--jsonl <path> --summary <path> | --out <dir>) [--spec career_evidence@1.0.0] [--rubric career_evidence@1.0.0|career_evidence@1.1.0|career_evidence@1.2.0]";

const FLAGS = new Set<string>(["--items", "--jsonl", "--summary", "--spec", "--rubric", "--out"]);

function parseArgs(argv: readonly string[]): {
  items: string;
  jsonl: string;
  summary: string;
  spec: string | undefined;
  rubric: string | undefined;
  jobsOnly: boolean;
} {
  const values = new Map<string, string>();
  let jobsOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--jobs-only") {
      jobsOnly = true;
      continue;
    }
    if (flag === undefined || !FLAGS.has(flag)) {
      throw new Error(`unknown argument ${flag ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const items = values.get("--items");
  if (jobsOnly) {
    if (items === undefined) throw new Error("missing --items for --jobs-only");
    return {
      items,
      jsonl: "",
      summary: "",
      spec: values.get("--spec"),
      rubric: values.get("--rubric"),
      jobsOnly: true,
    };
  }
  const out = values.get("--out");
  const jsonl =
    values.get("--jsonl") ?? (out === undefined ? undefined : join(out, V11_JSONL_NAME));
  const summary =
    values.get("--summary") ?? (out === undefined ? undefined : join(out, V11_SUMMARY_NAME));
  if (items === undefined || jsonl === undefined || summary === undefined) throw new Error(USAGE);
  return {
    items,
    jsonl,
    summary,
    spec: values.get("--spec"),
    rubric: values.get("--rubric"),
    jobsOnly: false,
  };
}

function rubricMode(
  specFlag: string | undefined,
  rubricFlag: string | undefined,
): "v10" | "v11" | "v12" {
  if (rubricFlag === undefined) {
    rubricFor(specFlag);
    return "v10";
  }
  const v12 =
    rubricFlag === specId(CAREER_EVIDENCE_V1_2_0) || rubricFlag === "CAREER_EVIDENCE_V1_2_0";
  const v11 =
    rubricFlag === specId(CAREER_EVIDENCE_V1_1_0) || rubricFlag === "CAREER_EVIDENCE_V1_1_0";
  const v10 =
    rubricFlag === specId(CAREER_EVIDENCE_V1_0_0) || rubricFlag === "CAREER_EVIDENCE_V1_0_0";
  if (!v12 && !v11 && !v10) throw new Error(`unknown rubric ${rubricFlag}`);
  if (v10) {
    rubricFor(specFlag);
    return "v10";
  }
  const selected = v12 ? CAREER_EVIDENCE_V1_2_0 : CAREER_EVIDENCE_V1_1_0;
  const constantName = v12 ? "CAREER_EVIDENCE_V1_2_0" : "CAREER_EVIDENCE_V1_1_0";
  if (specFlag !== undefined && specFlag !== specId(selected) && specFlag !== constantName) {
    throw new Error(`rubric flags disagree: --spec ${specFlag} and --rubric ${rubricFlag}`);
  }
  return v12 ? "v12" : "v11";
}

export async function main(
  argv: readonly string[],
  service?: JevJudgmentService,
  v11Client?: V11JevClient,
  v12Client?: V12JevClient,
): Promise<number> {
  const args = parseArgs(argv);
  if (args.jobsOnly) {
    const raw: unknown = JSON.parse(await readFile(args.items, "utf8"));
    const items = parseSmokeItems(raw);
    if (items.length === 0) throw new Error("items file is empty");
    console.log(renderV12Jobs(items));
    return 0;
  }
  const mode = rubricMode(args.spec, args.rubric);
  if (mode === "v11" || mode === "v12") {
    const raw: unknown = JSON.parse(await readFile(args.items, "utf8"));
    const items = parseSmokeItems(raw);
    if (items.length === 0) throw new Error("items file is empty");
    await mkdir(dirname(args.jsonl), { recursive: true });
    await mkdir(dirname(args.summary), { recursive: true });
    if (mode === "v12") {
      const report = await runV12ClaimSmoke(items, v12Client ?? liveV12Client());
      await writeFile(args.jsonl, renderV12Jsonl(report));
      await writeFile(args.summary, renderV12Summary(report));
      return report.invariant > 0 ? 1 : 0;
    }
    const report = await runV11ClaimSmoke(items, v11Client ?? liveV11Client());
    await writeFile(args.jsonl, renderV11Jsonl(report));
    await writeFile(args.summary, renderV11Summary(report));
    return report.invariant > 0 ? 1 : 0;
  }
  const spec = rubricFor(args.spec);
  const report = await runClaimSmokeFiles({
    itemsPath: args.items,
    jsonlPath: args.jsonl,
    summaryPath: args.summary,
    service: service ?? liveJudgmentService(spec),
    spec,
  });
  return report.invariant > 0 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
