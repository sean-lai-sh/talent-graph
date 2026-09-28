import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JevClient } from "../apps/club/lib/longitudinal/jev.ts";
import { claimQuestionsFor } from "../apps/club/lib/longitudinal/jevClient.ts";
import {
  liveJudgmentService,
  main,
  parseSmokeItems,
  renderJsonl,
  renderSummary,
  runClaimSmoke,
  type SmokeItem,
  SOURCE_URL_PLACEHOLDER,
  toEvidence,
  UNLINKED_PERSON_ID,
} from "../scripts/jev-claim-smoke.ts";
import { runV11ClaimSmoke, type V11JevClient } from "../scripts/jev-claim-smoke-v11.ts";
import type {
  ClaimAssessment,
  JevJudgment,
  JevJudgmentService,
} from "../src/longitudinal/judgments.ts";
import { DEFAULT_EVIDENCE_CONCURRENCY } from "../src/longitudinal/policy.ts";
import { contentFingerprint } from "../src/longitudinal/provenance.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import { decideStatus } from "../src/longitudinal/stages.ts";
import type {
  CareerEvidenceDimension,
  DimensionJudgment,
  GrokEvidenceItem,
} from "../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0, careerEvidenceRubricHash } from "../src/models/careerEvidence.ts";
import { specId } from "../src/models/spec.ts";
import { claimAnswers, fakeRecord } from "./helpers/longitudinal.ts";

const fixturePath = join(import.meta.dir, "fixtures/jev-claim-smoke.items.json");

const PASSED_GATE = {
  decision: "same" as const,
  confidence: 1,
  fieldMatches: { name: 1, affiliation: 1, handle: 1 },
};

function dimension(
  name: CareerEvidenceDimension,
  score: number,
  probabilities: number[],
  confidence: number,
): DimensionJudgment {
  return { dimension: name, score, probabilities, confidence };
}

function assessment(
  eventKind: ClaimAssessment["eventKind"],
  eventConfidence: number,
  scored: Pick<DimensionJudgment, "dimension" | "score" | "probabilities" | "confidence">[],
): ClaimAssessment {
  const byName = new Map(scored.map((entry) => [entry.dimension, entry]));
  const dimensions = (
    ["difficulty", "ownership", "external_impact", "originality", "peer_validation"] as const
  ).map((name) => {
    const found = byName.get(name);
    return found ?? dimension(name, 2, [0, 0, 1, 0, 0], 1);
  });
  return { eventKind, eventConfidence, dimensions };
}

const alphaA = assessment("shipped_product", 0.9, [
  dimension("difficulty", 3, [0, 0, 0.1, 0.8, 0.1], 0.8),
  dimension("external_impact", 2, [0, 0, 1, 0, 0], 1),
  dimension("peer_validation", 1, [0.1, 0.7, 0.2, 0, 0], 0.8),
]);

const alphaB = assessment("shipped_product", 0.5, [
  dimension("difficulty", 2, [0, 0.2, 0.6, 0.2, 0], 0.7),
  dimension("external_impact", 2, [0, 0, 1, 0, 0], 1),
  dimension("peer_validation", 4, [0, 0, 0, 0.1, 0.9], 0.9),
]);

const solo = assessment(null, 0.99, [
  dimension("difficulty", 1.5, [0.1, 0.4, 0.4, 0.05, 0.05], 0.6),
]);

const eventProbabilities: Record<string, Record<string, number>> = {
  "a-alpha": { shipped_product: 0.7, research_output: 0.2, grant_or_award: 0.1 },
  "b-alpha": { shipped_product: 0.55, open_source_contribution: 0.4 },
  "a-solo": { no_supported_event: 0.8, shipped_product: 0.2 },
};

const assessments: Record<string, ClaimAssessment> = {
  "a-alpha": alphaA,
  "b-alpha": alphaB,
  "a-solo": solo,
};

function claimJudgment(
  evidence: GrokEvidenceItem,
  personId: string,
  itemAssessment: ClaimAssessment,
  probabilities: Record<string, number>,
): JevJudgment<ClaimAssessment> {
  const answers = claimAnswers(itemAssessment);
  answers.event_kind = {
    choice: itemAssessment.eventKind ?? "no_supported_event",
    confidence: itemAssessment.eventConfidence,
    probabilities,
  };
  return {
    assessment: itemAssessment,
    record: fakeRecord("claim", personId, evidence, answers),
  };
}

