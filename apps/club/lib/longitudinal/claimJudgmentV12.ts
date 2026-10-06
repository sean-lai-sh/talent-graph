/**
 * The minimal `career_evidence` 1.2 claim-judgment path (SEA-81, taken from
 * SEA-40): score claim lines with `scoreClaimRubricV12` and write one
 * `JevJudgmentRecord` per claim, in the shape `outputOnlyRollup` reads.
 *
 * Separate from `createJevJudgmentService` (`./jev.ts`), which asks the 1.0
 * questions and writes 1.0 records that `outputOnlyRollup` rejects.
 *
 * `scoreClaimRubricV12` is synchronous and asks through a `respond` callback.
 * A request with no answer yet throws `Pending`; the loop fetches that one
 * answer and runs the scorer again, as `scripts/jev-claim-smoke-v12.ts` does.
 * Answers already stored for this person seed the cache, so evidence that
 * already has a record costs no call.
 */

import type {
  APIPromise,
  Questions,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";
import type { JobClaimLine, JobDateFields } from "../../../../src/longitudinal/claimPreprocess.ts";
import {
  type ClaimRubricV12Request,
  type ScoredClaimV12,
  scoreClaimRubricV12,
} from "../../../../src/longitudinal/claimRubricV12.ts";
import {
  CLAIM_VALUE_V1_2_0,
  claimValueV12ConfigHash,
  type EvidenceTier,
} from "../../../../src/longitudinal/claimValue.ts";
import { companySeedHash } from "../../../../src/longitudinal/companySeed.ts";
import type { OutputOnlyClaim } from "../../../../src/longitudinal/outputOnly.ts";
import { contentFingerprint } from "../../../../src/longitudinal/provenance.ts";
import { finite, unit } from "../../../../src/longitudinal/ranges.ts";
import {
  evidenceKeyFor,
  type JevAnswer,
  type JevJudgmentRecord,
  JudgmentInvariantError,
  recordIdFor,
  requestFingerprint,
} from "../../../../src/longitudinal/records.ts";
import { freezeRecord } from "../../../../src/longitudinal/store.ts";
import type {
  ClaimAuthor,
  GrokEvidenceItem,
  SourceKind,
} from "../../../../src/longitudinal/types.ts";
import { validateClaimAuthor } from "../../../../src/longitudinal/validate.ts";
import {
  CAREER_EVIDENCE_V1_2_4,
  careerEvidenceV12SpecId,
} from "../../../../src/models/careerEvidenceV12.ts";
import type { CareerEvidenceV12Spec } from "../../../../src/models/spec.ts";
import { claimQuestionsV12, type JevClaimQuestionsV12 } from "./jevClient.ts";
import { rawScoreAnswer } from "./jevRecord.ts";

/** The rubric new claim records are judged under. */
export const CLAIM_JUDGMENT_SPEC: CareerEvidenceV12Spec = CAREER_EVIDENCE_V1_2_4;

/**
 * The client surface the 1.2 path calls: one `systemOne` over any subset of
 * the 1.2 claim questions. `createJevClient()` satisfies it. It is its own
 * port rather than a third overload on `JevClient`, whose test doubles are
 * typed against exactly the two 1.0 overloads.
 */
export interface JevClaimClientV12 {
  systemOne<Q extends Questions & Partial<JevClaimQuestionsV12>>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Pick<APIPromise<SystemOneResult<Q>>, "withResponse">;
}

/** One answer as it came back, so a later run can replay the request from storage. */
export interface StoredAnswer {
  requestFingerprint: string;
  respondedModel: string;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number };
  /** The SDK's `answers`, verbatim. */
  answers: unknown;
  observedAt: string;
}

/** What is stored per claim: the record, the claim that reads it, and the answers behind it. */
export interface ClaimJudgment {
  record: JevJudgmentRecord;
  claim: OutputOnlyClaim;
  /** The scoring answer the record was written from. */
  answer: StoredAnswer;
  /** The class probe asked first for a claim with no job header, or null. */
  probe: StoredAnswer | null;
  /** `claim_value@1.2.0` config hash, company seed included, at scoring time. */
  configHash: string;
  companySeedHash: string;
}

