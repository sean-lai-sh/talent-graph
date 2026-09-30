import { claimQuestionsV12, createJevClient } from "../apps/club/lib/longitudinal/jevClient.ts";
import {
  type JobClaimLine,
  observedAtForJobClaim,
  preprocessJobClaims,
  type SplitClaim,
} from "../src/longitudinal/claimPreprocess.ts";
import {
  type ClaimRubricV12Request,
  type ScoredClaimV12,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";
import {
  CLAIM_VALUE_V1_2_0,
  claimValueV12ConfigHash,
  claimValueV12ConfigId,
  scoreClaimValueV12,
} from "../src/longitudinal/claimValue.ts";
import {
  type PersonAlpha,
  type PersonRollup,
  personRollupHash,
  personRollups,
  type RollupClaim,
} from "../src/longitudinal/personRollup.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import {
  CAREER_EVIDENCE_V1_2_0,
  CAREER_EVIDENCE_V1_2_1,
  careerEvidenceV12RubricHash,
} from "../src/models/careerEvidenceV12.ts";
import { type CareerEvidenceV12Spec, specId } from "../src/models/spec.ts";
import type { SmokeItem } from "./jev-claim-smoke.ts";

const BACKING_TIER = "self_reported" as const;
const RESUMES = ["A", "B"] as const;
const LEVELS = ["0", "1", "2", "3", "4"] as const;
const ROLES = ["original_author", "major_contributor", "maintainer", "minor_part"] as const;
const PAIR_DIMENSIONS = ["selectivity", "pool_strength", "difficulty", "scale"] as const;

type ResumeId = (typeof RESUMES)[number];
type PairDimension = (typeof PAIR_DIMENSIONS)[number];
type ClaimKind = "selection" | "output" | "funding";

interface Stamp {
  rubricId: string;
  rubricHash: string;
  configId: string;
  configHash: string;
}

interface AnsweredV12Row extends Stamp {
  outcome: "answered";
  itemId: string;
  claimId: string;
  resume: ResumeId;
  pair: string | null;
  class: ClaimKind;
  claimClass: "selection" | "output";
  status: "accepted" | "review";
  selectivity: number | null;
  poolStrength: number | null;
  difficulty: number | null;
  scale: number | null;
  role: string | null;
  claimValue: number;
  observedAt: string;
  reviewReasons: string[];
  respondedModel: string;
}

interface FailedV12Row extends Stamp {
  outcome: "unavailable" | "invariant";
  itemId: string;
  claimId: string;
  resume: ResumeId;
  pair: string | null;
  respondedModel: null;
  error: string;
}

type V12Row = AnsweredV12Row | FailedV12Row;

export interface JobStats {
  jobs: number;
  hireClaims: number;
  oneEach: boolean;
  awardClaims: number;
  awardItems: string[];
  founders: number;
  fundingClaims: number;
  foundersWithoutFunding: number;
}

interface ResumeReport {
  resume: ResumeId;
  jobs: JobStats;
  rollup: PersonRollup | null;
}

export interface V12SmokeReport extends Stamp {
  personRollupHash: string;
  rows: V12Row[];
  calls: number;
  answered: number;
  unavailable: number;
  invariant: number;
  accepted: number;
  review: number;
  rejected: number;
  respondedModels: string[];
  resumes: ResumeReport[];
}

export interface V12JevClient {
  systemOne(request: ClaimRubricV12Request): {
    withResponse(): Promise<{ data: { model: string; answers: unknown } }>;
  };
}

interface Failure {
  outcome: "unavailable" | "invariant";
  error: string;
}

class Pending extends Error {
  readonly request: ClaimRubricV12Request;

  constructor(request: ClaimRubricV12Request) {
    super("pending");
    this.request = request;
  }
}