function stubService(onIdentity: () => void): {
  service: JevJudgmentService;
  seen: { personId: string; evidence: GrokEvidenceItem }[];
} {
  const seen: { personId: string; evidence: GrokEvidenceItem }[] = [];
  const service: JevJudgmentService = {
    identityFingerprint() {
      onIdentity();
      return "identity";
    },
    claimFingerprint(evidence) {
      return evidence.sourceId;
    },
    async assessIdentity() {
      onIdentity();
      throw new Error("identity was called");
    },
    async assessClaim(evidence, personId) {
      seen.push({ personId, evidence });
      const itemAssessment = assessments[evidence.sourceId];
      const probabilities = eventProbabilities[evidence.sourceId];
      if (itemAssessment === undefined || probabilities === undefined) {
        throw new Error(`unexpected item ${evidence.sourceId}`);
      }
      return claimJudgment(evidence, personId, itemAssessment, probabilities);
    },
  };
  return { service, seen };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "jev-claim-smoke-"));
}

test("the claim smoke reads the fixture, skips identity, and writes the cutoff table", async () => {
  let identityCalls = 0;
  const { service, seen } = stubService(() => {
    identityCalls += 1;
  });
  const dir = await tempDir();
  const jsonlPath = join(dir, "claims.jsonl");
  const summaryPath = join(dir, "summary.md");
  const code = await main(
    ["--items", fixturePath, "--jsonl", jsonlPath, "--summary", summaryPath],
    service,
  );
  expect(code).toBe(0);
  expect(identityCalls).toBe(0);
  expect(seen.map((call) => call.evidence.sourceId)).toEqual(["a-alpha", "b-alpha", "a-solo"]);
  expect(seen[0]).toEqual({
    personId: UNLINKED_PERSON_ID,
    evidence: {
      source: "resume",
      sourceId: "a-alpha",
      url: SOURCE_URL_PLACEHOLDER,
      publisher: "Example Lab",
      publishedAt: "2024-05-31T00:00:00.000Z",
      quotedText: "Example Role at Example Lab: synthetic bullet alpha",
      contentHash: contentFingerprint("Example Role at Example Lab: synthetic bullet alpha"),
      statement: "Example Role at Example Lab: synthetic bullet alpha",
      proposedEventKind: null,
    },
  });

  const summary = await readFile(summaryPath, "utf8");
  expect(summary).toContain(`Rubric ${specId(CAREER_EVIDENCE_V1_0_0)}.`);
  expect(summary).toContain(`Rubric hash ${careerEvidenceRubricHash(CAREER_EVIDENCE_V1_0_0)}.`);
  expect(summary).toContain(
    "Identity was not judged. Status is decideStatus after a passed identity gate, for reference only.",
  );
  expect(summary).toContain(
    `The source_url on every item is ${SOURCE_URL_PLACEHOLDER}. That URL is a placeholder.`,
  );
  expect(summary).toContain("Calls 3. Answered 3. judgment_unavailable 0. Invariant failures 0.");
  expect(summary).toContain("respondedModel jev-test.");
  expect(summary).toContain("Deltas are B minus A.");

  const accepted = decideStatus(PASSED_GATE, alphaA, CAREER_EVIDENCE_V1_0_0.thresholds);
  const review = decideStatus(PASSED_GATE, alphaB, CAREER_EVIDENCE_V1_0_0.thresholds);
  const rejected = decideStatus(PASSED_GATE, solo, CAREER_EVIDENCE_V1_0_0.thresholds);
  const lines = summary.split("\n");
  expect(lines.find((line) => line.startsWith("| a-alpha |"))).toBe(
    "| a-alpha | A | shipped_product | 0.9000 | shipped_product 0.7000, research_output 0.2000 | 3.0000 | 3 | 0.8000 | 0.0000,0.0000,0.1000,0.8000,0.1000 | 2.0000 | 2 | 1.0000 | 0.0000,0.0000,1.0000,0.0000,0.0000 | 1.0000 | 1 | 0.8000 | 0.1000,0.7000,0.2000,0.0000,0.0000 | accepted |  |",
  );
  expect(lines.find((line) => line.startsWith("| b-alpha |"))).toBe(
    "| b-alpha | B | shipped_product | 0.5000 | shipped_product 0.5500, open_source_contribution 0.4000 | 2.0000 | 2 | 0.7000 | 0.0000,0.2000,0.6000,0.2000,0.0000 | 2.0000 | 2 | 1.0000 | 0.0000,0.0000,1.0000,0.0000,0.0000 | 4.0000 | 4 | 0.9000 | 0.0000,0.0000,0.0000,0.1000,0.9000 | review | event_low_confidence |",
  );
  expect(lines.find((line) => line.startsWith("| a-solo |"))).toBe(
    "| a-solo | A | no_supported_event | 0.9900 | no_supported_event 0.8000, shipped_product 0.2000 | 1.5000 | 1 | 0.6000 | 0.1000,0.4000,0.4000,0.0500,0.0500 | 2.0000 | 2 | 1.0000 | 0.0000,0.0000,1.0000,0.0000,0.0000 | 2.0000 | 2 | 1.0000 | 0.0000,0.0000,1.0000,0.0000,0.0000 | rejected |  |",
  );
  expect(accepted).toEqual({ status: "accepted", reasons: [] });
  expect(review).toEqual({ status: "review", reasons: ["event_low_confidence"] });
  expect(rejected).toEqual({ status: "rejected", reasons: [] });

  const pairs = summary.split("## Identical pairs")[1]?.split("## Failures")[0] ?? "";
  expect(pairs).toContain("### alpha");
  expect(pairs).not.toContain("a-solo");
  expect(pairs).toContain("event_kind A shipped_product B shipped_product");
  expect(pairs).toContain("event_confidence A 0.9000 B 0.5000 delta -0.4000");
  expect(pairs).toContain("difficulty A 3.0000 B 2.0000 delta -1.0000");
  expect(pairs).toContain("external_impact A 2.0000 B 2.0000 delta 0.0000");
  expect(pairs).toContain("peer_validation A 1.0000 B 4.0000 delta 3.0000");
  expect(pairs).toContain("status A accepted B review");
  expect(summary).toContain("## Failures\n\nNone.");

  const header = lines.find((line) => line.startsWith("| id |"));
  const headerCells =
    header
      ?.split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()) ?? [];
  expect(headerCells).toEqual([
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
  ]);
  const tableLines = lines.filter((line) => line.startsWith("|"));
  expect(tableLines.every((line) => line.split("|").length === headerCells.length + 2)).toBe(true);

  const jsonl = (await readFile(jsonlPath, "utf8")).trim().split("\n");
  expect(jsonl).toHaveLength(3);
  const first = JSON.parse(jsonl[0] ?? "") as {
    rubricId: string;
    rubricHash: string;
    id: string;
    outcome: string;
    respondedModel: string;
    judgment: {
      record: { kind: string; respondedModel: string; answers: { event_kind: { choice: string } } };
    };
  };
  expect(first.rubricId).toBe(specId(CAREER_EVIDENCE_V1_0_0));
  expect(first.rubricHash).toBe(careerEvidenceRubricHash(CAREER_EVIDENCE_V1_0_0));
  expect(first.id).toBe("a-alpha");
  expect(first.outcome).toBe("answered");
  expect(first.respondedModel).toBe("jev-test");
  expect(first.judgment.record.kind).toBe("claim");
  expect(first.judgment.record.answers.event_kind.choice).toBe("shipped_product");
  expect(Object.keys(first).sort()).toEqual([
    "id",
    "judgment",
    "outcome",
    "pair",
    "respondedModel",
    "resume",
    "rubricHash",
    "rubricId",
  ]);
});