export interface ClaimEvidence {
  lines: readonly JobClaimLine[];
  source: SourceKind;
  author: ClaimAuthor;
  evidenceTier: EvidenceTier;
  /**
   * The evidence item a scored claim is about, for its evidence key. The
   * caller knows the source's identity and date rules (resume line, GitHub
   * artifact); this module does not.
   */
  evidenceItemFor(claim: ScoredClaimV12, line: JobClaimLine): GrokEvidenceItem;
  /** The claim's job dates, when the source dates it differently from the line. */
  jobDatesFor?(claim: ScoredClaimV12, line: JobClaimLine): JobDateFields;
}

export interface ClaimJudgmentRun {
  /** Records for evidence keys with no stored record yet. */
  written: ClaimJudgment[];
  /** Evidence keys skipped because a record already exists. */
  skipped: number;
  /** Claims dropped because their answer broke an invariant. */
  failed: { claimId: string; error: string }[];
  calls: number;
}

class Pending extends Error {
  readonly request: ClaimRubricV12Request;
  readonly fingerprint: string;

  constructor(request: ClaimRubricV12Request, fingerprint: string) {
    super("pending");
    this.request = request;
    this.fingerprint = fingerprint;
  }
}

/** The state the model is shown: exactly the fields the smoke sends. */
function wireState(request: ClaimRubricV12Request) {
  return {
    source: request.state.source,
    text: request.state.text,
    selection_rate: request.state.selection_rate,
    selection_rate_upper_bound: request.state.selection_rate_upper_bound,
    selection_rate_source: request.state.selection_rate_source,
    title_hint: request.state.title_hint,
    ...("role_seed" in request.state ? { role_seed: request.state.role_seed } : {}),
    ...(request.state.company_context ? { company_context: request.state.company_context } : {}),
  };
}

/** The SDK questions for one rubric request, built from the spec. */
function wireQuestions(
  spec: CareerEvidenceV12Spec,
  request: ClaimRubricV12Request,
): Partial<JevClaimQuestionsV12> {
  const bank = claimQuestionsV12(spec, "company_context" in request.state);
  const claimClass = "claim_class" in request.questions ? { claim_class: bank.claim_class } : {};
  if ("selectivity" in request.questions) {
    return { ...claimClass, selectivity: bank.selectivity, pool_strength: bank.pool_strength };
  }
  if ("difficulty" in request.questions) {
    return { ...claimClass, difficulty: bank.difficulty, scale: bank.scale, role: bank.role };
  }
  return { claim_class: bank.claim_class };
}

function isProbe(request: ClaimRubricV12Request): boolean {
  return !("selectivity" in request.questions) && !("difficulty" in request.questions);
}

/**
 * Score `evidence.lines` and return a record for every claim whose evidence
 * key has none yet. `known` is this person's stored judgments: their answers
 * are replayed rather than asked again, and their evidence keys are skipped.
 */