export function v12LiveQuestions(spec: CareerEvidenceV12Spec, request: ClaimRubricV12Request) {
  const bank = claimQuestionsV12(spec);
  const claimClass = "claim_class" in request.questions ? { claim_class: bank.claim_class } : {};
  if ("selectivity" in request.questions) {
    return { ...claimClass, selectivity: bank.selectivity, pool_strength: bank.pool_strength };
  }
  if ("difficulty" in request.questions) {
    return {
      ...claimClass,
      difficulty: bank.difficulty,
      scale: bank.scale,
      role: bank.role,
    };
  }
  return { claim_class: bank.claim_class };
}

export function liveV12Client(spec: CareerEvidenceV12Spec = CAREER_EVIDENCE_V1_2_0): V12JevClient {
  const client = createJevClient();
  return {
    systemOne(request) {
      const state = {
        source: request.state.source,
        text: request.state.text,
        selection_rate: request.state.selection_rate,
        selection_rate_upper_bound: request.state.selection_rate_upper_bound,
        selection_rate_source: request.state.selection_rate_source,
        title_hint: request.state.title_hint,
        ...("role_seed" in request.state ? { role_seed: request.state.role_seed } : {}),
      };
      return client.systemOne({ state, questions: v12LiveQuestions(spec, request) });
    },
  };
}

export function v12SpecFor(rubric: string | undefined): CareerEvidenceV12Spec {
  if (rubric === specId(CAREER_EVIDENCE_V1_2_1) || rubric === "CAREER_EVIDENCE_V1_2_1") {
    return CAREER_EVIDENCE_V1_2_1;
  }
  return CAREER_EVIDENCE_V1_2_0;
}

export async function runV12ClaimSmoke(
  items: readonly SmokeItem[],
  client: V12JevClient,
  spec: CareerEvidenceV12Spec = CAREER_EVIDENCE_V1_2_0,
): Promise<V12SmokeReport> {
  const stamped = stamp(spec);
  const rows: V12Row[] = [];
  const rollupClaims: RollupClaim[] = [];
  const resumes: ResumeReport[] = [];
  const respondedModels: string[] = [];
  let calls = 0;
  let answered = 0;
  let unavailable = 0;
  let invariant = 0;

  for (const resume of RESUMES) {
    const group = items.filter((item) => item.resume === resume);
    if (group.length === 0) continue;
    const scored = await scoreResume(resume, group, client, spec, stamped);
    rows.push(...scored.rows);
    rollupClaims.push(...scored.rollupClaims);
    calls += scored.calls;
    answered += scored.answered;
    unavailable += scored.unavailable;
    invariant += scored.invariant;
    for (const model of scored.models) {
      if (!respondedModels.includes(model)) respondedModels.push(model);
    }
    resumes.push({ resume, jobs: scored.jobs, rollup: null });
  }

  const rollups = personRollups({ claims: rollupClaims });
  for (const resume of resumes) {
    resume.rollup = rollups.get(resume.resume) ?? null;
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
    personRollupHash: personRollupHash(),
    rows,
    calls,
    answered,
    unavailable,
    invariant,
    accepted,
    review,
    rejected,
    respondedModels,
    resumes,
  };
}

export function renderV12Jsonl(report: V12SmokeReport): string {
  return `${report.rows
    .map((row) => {
      if (row.outcome !== "answered") return JSON.stringify(row);
      return JSON.stringify({
        outcome: row.outcome,
        rubricId: row.rubricId,
        rubricHash: row.rubricHash,
        configId: row.configId,
        configHash: row.configHash,
        itemId: row.itemId,
        claimId: row.claimId,
        resume: row.resume,
        pair: row.pair,
        class: row.class,
        claimClass: row.claimClass,
        status: row.status,
        selectivity: row.selectivity,
        poolStrength: row.poolStrength,
        difficulty: row.difficulty,
        scale: row.scale,
        role: row.role,
        claimValue: row.claimValue,
        observedAt: row.observedAt,
        reviewReasons: row.reviewReasons,
        respondedModel: row.respondedModel,
      });
    })
    .join("\n")}\n`;
}