test("a transport failure is judgment_unavailable and an invariant failure exits 1", async () => {
  const dir = await tempDir();
  const itemsPath = join(dir, "items.json");
  const item: SmokeItem = {
    id: "a-down",
    resume: "A",
    org: "Example Lab",
    role: "Example Role",
    dates: "Jan 2024",
    statement: "Example Role at Example Lab: synthetic outage",
    pair: null,
    publishedAt: "2024-01-31T00:00:00.000Z",
  };
  await writeFile(itemsPath, JSON.stringify([item]));
  const unavailable: JevJudgmentService = {
    identityFingerprint: () => "identity",
    claimFingerprint: () => "claim",
    async assessIdentity() {
      throw new Error("identity was called");
    },
    async assessClaim() {
      throw new TypeError("socket hang up");
    },
  };
  const summaryPath = join(dir, "summary.md");
  const code = await main(
    ["--items", itemsPath, "--jsonl", join(dir, "claims.jsonl"), "--summary", summaryPath],
    unavailable,
  );
  expect(code).toBe(0);
  const summary = await readFile(summaryPath, "utf8");
  const missing = decideStatus(PASSED_GATE, null, CAREER_EVIDENCE_V1_0_0.thresholds);
  expect(missing).toEqual({ status: "review", reasons: ["judgment_unavailable"] });
  expect(summary).toContain("Calls 1. Answered 0. judgment_unavailable 1. Invariant failures 0.");
  expect(summary).toContain("respondedModel none.");
  expect(summary).toContain("| a-down | A |");
  expect(summary).toContain("| review | judgment_unavailable |");
  expect(summary).toContain("a-down judgment_unavailable socket hang up");

  const broken: JevJudgmentService = {
    identityFingerprint: () => "identity",
    claimFingerprint: () => "claim",
    async assessIdentity() {
      throw new Error("identity was called");
    },
    async assessClaim() {
      throw new JudgmentInvariantError("broken legend");
    },
  };
  const invariantSummary = join(dir, "invariant.md");
  const invariantCode = await main(
    ["--items", itemsPath, "--jsonl", join(dir, "invariant.jsonl"), "--summary", invariantSummary],
    broken,
  );
  expect(invariantCode).toBe(1);
  const invariantText = await readFile(invariantSummary, "utf8");
  expect(invariantText).toContain("Invariant failures 1.");
  expect(invariantText).toContain("| n/a | invariant |");
  expect(invariantText).toContain("a-down invariant broken legend");
});