export async function judgeClaimsV12(input: {
  personId: string;
  evidence: ClaimEvidence;
  known: readonly ClaimJudgment[];
  client: JevClaimClientV12;
  spec?: CareerEvidenceV12Spec;
  now?: () => Date;
}): Promise<ClaimJudgmentRun> {
  const spec = input.spec ?? CLAIM_JUDGMENT_SPEC;
  const now = input.now ?? (() => new Date());
  const specId = careerEvidenceV12SpecId(spec);
  const { evidence } = input;

  const cache = new Map<string, StoredAnswer>();
  const knownKeys = new Set<string>();
  for (const judgment of input.known) {
    if (judgment.record.specId !== specId) continue;
    knownKeys.add(judgment.record.evidenceKey);
    cache.set(judgment.answer.requestFingerprint, judgment.answer);
    if (judgment.probe) cache.set(judgment.probe.requestFingerprint, judgment.probe);
  }
  const failures = new Map<string, string>();
  let sequence: { fingerprint: string; probe: boolean }[] = [];
  let lastFingerprint: string | null = null;

  const respond = (request: ClaimRubricV12Request): unknown => {
    const fingerprint = requestFingerprint({
      state: wireState(request),
      questions: wireQuestions(spec, request),
      specId,
    });
    lastFingerprint = fingerprint;
    sequence.push({ fingerprint, probe: isProbe(request) });
    if (failures.has(fingerprint)) return placeholderAnswer(request);
    const hit = cache.get(fingerprint);
    if (hit === undefined) throw new Pending(request, fingerprint);
    return hit.answers;
  };

  let calls = 0;
  let scored: ScoredClaimV12[] | null = null;
  const limit = Math.max(8, evidence.lines.length * 12);
  for (let round = 0; round < limit && scored === null; round++) {
    sequence = [];
    lastFingerprint = null;
    try {
      scored = scoreClaimRubricV12(
        { lines: evidence.lines, source: evidence.source, respond },
        spec,
      );
    } catch (error) {
      if (error instanceof Pending) {
        calls += 1;
        const { data, requestId } = await input.client
          .systemOne({
            state: wireState(error.request),
            questions: wireQuestions(spec, error.request),
          })
          .withResponse();
        if (typeof data.model !== "string" || data.model.length === 0) {
          failures.set(error.fingerprint, "claim responded without a model");
          continue;
        }
        cache.set(error.fingerprint, {
          requestFingerprint: error.fingerprint,
          respondedModel: data.model,
          requestId: requestId ?? null,
          usage: {
            inputTokens: finite(data.usage?.input_tokens, "jev: usage.input_tokens"),
            outputTokens: finite(data.usage?.output_tokens, "jev: usage.output_tokens"),
          },
          answers: data.answers,
          observedAt: now().toISOString(),
        });
        continue;
      }
      // An answer the rubric cannot read: drop that request's claims, keep the rest.
      if (
        error instanceof JudgmentInvariantError &&
        lastFingerprint !== null &&
        !failures.has(lastFingerprint)
      ) {
        cache.delete(lastFingerprint);
        failures.set(lastFingerprint, error.message);
        continue;
      }
      throw error;
    }
  }
  if (scored === null) throw new Error("claim judgment did not finish");

  const scoring = sequence.filter((entry) => !entry.probe);
  if (scoring.length !== scored.length) {
    throw new JudgmentInvariantError(
      `claim judgment: ${scored.length} claims from ${scoring.length} scoring requests`,
    );
  }
  const lineById = new Map(evidence.lines.map((line) => [line.id, line]));
  const configHash = claimValueV12ConfigHash(CLAIM_VALUE_V1_2_0);
  const seedHash = companySeedHash();
  const run: ClaimJudgmentRun = { written: [], skipped: 0, failed: [], calls };
  const seen = new Set<string>();
  let probeIndex = -1;
  let scoringIndex = 0;
  for (let index = 0; index < sequence.length; index++) {
    const entry = sequence[index];
    if (entry === undefined) continue;
    if (entry.probe) {
      probeIndex = index;
      continue;
    }
    const claim = scored[scoringIndex];
    scoringIndex += 1;
    if (claim === undefined) continue;
    // A claim under a job header is asked once; a free line is probed for its class first.
    const probeFingerprint =
      claim.titleHint === null && probeIndex >= 0 ? sequence[probeIndex]?.fingerprint : undefined;
    const failure =
      failures.get(entry.fingerprint) ??
      (probeFingerprint === undefined ? undefined : failures.get(probeFingerprint));
    if (failure !== undefined) {
      run.failed.push({ claimId: claim.id, error: failure });
      continue;
    }
    const line = lineFor(claim, lineById);
    const item = evidence.evidenceItemFor(claim, line);
    const evidenceKey = evidenceKeyFor(input.personId, item);
    if (knownKeys.has(evidenceKey) || seen.has(evidenceKey)) {
      run.skipped += 1;
      continue;
    }
    seen.add(evidenceKey);
    const answer = cache.get(entry.fingerprint);
    if (answer === undefined) throw new Error(`claim ${claim.id} has no answer`);
    const probe = probeFingerprint === undefined ? null : (cache.get(probeFingerprint) ?? null);
    const record = freezeRecord({
      id: recordIdFor(entry.fingerprint, evidenceKey),
      kind: "claim",
      personId: input.personId,
      evidenceKey,
      requestFingerprint: entry.fingerprint,
      specId,
      requestedModel: spec.model,
      respondedModel: answer.respondedModel,
      requestId: answer.requestId,
      answers: recordAnswers(spec, answer.answers),
      usage: answer.usage,
      observedAt: answer.observedAt,
    });
    const outputClaim: OutputOnlyClaim = {
      // One claim per evidence key, so the same line in a later resume version is the same claim.
      id: `claim-${contentFingerprint(evidenceKey).slice(0, 24)}`,
      personId: input.personId,
      recordId: record.id,
      claimClass: claim.claimClass,
      status: claim.status,
      source: evidence.source,
      author: evidence.author,
      evidenceTier: evidence.evidenceTier,
      jobDates: evidence.jobDatesFor?.(claim, line) ?? claim.jobDates,
      companyEvidence: claim.claimClass === "selection" ? claim.companyEvidence : null,
    };
    const author = validateClaimAuthor({ author: outputClaim.author, source: outputClaim.source });
    if (!author.ok) {
      throw new JudgmentInvariantError(`claim ${claim.id}: ${author.errors.join("; ")}`);
    }
    run.written.push({
      record,
      claim: outputClaim,
      answer,
      probe,
      configHash,
      companySeedHash: seedHash,
    });
  }
  return run;
}