export function renderV12Summary(report: V12SmokeReport): string {
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
    "## Jobs",
    "",
    ...JOB_PROSE,
    "",
    ...report.resumes.flatMap((resume) => jobLines(resume)),
    ...distribution("Pool strength", "level", LEVELS, poolCounts(report.rows)),
    ...distribution("Role", "role", ROLES, roleCounts(report.rows)),
    ...pairLines(report.rows),
    ...peopleLines(report),
    "## Failures",
    "",
  ];
  const failures = report.rows.filter((row) => row.outcome !== "answered");
  if (failures.length === 0) lines.push("None.");
  else {
    for (const row of failures) {
      const label = row.outcome === "unavailable" ? "judgment_unavailable" : "invariant";
      lines.push(`${row.itemId} ${row.claimId} ${label} ${row.error}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function scoreResume(
  resume: ResumeId,
  items: readonly SmokeItem[],
  client: V12JevClient,
  spec: CareerEvidenceV12Spec,
  stamped: Stamp,
): Promise<{
  rows: V12Row[];
  rollupClaims: RollupClaim[];
  jobs: JobStats;
  calls: number;
  answered: number;
  unavailable: number;
  invariant: number;
  models: string[];
}> {
  const lines = claimLines(items);
  const jobs = jobStats(lines);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const cache = new Map<string, { model: string; answers: unknown }>();
  const failures = new Map<string, Failure>();
  const failedText = new Map<string, Failure>();
  const modelByText = new Map<string, string>();
  const models: string[] = [];
  let calls = 0;
  let answered = 0;
  let unavailable = 0;
  let invariant = 0;
  let lastKey: string | null = null;

  const respond = (request: ClaimRubricV12Request): unknown => {
    const key = requestKey(request);
    lastKey = key;
    const failed = failures.get(key);
    if (failed) {
      if (!failedText.has(request.state.text)) failedText.set(request.state.text, failed);
      return dummyAnswer(request);
    }
    const hit = cache.get(key);
    if (hit === undefined) throw new Pending(request);
    return hit.answers;
  };

  const limit = Math.max(8, lines.length * 12);
  let claims: ScoredClaimV12[] | null = null;
  for (let round = 0; round < limit; round++) {
    lastKey = null;
    try {
      claims = scoreClaimRubricV12({ lines, source: "resume", respond }, spec);
      break;
    } catch (error) {
      if (error instanceof Pending) {
        const fetched = await fetchOne(client, error.request);
        calls += 1;
        if (fetched.kind === "ok") {
          cache.set(requestKey(error.request), fetched);
          modelByText.set(error.request.state.text, fetched.model);
          answered += 1;
          if (!models.includes(fetched.model)) models.push(fetched.model);
        } else {
          rememberFailure(requestKey(error.request), error.request.state.text, fetched.failure);
        }
        continue;
      }
      if (error instanceof JudgmentInvariantError && lastKey !== null && !failures.has(lastKey)) {
        if (cache.delete(lastKey)) answered -= 1;
        const text = textFromKey(lastKey);
        rememberFailure(lastKey, text, { outcome: "invariant", error: error.message });
        continue;
      }
      throw error;
    }
  }
  if (claims === null) throw new Error("claim smoke did not finish");

  const rows: V12Row[] = [];
  const rollupClaims: RollupClaim[] = [];
  for (const claim of claims) {
    const failure = failedText.get(claim.text);
    const located = locate(claim, itemsById);
    if (failure) {
      rows.push(failedRow(resume, located, claim.id, failure, stamped));
      continue;
    }
    const model = modelByText.get(claim.text);
    if (model === undefined) throw new Error(`claim ${claim.id} has no model`);
    const row = answeredRow(resume, located, claim, model, stamped);
    rows.push(row);
    rollupClaims.push({
      id: row.claimId,
      personId: resume,
      claimClass: row.claimClass,
      claimValue: row.claimValue,
      status: row.status,
      observedAt: new Date(row.observedAt),
    });
  }

  return { rows, rollupClaims, jobs, calls, answered, unavailable, invariant, models };

  function rememberFailure(key: string, text: string, failure: Failure): void {
    if (!failures.has(key)) {
      failures.set(key, failure);
      if (failure.outcome === "invariant") invariant += 1;
      else unavailable += 1;
    }
    if (!failedText.has(text)) failedText.set(text, failure);
  }
}

async function fetchOne(
  client: V12JevClient,
  request: ClaimRubricV12Request,
): Promise<{ kind: "ok"; model: string; answers: unknown } | { kind: "err"; failure: Failure }> {
  try {
    const { data } = await client.systemOne(request).withResponse();
    if (typeof data.model !== "string" || data.model.length === 0) {
      return {
        kind: "err",
        failure: { outcome: "invariant", error: "claim responded without a model" },
      };
    }
    return { kind: "ok", model: data.model, answers: data.answers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = error instanceof JudgmentInvariantError ? "invariant" : "unavailable";
    return { kind: "err", failure: { outcome, error: message } };
  }
}

function stamp(spec: CareerEvidenceV12Spec): Stamp {
  return {
    rubricId: specId(spec),
    rubricHash: careerEvidenceV12RubricHash(spec),
    configId: claimValueV12ConfigId(CLAIM_VALUE_V1_2_0),
    configHash: claimValueV12ConfigHash(CLAIM_VALUE_V1_2_0),
  };
}

interface OpenJobCount {
  founder: boolean;
  designated: number;
  funding: number;
  awardCount: number;
  awardItems: string[];
  ids: string[];
}

interface FundingClaim {
  id: string;
  parentId: string;
  title: string;
  org: string;
}

const JOB_PROSE = [
  "The 1.2.0 split yields one hire claim for each non-founder job.",
  "A founder job yields one funding claim, or none.",
] as const;

function claimLines(items: readonly SmokeItem[]): JobClaimLine[] {
  return items.map((item) => ({
    id: item.id,
    statement: item.statement,
    publishedAt: item.publishedAt,
  }));
}

function jobStats(lines: readonly JobClaimLine[]): JobStats {
  return tallySplitClaims(
    preprocessJobClaims(lines, { version: "1.2.0" }),
    lines.map((line) => line.id),
  );
}

export function renderV12Jobs(items: readonly SmokeItem[]): string {
  const lines = ["## Jobs", "", ...JOB_PROSE, ""];
  for (const resume of RESUMES) {
    const group = items.filter((item) => item.resume === resume);
    if (group.length === 0) continue;
    lines.push(`### ${resume}`, "", ...formatJobStats(jobStats(claimLines(group))), "");
  }
  return lines.join("\n");
}

export function v12JobCheckText(claims: readonly SplitClaim[], itemIds: readonly string[]): string {
  return formatJobStats(tallySplitClaims(claims, itemIds)).join("\n");
}

function tallySplitClaims(claims: readonly SplitClaim[], itemIds: readonly string[]): JobStats {
  const known = new Set(itemIds);
  const jobs = new Map<string, OpenJobCount>();
  const funding: FundingClaim[] = [];
  for (const claim of claims) {
    if (!("founder" in claim)) {
      if (claim.facts.selections.length === 0) continue;
      const job = openJob(jobs, `bare\0${claim.id}`);
      job.designated += 1;
      continue;
    }
    if (claim.id.endsWith("#funding")) {
      funding.push({
        id: claim.id,
        parentId: claim.parentId,
        title: claim.title,
        org: claim.org,
      });
      continue;
    }
    const job = openJob(jobs, jobGroupKey(claim.title, claim.org, claim.startedAt));
    job.founder = job.founder || claim.founder;
    job.ids.push(claim.id, claim.parentId);
    if (claim.id.endsWith("#hire")) job.designated += 1;
    else if (claim.claimClass === "selection") noteAward(job, smokeItemId(claim.id, known));
  }
  for (const claim of funding) {
    const titleKey = jobGroupKey(claim.title, claim.org, null);
    const matches = [...jobs.values()].filter(
      (job) =>
        job.founder &&
        job.ids.some((id) => id === claim.parentId || id.startsWith(`${claim.parentId}#`)),
    );
    const job = matches[0] ?? openJob(jobs, titleKey);
    job.founder = true;
    job.designated += 1;
    job.funding += 1;
    job.ids.push(claim.id, claim.parentId);
  }
  return finishJobs(jobs.values());
}

function openJob(jobs: Map<string, OpenJobCount>, key: string): OpenJobCount {
  const existing = jobs.get(key);
  if (existing) return existing;
  const created: OpenJobCount = {
    founder: false,
    designated: 0,
    funding: 0,
    awardCount: 0,
    awardItems: [],
    ids: [],
  };
  jobs.set(key, created);
  return created;
}

function noteAward(job: OpenJobCount, itemId: string): void {
  job.awardCount += 1;
  if (!job.awardItems.includes(itemId)) job.awardItems.push(itemId);
}

function smokeItemId(claimId: string, itemIds: ReadonlySet<string>): string {
  let current = claimId;
  while (current.length > 0) {
    if (itemIds.has(current)) return current;
    const index = current.lastIndexOf("#");
    if (index <= 0) break;
    current = current.slice(0, index);
  }
  return claimId;
}

function finishJobs(jobs: Iterable<OpenJobCount>): JobStats {
  let hireClaims = 0;
  let founders = 0;
  let fundingClaims = 0;
  let foundersWithoutFunding = 0;
  let awardClaims = 0;
  const awardItems: string[] = [];
  let oneEach = true;
  let count = 0;
  for (const job of jobs) {
    count += 1;
    hireClaims += job.designated;
    awardClaims += job.awardCount;
    for (const itemId of job.awardItems) {
      if (!awardItems.includes(itemId)) awardItems.push(itemId);
    }
    if (job.designated !== 1) oneEach = false;
    if (!job.founder) continue;
    founders += 1;
    fundingClaims += job.funding;
    if (job.funding === 0) foundersWithoutFunding += 1;
  }
  return {
    jobs: count,
    hireClaims,
    oneEach,
    awardClaims,
    awardItems,
    founders,
    fundingClaims,
    foundersWithoutFunding,
  };
}

function formatJobStats(stats: JobStats): string[] {
  const awards =
    stats.awardClaims === 0
      ? "Award claims 0."
      : `Award claims ${stats.awardClaims}: ${stats.awardItems.join(", ")}.`;
  return [
    `Jobs ${stats.jobs}. Hire claims ${stats.hireClaims}. One hire claim per job: ${stats.oneEach ? "yes" : "no"}.`,
    awards,
    `Founders ${stats.founders}. Funding claims ${stats.fundingClaims}. Founders with no funding claim: ${stats.foundersWithoutFunding}.`,
  ];
}

function jobGroupKey(title: string, org: string, startedAt: string | null): string {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return `${norm(title)}\0${norm(org)}\0${startedAt ?? ""}`;
}

function requestKey(request: ClaimRubricV12Request): string {
  const kind = Object.keys(request.questions).sort().join(",");
  return `${kind}\0${JSON.stringify(request.state)}`;
}

function textFromKey(key: string): string {
  const split = key.indexOf("\0");
  if (split < 0) return key;
  try {
    const state = JSON.parse(key.slice(split + 1)) as { text?: unknown };
    return typeof state.text === "string" ? state.text : key;
  } catch {
    return key;
  }
}

function dummyAnswer(request: ClaimRubricV12Request): unknown {
  if (!("selectivity" in request.questions) && !("difficulty" in request.questions)) {
    return { claim_class: classBlock("output") };
  }
  if ("selectivity" in request.questions) {
    return {
      claim_class: classBlock("selection"),
      selectivity: pointLevel(0),
      pool_strength: pointLevel(0),
    };
  }
  return {
    claim_class: classBlock("output"),
    difficulty: pointLevel(0),
    scale: pointLevel(0),
    role: {
      choice: "major_contributor",
      confidence: 1,
      probabilities: {
        original_author: 0,
        major_contributor: 1,
        maintainer: 0,
        minor_part: 0,
      },
    },
  };
}

function pointLevel(score: number) {
  return {
    score,
    confidence: 1,
    probabilities: {
      0: score === 0 ? 1 : 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    },
  };
}

function classBlock(choice: "selection" | "output") {
  return {
    choice,
    confidence: 1,
    probabilities: {
      selection: choice === "selection" ? 1 : 0,
      output: choice === "output" ? 1 : 0,
      both: 0,
    },
  };
}

function locate(
  claim: ScoredClaimV12,
  items: ReadonlyMap<string, SmokeItem>,
): { itemId: string; pair: string | null; publishedAt: string | null } {
  const itemId = stemItem(claim.id, items) ?? stemItem(claim.parentId, items) ?? claim.parentId;
  const item = items.get(itemId);
  return {
    itemId,
    pair: item?.pair ?? null,
    publishedAt: item?.publishedAt ?? null,
  };
}

function stemItem(id: string, items: ReadonlyMap<string, SmokeItem>): string | null {
  let current = id;
  while (current.length > 0) {
    if (items.has(current)) return current;
    const index = current.lastIndexOf("#");
    if (index <= 0) return null;
    current = current.slice(0, index);
  }
  return null;
}

function answeredRow(
  resume: ResumeId,
  located: { itemId: string; pair: string | null; publishedAt: string | null },
  claim: ScoredClaimV12,
  model: string,
  stamped: Stamp,
): AnsweredV12Row {
  const value =
    claim.claimClass === "selection"
      ? scoreClaimValueV12(
          {
            claimClass: "selection",
            selectivity: claim.selectivity,
            pool_strength: claim.pool_strength,
            companyEvidence: claim.companyEvidence,
          },
          BACKING_TIER,
        )
      : scoreClaimValueV12(
          {
            claimClass: "output",
            difficulty: claim.difficulty,
            scale: claim.scale,
            role: claim.role,
          },
          BACKING_TIER,
        );
  return {
    outcome: "answered",
    ...stamped,
    itemId: located.itemId,
    claimId: claim.id,
    resume,
    pair: located.pair,
    class: claim.id.endsWith("#funding") ? "funding" : claim.claimClass,
    claimClass: claim.claimClass,
    status: claim.status,
    selectivity: claim.claimClass === "selection" ? claim.selectivity.score : null,
    poolStrength: claim.claimClass === "selection" ? claim.pool_strength.score : null,
    difficulty: claim.claimClass === "output" ? claim.difficulty.score : null,
    scale: claim.claimClass === "output" ? claim.scale.score : null,
    role: claim.claimClass === "output" ? claim.role.choice : null,
    claimValue: value.claimValue,
    observedAt: observedInstant(claim, located.publishedAt),
    reviewReasons: claim.reviewReasons,
    respondedModel: model,
  };
}

function failedRow(
  resume: ResumeId,
  located: { itemId: string; pair: string | null },
  claimId: string,
  failure: Failure,
  stamped: Stamp,
): FailedV12Row {
  return {
    outcome: failure.outcome,
    ...stamped,
    itemId: located.itemId,
    claimId,
    resume,
    pair: located.pair,
    respondedModel: null,
    error: failure.error,
  };
}

function observedInstant(claim: ScoredClaimV12, publishedAt: string | null): string {
  const iso = observedAtForJobClaim(claim.claimClass, claim.jobDates);
  if (iso !== null) return `${iso}T00:00:00.000Z`;
  if (publishedAt !== null) return new Date(publishedAt).toISOString();
  throw new Error(`claim ${claim.id} has no observed date`);
}

const TABLE_HEADER = [
  "itemId",
  "claimId",
  "resume",
  "class",
  "status",
  "selectivity",
  "pool_strength",
  "difficulty",
  "scale",
  "role",
  "claimValue",
  "reasons",
];

function tableRow(row: V12Row): string {
  if (row.outcome !== "answered") {
    const cells = [
      row.itemId,
      row.claimId,
      row.resume,
      "n/a",
      row.outcome,
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      row.error,
    ];
    return `| ${cells.join(" | ")} |`;
  }
  const cells = [
    row.itemId,
    row.claimId,
    row.resume,
    row.class,
    row.status,
    fmt(row.selectivity),
    fmt(row.poolStrength),
    fmt(row.difficulty),
    fmt(row.scale),
    row.role ?? "n/a",
    fmt(row.claimValue),
    row.reviewReasons.join(",") || "none",
  ];
  return `| ${cells.join(" | ")} |`;
}

function jobLines(resume: ResumeReport): string[] {
  return [`### ${resume.resume}`, "", ...formatJobStats(resume.jobs), ""];
}

function distribution(
  title: string,
  column: string,
  labels: readonly string[],
  counts: ReadonlyMap<string, number>,
): string[] {
  return [
    `## ${title}`,
    "",
    `| ${column} | claims |`,
    "| --- | --- |",
    ...labels.map((label) => `| ${label} | ${counts.get(label) ?? 0} |`),
    "",
  ];
}

function poolCounts(rows: readonly V12Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.outcome !== "answered" || row.poolStrength === null) continue;
    const level = String(Math.min(4, Math.max(0, Math.round(row.poolStrength))));
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return counts;
}