test("at most the default concurrency is in flight", async () => {
  const count = DEFAULT_EVIDENCE_CONCURRENCY + 3;
  const items: SmokeItem[] = Array.from({ length: count }, (_unused, index) => ({
    id: `item-${index}`,
    resume: "A",
    org: "Example Lab",
    role: "Example Role",
    dates: "Jan 2024",
    statement: `Example Role at Example Lab: synthetic item ${index}`,
    pair: null,
    publishedAt: "2024-01-31T00:00:00.000Z",
  }));
  let active = 0;
  let max = 0;
  let calls = 0;
  const inner = stubService(() => {
    throw new Error("identity was called");
  }).service;
  const service: JevJudgmentService = {
    identityFingerprint: inner.identityFingerprint,
    claimFingerprint: inner.claimFingerprint,
    assessIdentity: inner.assessIdentity,
    async assessClaim(evidence, personId, options) {
      calls += 1;
      active += 1;
      max = Math.max(max, active);
      await Promise.resolve();
      try {
        const renamed = { ...evidence, sourceId: "a-alpha" };
        return await inner.assessClaim(renamed, personId, options);
      } finally {
        active -= 1;
      }
    },
  };
  const report = await runClaimSmoke(items, service);
  expect(calls).toBe(count);
  expect(max).toBe(DEFAULT_EVIDENCE_CONCURRENCY);
  expect(report.answered).toBe(count);
});

test("the items file is rejected when a field or a pair is wrong", () => {
  expect(() => parseSmokeItems({})).toThrow("items file must be a JSON array");
  expect(() => parseSmokeItems([{ id: "a-alpha" }])).toThrow('items[0].resume must be "A" or "B"');
  const valid = {
    id: "a-alpha",
    resume: "A",
    org: "Example Lab",
    role: "Example Role",
    dates: "Jan 2024",
    statement: "Example Role at Example Lab: synthetic",
    pair: "alpha",
    publishedAt: "2024-01-31T00:00:00.000Z",
  };
  expect(() => parseSmokeItems([valid, { ...valid, id: "b-alpha", resume: "A" }])).toThrow(
    "items[1].pair alpha is already used by resume A",
  );
  expect(() => parseSmokeItems([valid, { ...valid }])).toThrow("items[1].id duplicates a-alpha");
  expect(() => parseSmokeItems([{ ...valid, publishedAt: "yesterday" }])).toThrow(
    "items[0].publishedAt must be an instant",
  );
  expect(parseSmokeItems([])).toEqual([]);
});

test("a pair with one resume is reported missing", async () => {
  const dir = await tempDir();
  const itemsPath = join(dir, "items.json");
  await writeFile(
    itemsPath,
    JSON.stringify([
      {
        id: "a-alpha",
        resume: "A",
        org: "Example Lab",
        role: "Example Role",
        dates: "Jan 2024",
        statement: "Example Role at Example Lab: synthetic bullet alpha",
        pair: "alpha",
        publishedAt: "2024-05-31T00:00:00.000Z",
      },
    ]),
  );
  const { service } = stubService(() => {
    throw new Error("identity was called");
  });
  const summaryPath = join(dir, "summary.md");
  await main(
    ["--items", itemsPath, "--jsonl", join(dir, "claims.jsonl"), "--summary", summaryPath],
    service,
  );
  const summary = await readFile(summaryPath, "utf8");
  expect(summary).toContain("### alpha");
  expect(summary).toContain("resume B is missing");
});

test("main rejects a missing flag and an unknown rubric", async () => {
  await expect(main(["--items", "only.json"])).rejects.toThrow(
    "usage: bun run scripts/jev-claim-smoke.ts --items <path> (--jsonl <path> --summary <path> | --out <dir>) [--spec career_evidence@1.0.0] [--rubric career_evidence@1.0.0|career_evidence@1.1.0|career_evidence@1.2.0|career_evidence@1.2.1|career_evidence@1.2.2]",
  );
  await expect(
    main([
      "--items",
      "only.json",
      "--jsonl",
      "out.jsonl",
      "--summary",
      "out.md",
      "--spec",
      "career_evidence@9.9.9",
    ]),
  ).rejects.toThrow("unknown rubric career_evidence@9.9.9");
});