/** The line a scored claim came from: its parent, or the parent's first physical line. */
function lineFor(claim: ScoredClaimV12, lines: ReadonlyMap<string, JobClaimLine>): JobClaimLine {
  let id = claim.parentId;
  while (id.length > 0) {
    const line = lines.get(id);
    if (line) return line;
    const cut = id.lastIndexOf("#");
    if (cut <= 0) break;
    id = id.slice(0, cut);
  }
  throw new JudgmentInvariantError(`claim ${claim.id} names no input line (${claim.parentId})`);
}

const SCORE_KEYS = ["selectivity", "pool_strength", "difficulty", "scale"] as const;
const CHOICE_KEYS = ["claim_class", "role"] as const;

/**
 * The SDK answers as record answers, whole: score answers keep their
 * un-rounded score, the five-level probability vector and the legend, read
 * off the spec's levels; choice answers keep the full probability map.
 */
function recordAnswers(spec: CareerEvidenceV12Spec, raw: unknown): Record<string, JevAnswer> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new JudgmentInvariantError("jev: claim answers must be an object");
  }
  const answers = raw as Record<string, unknown>;
  const out: Record<string, JevAnswer> = {};
  for (const key of SCORE_KEYS) {
    const answer = answers[key];
    if (answer === undefined) continue;
    out[key] = rawScoreAnswer(
      answer as Parameters<typeof rawScoreAnswer>[0],
      spec[key].levels,
      key,
    );
  }
  for (const key of CHOICE_KEYS) {
    const answer = answers[key] as
      | { choice?: unknown; confidence?: unknown; probabilities?: unknown }
      | undefined;
    if (answer === undefined) continue;
    if (typeof answer.choice !== "string" || answer.probabilities === null) {
      throw new JudgmentInvariantError(`jev: ${key} must be a choice answer`);
    }
    const probabilities = answer.probabilities as Record<string, unknown>;
    out[key] = {
      choice: answer.choice,
      confidence: unit(answer.confidence, `jev: ${key}.confidence`),
      probabilities: Object.fromEntries(
        Object.entries(probabilities).map(([label, value]) => [
          label,
          unit(value, `jev: ${key}.probabilities.${label}`),
        ]),
      ),
    };
  }
  return out;
}

/** Keeps the scorer moving past a request whose answer broke; that claim is dropped. */
function placeholderAnswer(request: ClaimRubricV12Request): unknown {
  const level = {
    score: 0,
    confidence: 1,
    probabilities: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0 },
  };
  const claimClass = (choice: "selection" | "output") => ({
    choice,
    confidence: 1,
    probabilities: {
      selection: choice === "selection" ? 1 : 0,
      output: choice === "output" ? 1 : 0,
      both: 0,
    },
  });
  if (isProbe(request)) return { claim_class: claimClass("output") };
  if ("selectivity" in request.questions) {
    return { claim_class: claimClass("selection"), selectivity: level, pool_strength: level };
  }
  return {
    claim_class: claimClass("output"),
    difficulty: level,
    scale: level,
    role: {
      choice: "major_contributor",
      confidence: 1,
      probabilities: { original_author: 0, major_contributor: 1, maintainer: 0, minor_part: 0 },
    },
  };
}