function roleCounts(rows: readonly V12Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.outcome !== "answered" || row.role === null) continue;
    counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  }
  return counts;
}

function pairLines(rows: readonly V12Row[]): string[] {
  const order: string[] = [];
  const groups = new Map<string, { A: V12Row[]; B: V12Row[] }>();
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
    for (const dimension of PAIR_DIMENSIONS) {
      const delta = maxAbsExpected(group.A, group.B, dimension);
      lines.push(`${dimension} ${delta === null ? "n/a" : fmt(delta)}`);
    }
    lines.push("");
  }
  return lines;
}

function maxAbsExpected(
  left: readonly V12Row[],
  right: readonly V12Row[],
  dimension: PairDimension,
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

function expectedLevels(rows: readonly V12Row[], dimension: PairDimension): number[] {
  const levels: number[] = [];
  for (const row of rows) {
    if (row.outcome !== "answered") continue;
    const level =
      dimension === "selectivity"
        ? row.selectivity
        : dimension === "pool_strength"
          ? row.poolStrength
          : dimension === "difficulty"
            ? row.difficulty
            : row.scale;
    if (level !== null) levels.push(level);
  }
  return levels;
}

function peopleLines(report: V12SmokeReport): string[] {
  const lines = ["## People", "", `Person rollup hash ${report.personRollupHash}.`, ""];
  for (const resume of report.resumes) {
    lines.push(`### ${resume.resume}`, "");
    const row = resume.rollup;
    if (row === null) {
      lines.push("No scored claims.", "");
      continue;
    }
    lines.push(
      `Consensus ${fmt(row.consensus)}.`,
      `Substance ${row.substance === null ? "none" : fmt(row.substance)}.`,
      `Value ${row.value === null ? "none" : fmt(row.value)}.`,
      `${alphaText(row.alpha)}.`,
      `person_rollup ${row.personRollupHash}.`,
      "",
    );
  }
  return lines;
}

function alphaText(alpha: PersonAlpha): string {
  if (alpha.state === "not_enough_cohort") {
    return `Alpha not_enough_cohort cohort ${alpha.cohortSize} minimum ${alpha.minCohortSize}`;
  }
  if (alpha.state === "no_output_evidence") return "Alpha no_output_evidence";
  return `Alpha ${fmt(alpha.percentile)} residual ${fmt(alpha.residual)}`;
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}