test("a passed spec stamps its id and hash and supplies the cutoff", async () => {
  const shifted = {
    ...CAREER_EVIDENCE_V1_0_0,
    version: "9.9.9",
    thresholds: { ...CAREER_EVIDENCE_V1_0_0.thresholds, eventConfidence: 0.99 },
  };
  const items = parseSmokeItems(JSON.parse(await readFile(fixturePath, "utf8")));
  const { service } = stubService(() => {
    throw new Error("identity was called");
  });
  const report = await runClaimSmoke(items, service, shifted);
  const summary = renderSummary(report);
  expect(summary).toContain("Rubric career_evidence@9.9.9.");
  expect(summary).toContain(`Rubric hash ${careerEvidenceRubricHash(shifted)}.`);
  expect(careerEvidenceRubricHash(shifted)).toBe(careerEvidenceRubricHash(CAREER_EVIDENCE_V1_0_0));
  const line = summary.split("\n").find((entry) => entry.startsWith("| a-alpha |"));
  const decision = decideStatus(PASSED_GATE, alphaA, shifted.thresholds);
  expect(decision).toEqual({ status: "review", reasons: ["event_low_confidence"] });
  expect(line).toContain("| review | event_low_confidence |");
  const recorded = JSON.parse(renderJsonl(report).trim().split("\n")[0] ?? "") as {
    rubricId: string;
    rubricHash: string;
  };
  expect(recorded.rubricId).toBe("career_evidence@9.9.9");
  expect(recorded.rubricHash).toBe(careerEvidenceRubricHash(shifted));

  const client: JevClient = {
    systemOne() {
      throw new Error("no request");
    },
  };
  const baseline = liveJudgmentService(CAREER_EVIDENCE_V1_0_0, client);
  const later = liveJudgmentService(shifted, client);
  const firstItem = items[0];
  if (firstItem === undefined) throw new Error("fixture is empty");
  const evidence = toEvidence(firstItem);
  expect(baseline.claimFingerprint(evidence)).not.toBe(later.claimFingerprint(evidence));
});

test("career_evidence@1.0.0 keeps the default output and the claim wire state", async () => {
  const leftDir = await tempDir();
  const rightDir = await tempDir();
  const left = stubService(() => {
    throw new Error("identity was called");
  });
  const right = stubService(() => {
    throw new Error("identity was called");
  });
  const flags = ["--items", fixturePath] as const;
  await main(
    [...flags, "--jsonl", join(leftDir, "claims.jsonl"), "--summary", join(leftDir, "summary.md")],
    left.service,
  );
  await main(
    [
      ...flags,
      "--rubric",
      "career_evidence@1.0.0",
      "--jsonl",
      join(rightDir, "claims.jsonl"),
      "--summary",
      join(rightDir, "summary.md"),
    ],
    right.service,
  );
  expect(await readFile(join(rightDir, "claims.jsonl"), "utf8")).toBe(
    await readFile(join(leftDir, "claims.jsonl"), "utf8"),
  );
  expect(await readFile(join(rightDir, "summary.md"), "utf8")).toBe(
    await readFile(join(leftDir, "summary.md"), "utf8"),
  );
  expect(right.seen[0]).toEqual(left.seen[0]);

  let request: { state: Record<string, unknown>; questions: Record<string, unknown> } | undefined;
  const client: JevClient = {
    systemOne(body) {
      request = body as { state: Record<string, unknown>; questions: Record<string, unknown> };
      return {
        withResponse: async () => {
          throw new Error("stop after capture");
        },
      };
    },
  };
  const items = parseSmokeItems(JSON.parse(await readFile(fixturePath, "utf8"))).slice(0, 1);
  await runClaimSmoke(items, liveJudgmentService(CAREER_EVIDENCE_V1_0_0, client));
  const state = {
    source: "resume",
    publisher: "Example Lab",
    published_at: "2024-05-31T00:00:00.000Z",
    source_url: SOURCE_URL_PLACEHOLDER,
    statement: "Example Role at Example Lab: synthetic bullet alpha",
    quoted_evidence: "Example Role at Example Lab: synthetic bullet alpha",
  };
  expect(JSON.stringify(request)).toBe(
    JSON.stringify({ state, questions: claimQuestionsFor(CAREER_EVIDENCE_V1_0_0) }),
  );
});

const RUBRIC_HASH_V11 = "60dadea6eae5cd8e3a0a552941ab30ef5cc12bde0f1346ab4d65ed6a78ab689c";
const CONFIG_ID_V11 = "claim_value@1.1.0:8f66391a";
const CONFIG_HASH_V11 = "8f66391ae3488a303bc8135936840cd739d0b808642b27293a1a906e1ae76adf";

test("career_evidence@1.1.0 preprocesses, scores, and diffs pairs without a live call", async () => {
  const split = "Built the example routing service; selected as 1 of 400 applicants.";
  const pure = "Built the example widget.";
  const mixed = "Won 1 of 400 for building the example widget.";
  const unowned = "Shipped the example widget.";
  const rosterA = "Built the example roster alpha.";
  const rosterB = "Built the example roster beta.";
  const down = "Helped the example crew file notes.";
  const items: SmokeItem[] = [
    item("split-bullet", "A", split, null),
    item("pure-output", "A", pure, null),
    item("mixed-win", "A", mixed, null),
    item("null-ownership", "A", unowned, null),
    item("roster-a", "A", rosterA, "roster"),
    item("roster-b", "B", rosterB, "roster"),
    item("down-item", "A", down, null),
  ];
  const dir = await tempDir();
  const itemsPath = join(dir, "items.json");
  await writeFile(itemsPath, JSON.stringify(items));
  const seen: {
    text: string;
    selection_rate: number | null;
    ownership_seed: string | null;
    keys: string[];
  }[] = [];
  const client: V11JevClient = {
    systemOne(request) {
      seen.push({
        text: request.state.text,
        selection_rate: request.state.selection_rate,
        ownership_seed: request.state.ownership_seed,
        keys: Object.keys(request.questions),
      });
      return {
        async withResponse() {
          if (request.state.text === down) throw new Error("socket down");
          return { data: { model: "smoke-v11", answers: answerFor(request.state.text) } };
        },
      };
    },
  };
  const v10: JevJudgmentService = {
    identityFingerprint() {
      throw new Error("identity");
    },
    claimFingerprint() {
      throw new Error("fingerprint");
    },
    async assessIdentity() {
      throw new Error("identity");
    },
    async assessClaim() {
      throw new Error("1.0.0 assessClaim was called");
    },
  };
  const code = await main(
    ["--items", itemsPath, "--rubric", "career_evidence@1.1.0", "--out", dir],
    v10,
    client,
  );
  expect(code).toBe(0);
  expect(seen).toHaveLength(8);
  expect(
    seen.every((call) => call.keys.includes("claim_class") && !call.keys.includes("event_kind")),
  ).toBe(true);
  const roleAt = seen.findIndex((call) => call.text === "Built the example routing service");
  const selectionAt = seen.findIndex((call) => call.text === "selected as 1 of 400 applicants.");
  expect(roleAt).toBeGreaterThanOrEqual(0);
  expect(selectionAt).toBeGreaterThan(roleAt);
  expect(seen[roleAt]?.selection_rate).toBeNull();
  expect(seen[roleAt]?.ownership_seed).toBe("core_contributor");
  expect(seen[selectionAt]?.selection_rate).toBe(0.0025);
  expect(seen.filter((call) => call.text === mixed)).toHaveLength(1);

  const jsonl = await readFile(join(dir, "claims.jsonl"), "utf8");
  const summary = await readFile(join(dir, "summary.md"), "utf8");
  for (const statement of [split, pure, mixed, unowned, rosterA, rosterB, down, "Example Lab"]) {
    expect(jsonl).not.toContain(statement);
    expect(summary).not.toContain(statement);
  }
  const rows = jsonl
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as V11Line);
  expect(rows).toHaveLength(9);
  for (const row of rows) {
    expect(row.rubricId).toBe("career_evidence@1.1.0");
    expect(row.rubricHash).toBe(RUBRIC_HASH_V11);
    expect(row.configId).toBe(CONFIG_ID_V11);
    expect(row.configHash).toBe(CONFIG_HASH_V11);
  }

  const role = rowById(rows, "split-bullet#0");
  const picked = rowById(rows, "split-bullet#1");
  expect(role).toMatchObject({
    sourceId: "split-bullet",
    parentId: "split-bullet",
    childId: "split-bullet#0",
    claimClass: "output",
    curvedDifficulty: 0.25,
    curvedGeneralizedImpact: 1,
    classValue: 0.5,
    ownershipMultiplier: 0.8,
    ownershipNullFallback: false,
    backingTier: "self_reported",
    backingMultiplier: 0.6,
    claimValue: 0.24,
    status: "accepted",
    reviewReasons: [],
    selectionRate: null,
    selectivity: null,
    respondedModel: "smoke-v11",
  });
  expect(picked).toMatchObject({
    sourceId: "split-bullet",
    parentId: "split-bullet",
    childId: "split-bullet#1",
    claimClass: "selection",
    selectionRate: 0.0025,
    curvedSelectivity: 1,
    classValue: 1,
    ownershipMultiplier: 1,
    claimValue: 0.6,
    status: "accepted",
    difficulty: null,
    generalizedImpact: null,
  });
  expect(picked.selectivity?.probabilities).toEqual([0, 0, 0, 0, 1]);

  const output = rowById(rows, "pure-output");
  expect(output).toMatchObject({
    claimClass: "output",
    status: "review",
    reviewReasons: ["dimension_low_confidence"],
    claimValue: 0.24,
    childId: "pure-output",
    parentId: "pure-output",
  });

  const linkedSelection = rowById(rows, "mixed-win#selection");
  const linkedOutput = rowById(rows, "mixed-win#output");
  expect(linkedSelection).toMatchObject({
    sourceId: "mixed-win",
    parentId: "mixed-win",
    claimClass: "selection",
    classConfidence: 0.88,
    classProbabilities: { selection: 0.2, output: 0.1, both: 0.7 },
    selectionRate: 0.0025,
    claimValue: 0.48,
    ownershipNullFallback: false,
    ownershipMultiplier: 0.8,
    status: "accepted",
  });
  expect(linkedOutput).toMatchObject({
    claimClass: "output",
    classConfidence: 0.88,
    selectionRate: null,
    selectivity: null,
    curvedDifficulty: 0.25,
    curvedGeneralizedImpact: 1,
    claimValue: 0.24,
    ownership: { choice: "core_contributor" },
  });

  const missing = rowById(rows, "null-ownership");
  expect(missing).toMatchObject({
    claimClass: "output",
    ownership: null,
    ownershipNullFallback: true,
    ownershipMultiplier: 0.8,
    classValue: 0.25,
    claimValue: 0.12,
    backingTier: "self_reported",
    status: "accepted",
  });

  const alpha = rowById(rows, "roster-a");
  const beta = rowById(rows, "roster-b");
  expect(alpha.difficulty?.score).toBe(3);
  expect(beta.difficulty?.score).toBe(1);
  expect(alpha.generalizedImpact?.score).toBe(1);
  expect(beta.generalizedImpact?.score).toBe(2.5);
  expect(alpha.curvedDifficulty).toBe(0);
  expect(beta.curvedDifficulty).toBe(0);

  const failed = rows.find((row) => row.childId === "down-item");
  expect(failed).toMatchObject({
    outcome: "unavailable",
    sourceId: "down-item",
    parentId: "down-item",
    respondedModel: null,
    error: "socket down",
  });

  expect(summary).toContain("Claims accepted 7. Review 1. Rejected 0.");
  expect(summary).toContain("Calls 8. Answered 7. judgment_unavailable 1. Invariant failures 0.");
  expect(summary).toContain("### roster");
  expect(summary).toContain("selectivity n/a");
  expect(summary).toContain("difficulty 2.0000");
  expect(summary).toContain("generalized_impact 1.5000");
  expect(summary).toContain("respondedModel smoke-v11.");
});

test("a low-confidence both asks the model for each half", async () => {
  const statement = "Admitted to the example fellowship and kept the lab notes.";
  const seen: string[] = [];
  const client: V11JevClient = {
    systemOne(request) {
      seen.push(request.state.text);
      return {
        async withResponse() {
          if (request.state.text === statement) {
            return {
              data: {
                model: "smoke-v11",
                answers: body(
                  "both",
                  0.32,
                  level(3, 0.9, 3),
                  level(2, 0.9, 2),
                  level(2, 0.9, 2),
                  owned("core_contributor"),
                ),
              },
            };
          }
          if (request.state.text === "Admitted to the example fellowship") {
            return {
              data: {
                model: "smoke-v11",
                answers: body(
                  "selection",
                  0.91,
                  level(4, 0.9, 4),
                  level(0, 1, 0),
                  level(0, 1, 0),
                  owned("core_contributor"),
                ),
              },
            };
          }
          if (request.state.text === "kept the lab notes.") {
            return {
              data: {
                model: "smoke-v11",
                answers: body(
                  "output",
                  0.87,
                  level(0, 1, 0),
                  level(2, 0.9, 2),
                  level(2, 0.9, 2),
                  owned("core_contributor"),
                ),
              },
            };
          }
          throw new Error(`unexpected claim text ${request.state.text}`);
        },
      };
    },
  };
  const report = await runV11ClaimSmoke([item("fellow", "A", statement, null)], client);
  expect(seen).toEqual([statement, "Admitted to the example fellowship", "kept the lab notes."]);
  expect(report.calls).toBe(3);
  expect(report.answered).toBe(3);
  expect(report.rows.map((row) => [row.childId, row.outcome])).toEqual([
    ["fellow#selection", "answered"],
    ["fellow#output", "answered"],
  ]);
  const selection = report.rows[0];
  const output = report.rows[1];
  if (selection?.outcome !== "answered" || output?.outcome !== "answered") {
    throw new Error("halves were not answered");
  }
  expect(selection.status).toBe("accepted");
  expect(output.status).toBe("accepted");
  expect(selection.classConfidence).toBe(0.91);
  expect(output.classConfidence).toBe(0.87);
  expect(selection.claimClass).toBe("selection");
  expect(output.claimClass).toBe("output");
});

test("a failed clause stays unavailable and its sibling still scores", async () => {
  const statement = "Built the example routing service; selected as 1 of 400 applicants.";
  const client: V11JevClient = {
    systemOne(request) {
      return {
        async withResponse() {
          if (request.state.text.startsWith("selected")) throw new Error("clause down");
          return {
            data: {
              model: "smoke-v11",
              answers: answerFor("Built the example routing service"),
            },
          };
        },
      };
    },
  };
  const report = await runV11ClaimSmoke([item("split-bullet", "A", statement, null)], client);
  expect(report.calls).toBe(2);
  expect(report.answered).toBe(1);
  expect(report.unavailable).toBe(1);
  expect(report.rows.map((row) => row.childId)).toEqual(["split-bullet#0", "split-bullet#1"]);
  const scored = report.rows[0];
  const failed = report.rows[1];
  if (scored === undefined || failed === undefined) throw new Error("missing rows");
  expect(scored.outcome).toBe("answered");
  if (scored.outcome === "answered") expect(scored.claimValue).toBe(0.24);
  expect(failed.outcome).toBe("unavailable");
  if (failed.outcome !== "answered") expect(failed.error).toBe("clause down");
});

test("the private items directory stays gitignored", async () => {
  const ignore = await readFile(join(import.meta.dir, "../.gitignore"), "utf8");
  expect(ignore.split("\n")).toContain("/sea-35-private/");
});

interface V11Line {
  outcome: string;
  rubricId: string;
  rubricHash: string;
  configId: string;
  configHash: string;
  sourceId: string;
  parentId: string;
  childId: string;
  respondedModel: string | null;
  error?: string;
  claimClass?: string;
  classConfidence?: number;
  classProbabilities?: { selection: number; output: number; both: number };
  selectionRate?: number | null;
  selectivity?: { score: number; probabilities: number[] } | null;
  difficulty?: { score: number } | null;
  generalizedImpact?: { score: number } | null;
  curvedSelectivity?: number | null;
  curvedDifficulty?: number | null;
  curvedGeneralizedImpact?: number | null;
  ownership?: { choice: string } | null;
  ownershipMultiplier?: number;
  ownershipNullFallback?: boolean;
  backingTier?: string;
  backingMultiplier?: number;
  classValue?: number;
  claimValue?: number;
  status?: string;
  reviewReasons?: string[];
}

function rowById(rows: readonly V11Line[], childId: string): V11Line {
  const found = rows.find((row) => row.childId === childId);
  if (found === undefined) throw new Error(`missing row ${childId}`);
  return found;
}

function item(id: string, resume: "A" | "B", statement: string, pair: string | null): SmokeItem {
  return {
    id,
    resume,
    org: "Example Lab",
    role: "Example Role",
    dates: "2024",
    statement,
    pair,
    publishedAt: "2024-01-01T00:00:00.000Z",
  };
}

function level(score: number, confidence: number, mass: number) {
  return {
    score,
    confidence,
    probabilities: {
      0: mass === 0 ? 1 : 0,
      1: mass === 1 ? 1 : 0,
      2: mass === 2 ? 1 : 0,
      3: mass === 3 ? 1 : 0,
      4: mass === 4 ? 1 : 0,
    },
  };
}

function owned(choice: "led" | "core_contributor" | null) {
  if (choice === null) return null;
  return {
    choice,
    confidence: 0.9,
    probabilities: {
      led: choice === "led" ? 1 : 0,
      core_contributor: choice === "core_contributor" ? 1 : 0,
      supporting: 0,
    },
  };
}

function answerFor(text: string) {
  if (text === "Built the example routing service") {
    return body(
      "output",
      0.92,
      level(0, 1, 0),
      level(2, 0.9, 2),
      level(4, 0.9, 4),
      owned("core_contributor"),
    );
  }
  if (text === "selected as 1 of 400 applicants.") {
    return body("selection", 0.92, level(4, 0.9, 4), level(0, 1, 0), level(0, 1, 0), owned("led"));
  }
  if (text === "Built the example widget.") {
    return body(
      "output",
      0.92,
      level(0, 1, 0),
      level(2, 0.4, 2),
      level(4, 0.95, 4),
      owned("core_contributor"),
    );
  }
  if (text === "Won 1 of 400 for building the example widget.") {
    return {
      ...body(
        "both",
        0.88,
        level(4, 0.9, 4),
        level(2, 0.9, 2),
        level(4, 0.9, 4),
        owned("core_contributor"),
      ),
      claim_class: {
        choice: "both",
        confidence: 0.88,
        probabilities: { selection: 0.2, output: 0.1, both: 0.7 },
      },
    };
  }
  if (text === "Shipped the example widget.") {
    return body("output", 0.9, level(0, 1, 0), level(2, 0.9, 2), level(2, 0.9, 2), null);
  }
  if (text === "Built the example roster alpha.") {
    return body("output", 0.92, level(0, 1, 0), level(3, 0.9, 0), level(1, 0.9, 0), owned("led"));
  }
  if (text === "Built the example roster beta.") {
    return body("output", 0.92, level(0, 1, 0), level(1, 0.9, 0), level(2.5, 0.9, 0), owned("led"));
  }
  throw new Error(`unexpected claim text ${text}`);
}

function body(
  choice: "selection" | "output" | "both",
  confidence: number,
  selectivity: ReturnType<typeof level>,
  difficulty: ReturnType<typeof level>,
  impact: ReturnType<typeof level>,
  ownership: ReturnType<typeof owned>,
) {
  return {
    claim_class: {
      choice,
      confidence,
      probabilities: {
        selection: choice === "selection" ? 1 : 0,
        output: choice === "output" ? 1 : 0,
        both: choice === "both" ? 1 : 0,
      },
    },
    selectivity,
    difficulty,
    generalized_impact: impact,
    ownership,
  };
}
