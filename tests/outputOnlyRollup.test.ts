import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  CANDIDATE_AUTHORED_SOURCES,
  CLAIM_AUTHORS,
  CLAIM_VALUE_V1_2_0,
  type ClaimAuthor,
  evidenceDateFor,
  OUTPUT_ONLY_ACCEPTED_SPEC_IDS,
  OUTPUT_ONLY_ROLLUP_V1_0_0,
  type OutputOnlyClaim,
  outputOnlyRollup,
  scoreClaimValueV12,
  validateEvidenceClaim,
} from "../src/index.ts";
import type { JobDateFields } from "../src/longitudinal/claimPreprocess.ts";
import type { LevelDistribution, RoleDistribution } from "../src/longitudinal/claimRubricV12.ts";
import {
  type JevJudgmentRecord,
  type JevRawScoreAnswer,
  JudgmentInvariantError,
} from "../src/longitudinal/records.ts";
import { SOURCE_KINDS, type SourceKind } from "../src/longitudinal/types.ts";
import {
  CAREER_EVIDENCE_V1_2_0,
  CAREER_EVIDENCE_V1_2_1,
  CAREER_EVIDENCE_V1_2_2,
  CAREER_EVIDENCE_V1_2_3,
  CAREER_EVIDENCE_V1_2_4,
  careerEvidenceV12SpecId,
} from "../src/models/careerEvidenceV12.ts";

const PERSON = "person-1";
const CUTOFF = new Date("2025-01-01T00:00:00.000Z");

type Level = 0 | 1 | 2 | 3 | 4;

function level(at: Level): LevelDistribution {
  const probabilities: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  probabilities[at] = 1;
  return { score: at, confidence: 1, probabilities };
}

function raw(at: Level): JevRawScoreAnswer {
  return { ...level(at), probabilities: [...level(at).probabilities], legend: [] };
}

const MAJOR: RoleDistribution = {
  choice: "major_contributor",
  confidence: 1,
  probabilities: { original_author: 0, major_contributor: 1, maintainer: 0, minor_part: 0 },
};

function record(id: string, answers: JevJudgmentRecord["answers"]): JevJudgmentRecord {
  return {
    id,
    kind: "claim",
    personId: PERSON,
    evidenceKey: `${PERSON}|${id}|2024-06-01|hash`,
    requestFingerprint: `fp-${id}`,
    specId: careerEvidenceV12SpecId(CAREER_EVIDENCE_V1_2_4),
    requestedModel: "model",
    respondedModel: "model",
    requestId: null,
    answers,
    usage: { inputTokens: 1, outputTokens: 1 },
    observedAt: "2024-06-01T00:00:00.000Z",
  };
}

function outputRecord(id: string, at: Level = 4) {
  return record(id, { difficulty: raw(at), scale: raw(at), role: MAJOR });
}

function selectionRecord(id: string, at: Level = 4) {
  return record(id, { selectivity: raw(at), pool_strength: raw(at) });
}

function dates(partial: Partial<JobDateFields> = {}): JobDateFields {
  return { startedAt: "2023-01-01", endedAt: "2023-06-01", publishedAt: null, ...partial };
}

function claim(id: string, partial: Partial<OutputOnlyClaim> = {}): OutputOnlyClaim {
  return {
    id,
    personId: PERSON,
    recordId: `rec-${id}`,
    claimClass: "output",
    status: "accepted",
    source: "resume",
    evidenceTier: "self_reported",
    jobDates: dates(),
    companyEvidence: null,
    ...partial,
  };
}

const OUTPUT_LEVELS: Level[] = [4, 3, 4, 2];

function fixture() {
  const records = [
    ...OUTPUT_LEVELS.map((at, i) => outputRecord(`rec-o${i + 1}`, at)),
    selectionRecord("rec-s1", 4),
  ];
  const claims = [
    ...OUTPUT_LEVELS.map((_, i) => claim(`o${i + 1}`)),
    claim("s1", { claimClass: "selection", jobDates: dates({ endedAt: null }) }),
  ];
  return { records, claims };
}

function run(claims: OutputOnlyClaim[], records: JevJudgmentRecord[], cutoff = CUTOFF) {
  return outputOnlyRollup({ personId: PERSON, records, claims, evidenceCutoff: cutoff });
}

function outputSubject(at: Level) {
  return {
    claimClass: "output" as const,
    difficulty: level(at),
    scale: level(at),
    role: MAJOR,
  };
}

describe("outputOnlyRollup referrer notes", () => {
  test("a referrer note does lift a claim value in scoreClaimValueV12 (the lift being shut out)", () => {
    const bare = scoreClaimValueV12(outputSubject(4), "self_reported", { claimId: "o1" });
    const noted = scoreClaimValueV12(outputSubject(4), "self_reported", {
      claimId: "o1",
      notes: [{ claimId: "o1", referrerName: "Alice" }],
    });
    expect(noted.claimValue).toBeGreaterThan(bare.claimValue);
  });

  test("notes never change the output, even when slipped into the input", () => {
    const { records, claims } = fixture();
    const base = run(claims, records);
    const withNotes = outputOnlyRollup({
      personId: PERSON,
      records,
      claims,
      evidenceCutoff: CUTOFF,
      notes: claims.map((c) => ({ claimId: c.id, referrerName: "Alice" })),
      trend: 1,
    } as never);
    expect(JSON.stringify(withNotes)).toBe(JSON.stringify(base));
  });

  test("substance is the no-note top-3 mean of claim values", () => {
    const { records, claims } = fixture();
    const unnoted = OUTPUT_LEVELS.map(
      (at) =>
        scoreClaimValueV12(outputSubject(at), "self_reported", { config: CLAIM_VALUE_V1_2_0 })
          .claimValue,
    );
    const top3 = unnoted.sort((a, b) => b - a).slice(0, 3);
    const expected = top3.reduce((a, b) => a + b, 0) / 3;
    expect(run(claims, records).substance).toBeCloseTo(expected, 12);
  });

  test("finished claim values are not an input", () => {
    const { records, claims } = fixture();
    const withValue = claims.map((c) => ({ ...c, claimValue: 1 }));
    expect(JSON.stringify(run(withValue, records))).toBe(JSON.stringify(run(claims, records)));
  });
});

describe("outputOnlyRollup evidence tiers", () => {
  test("a corroborated claim is rejected, whatever its status", () => {
    const { records, claims } = fixture();
    for (const status of ["accepted", "review"] as const) {
      const raised = claims.map((c) =>
        c.id === "o1" ? { ...c, status, evidenceTier: "corroborated" as const } : c,
      );
      expect(() => run(raised, records)).toThrow(JudgmentInvariantError);
      expect(() => run(raised, records)).toThrow(/claim o1 .*corroborated/);
    }
  });

  test("self_reported and externally_verified claims are accepted and scored at their tier", () => {
    const { records } = fixture();
    for (const evidenceTier of ["self_reported", "externally_verified"] as const) {
      const claims = [claim("o1", { evidenceTier })];
      const expected = scoreClaimValueV12(outputSubject(4), evidenceTier).claimValue;
      const result = run(claims, records);
      expect(result.claimCount).toBe(1);
      expect(result.substance).toBeCloseTo(Math.max(expected, 0.3), 12);
    }
  });
});

describe("outputOnlyRollup claim authors", () => {
  test("candidate and system authors are accepted", () => {
    const { records, claims } = fixture();
    const ok = claims.map((c, i) => ({
      ...c,
      author: (i % 2 === 0 ? "candidate" : "system") as ClaimAuthor,
    }));
    expect(run(ok, records).claimCount).toBe(5);
  });
});

function evidenceClaim(source: SourceKind, author?: unknown) {
  return {
    personId: PERSON,
    statement: "Shipped a compiler",
    identityDecision: "same",
    identityConfidence: 0.9,
    provenance: {
      source,
      sourceId: "source-1",
      url: "https://example.com/source",
      publisher: "Example",
      publishedAt: new Date("2024-01-01T00:00:00.000Z"),
      retrievedAt: new Date("2024-02-01T00:00:00.000Z"),
      quotedText: "Shipped a compiler",
      contentHash: "abc",
    },
    ...(author === undefined ? {} : { author }),
  } as never;
}

describe("claim author rules at ingest and in the roll-up", () => {
  test("ingest stores every claim author, including referrer and committee", () => {
    for (const author of CLAIM_AUTHORS) {
      expect(validateEvidenceClaim(evidenceClaim("resume", author))).toEqual({ ok: true });
      expect(validateEvidenceClaim(evidenceClaim("other", author))).toEqual({ ok: true });
    }
  });

  test("ingest rejects an unknown author", () => {
    const result = validateEvidenceClaim(evidenceClaim("resume", "judge"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("judge");
  });

  test("ingest rejects an authorless claim from a source outside the candidate-authored ones", () => {
    const result = validateEvidenceClaim(evidenceClaim("other"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain('source "other"');
  });

  test("the roll-up rejects referrer and committee authors that ingest stored", () => {
    const { records, claims } = fixture();
    for (const author of ["referrer", "committee"] as const) {
      expect(validateEvidenceClaim(evidenceClaim("resume", author)).ok).toBe(true);
      const bad = claims.map((c) => (c.id === "o1" ? { ...c, author } : c));
      expect(() => run(bad, records)).toThrow(new RegExp(`claim o1: author must not be ${author}`));
    }
  });

  test("ingest and the roll-up agree on authorless claims from every source", () => {
    // Fails when a new SOURCE_KINDS entry is not classified.
    const NOT_CANDIDATE_AUTHORED: readonly SourceKind[] = ["other"];
    const expected = SOURCE_KINDS.filter((source) => !NOT_CANDIDATE_AUTHORED.includes(source));
    expect([...CANDIDATE_AUTHORED_SOURCES].sort()).toEqual([...expected].sort());
    const { records } = fixture();
    for (const source of SOURCE_KINDS) {
      const stored = validateEvidenceClaim(evidenceClaim(source)).ok;
      const rolled = (() => {
        try {
          run([claim("o1", { source })], records);
          return true;
        } catch {
          return false;
        }
      })();
      expect({ source, stored, rolled }).toEqual({
        source,
        stored: CANDIDATE_AUTHORED_SOURCES.includes(source),
        rolled: CANDIDATE_AUTHORED_SOURCES.includes(source),
      });
    }
  });
});

describe("outputOnlyRollup ordering and determinism", () => {
  test("claims in any order give the same output and inputHash", () => {
    const { records, claims } = fixture();
    const forward = run(claims, records);
    const reversed = run([...claims].reverse(), [...records].reverse());
    const shuffled = run([claims[2]!, claims[4]!, claims[0]!, claims[3]!, claims[1]!], records);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
    expect(reversed.inputHash).toBe(forward.inputHash);
  });

  test("a different claim set changes the inputHash", () => {
    const { records, claims } = fixture();
    expect(run(claims.slice(1), records).inputHash).not.toBe(run(claims, records).inputHash);
  });

  test("a changed judgment record changes the inputHash", () => {
    const { records, claims } = fixture();
    const changed = records.map((r) => (r.id === "rec-o1" ? outputRecord("rec-o1", 1) : r));
    expect(run(claims, changed).inputHash).not.toBe(run(claims, records).inputHash);
  });

  test("same input twice is byte-identical", () => {
    const { records, claims } = fixture();
    expect(JSON.stringify(run(claims, records))).toBe(JSON.stringify(run(claims, records)));
  });

  test("the fixture's roll-up is pinned across runs and versions", () => {
    const { records, claims } = fixture();
    expect(run(claims, records)).toEqual({
      substance: 0.41,
      selection: 0.6,
      thin: false,
      claimCount: 5,
      inputHash: "fa810fd67fec9ceffabdaac149db12405104c14b5f749edc9af183613bc83f67",
      configHash: "746d4711ed0e0b51234bae724ce37bc4b5d7f460cf5d754c5b2828d1d4b835be",
    });
  });

  test("configHash is stable and moves with the config", () => {
    const { records, claims } = fixture();
    const first = run(claims, records);
    expect(first.configHash).toMatch(/^[0-9a-f]{64}$/);
    const other = outputOnlyRollup({
      personId: PERSON,
      records,
      claims,
      evidenceCutoff: CUTOFF,
      config: { ...OUTPUT_ONLY_ROLLUP_V1_0_0, sFloor: 0.4 },
    });
    expect(other.configHash).not.toBe(first.configHash);
  });
});

describe("outputOnlyRollup evidence cutoff", () => {
  test("a claim dated after the cutoff is excluded", () => {
    const { records, claims } = fixture();
    const before = run(claims, records);
    const late = claim("o5", {
      jobDates: dates({ startedAt: "2024-12-01", endedAt: "2025-03-01" }),
    });
    const after = run([...claims, late], [...records, outputRecord("rec-o5", 4)]);
    expect(after.claimCount).toBe(before.claimCount);
    expect(after.substance).toBe(before.substance);
  });

  test("a claim dated on the cutoff counts, one a day later does not", () => {
    const { records } = fixture();
    const on = claim("o1", { jobDates: dates({ endedAt: "2025-01-01" }) });
    const next = claim("o1", { jobDates: dates({ endedAt: "2025-01-02" }) });
    expect(run([on], records).claimCount).toBe(1);
    expect(run([next], records).claimCount).toBe(0);
  });

  test("an in-progress role started before the cutoff counts, though the resume was published after", () => {
    const { records } = fixture();
    const ongoing = claim("o1", {
      jobDates: dates({
        startedAt: "2024-06-01",
        endedAt: null,
        publishedAt: "2025-06-01T00:00:00.000Z",
      }),
    });
    expect(run([ongoing], records).claimCount).toBe(1);
    expect(evidenceDateFor(ongoing)?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
  });

  test("an in-progress role started after the cutoff is excluded", () => {
    const { records } = fixture();
    const ongoing = claim("o1", {
      jobDates: dates({
        startedAt: "2025-02-01",
        endedAt: null,
        publishedAt: "2024-01-01T00:00:00.000Z",
      }),
    });
    expect(run([ongoing], records).claimCount).toBe(0);
  });

  test("a finished role is dated by its end, not its start", () => {
    const { records } = fixture();
    const finished = claim("o1", {
      jobDates: dates({ startedAt: "2024-01-01", endedAt: "2025-06-01" }),
    });
    expect(run([finished], records).claimCount).toBe(0);
  });

  test("a selection claim is dated by its start, not its end", () => {
    const { records } = fixture();
    const hired = claim("s1", {
      claimClass: "selection",
      jobDates: dates({ startedAt: "2024-01-01", endedAt: "2025-06-01" }),
    });
    expect(run([hired], records).claimCount).toBe(1);
    const later = claim("s1", {
      claimClass: "selection",
      jobDates: dates({ startedAt: "2025-02-01", endedAt: null }),
    });
    expect(run([later], records).claimCount).toBe(0);
  });

  test("a claim whose needed date is not stated is excluded, not counted", () => {
    const { records } = fixture();
    const undated = claim("o1", { jobDates: dates({ startedAt: null, endedAt: null }) });
    expect(run([undated], records).claimCount).toBe(0);
  });

  test("a date that is not on the calendar is not stated", () => {
    for (const day of ["2025-02-29", "2025-02-30", "2025-04-31", "2025-13-01", "2025-00-10"]) {
      const bad = claim("o1", { jobDates: dates({ endedAt: day }) });
      expect(evidenceDateFor(bad)).toBeNull();
    }
    const leap = claim("o1", { jobDates: dates({ endedAt: "2024-02-29" }) });
    expect(evidenceDateFor(leap)?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  test("a non-accepted claim is not counted", () => {
    const { records, claims } = fixture();
    const held = claims.map((c) => (c.id === "o1" ? { ...c, status: "review" as const } : c));
    expect(run(held, records).claimCount).toBe(run(claims, records).claimCount - 1);
  });

  test("a non-accepted claim without a record is excluded, not an error", () => {
    const { records, claims } = fixture();
    for (const status of ["review", "no_work_described"] as const) {
      const orphan = claim("o9", { status, recordId: "rec-missing" });
      const result = run([...claims, orphan], records);
      expect(result.claimCount).toBe(run(claims, records).claimCount);
      expect(result.inputHash).not.toBe(run(claims, records).inputHash);
      expect(run([orphan, ...claims], records).inputHash).toBe(result.inputHash);
    }
  });

  test("an accepted claim without a record still throws", () => {
    const { records, claims } = fixture();
    const orphan = claim("o9", { recordId: "rec-missing" });
    expect(() => run([...claims, orphan], records)).toThrow(/missing record/);
  });
});

describe("outputOnlyRollup accepted specs", () => {
  const V12_SPECS = [
    CAREER_EVIDENCE_V1_2_0,
    CAREER_EVIDENCE_V1_2_1,
    CAREER_EVIDENCE_V1_2_2,
    CAREER_EVIDENCE_V1_2_3,
    CAREER_EVIDENCE_V1_2_4,
  ];

  test("the allowlist is exactly the shipped 1.2.x specs at their rubric hashes", () => {
    expect([...OUTPUT_ONLY_ACCEPTED_SPEC_IDS].sort()).toEqual(
      V12_SPECS.map(careerEvidenceV12SpecId).sort(),
    );
  });

  test("a record under each accepted spec is read", () => {
    for (const spec of V12_SPECS) {
      const rec = { ...outputRecord("rec-o1"), specId: careerEvidenceV12SpecId(spec) };
      expect(run([claim("o1")], [rec]).claimCount).toBe(1);
    }
  });

  test("a record under any other spec id or rubric hash is rejected", () => {
    const valid = careerEvidenceV12SpecId(CAREER_EVIDENCE_V1_2_4);
    for (const specId of [
      "career_evidence@1.2.4:00000000",
      "career_evidence@1.2.0:rubric",
      "career_evidence@1.2.5:fafb7d39",
      "career_evidence@1.1.0:cd500b05",
      "career_evidence@1.0.0:cd500b05",
      "career_evidence@1.0.0",
      "career_evidence@1.3.0:fafb7d39",
      "career_evidence@1.3:fafb7d39",
      "career_evidence@1.3",
      `${valid}x`,
      valid.split(":")[0]!,
    ]) {
      const rec = { ...outputRecord("rec-o1"), specId };
      expect(() => run([claim("o1")], [rec])).toThrow(/not an accepted career_evidence 1.2/);
    }
  });
});

describe("outputOnlyRollup structural errors", () => {
  test("a duplicate claim id throws, whatever order the claims arrive in", () => {
    const { records, claims } = fixture();
    const twin = { ...claims[0]! };
    expect(() => run([...claims, twin], records)).toThrow(
      /output-only roll-up: duplicate claim id "o1"/,
    );
    expect(() => run([twin, ...claims], records)).toThrow(
      /output-only roll-up: duplicate claim id "o1"/,
    );
  });

  test("a duplicate claim id throws even when the claims are not accepted", () => {
    const { records, claims } = fixture();
    const held = claim("o9", { status: "review" });
    expect(() => run([...claims, held, { ...held }], records)).toThrow(
      /output-only roll-up: duplicate claim id "o9"/,
    );
  });

  test("a claim for another person throws", () => {
    const { records, claims } = fixture();
    const stray = claim("o9", { personId: "person-2", recordId: "rec-o1" });
    expect(() => run([...claims, stray], records)).toThrow(/person-2's, not person-1's/);
  });

  test("a claim for another person throws even when it is not accepted", () => {
    const { records, claims } = fixture();
    const stray = claim("o9", { personId: "person-2", status: "review" });
    expect(() => run([...claims, stray], records)).toThrow(/person-2's, not person-1's/);
  });

  test("a record for another person throws", () => {
    const { records, claims } = fixture();
    const foreign = records.map((r) => (r.id === "rec-o1" ? { ...r, personId: "person-2" } : r));
    expect(() => run(claims, foreign)).toThrow(/record rec-o1 is person-2's/);
  });

  test("a record that is not a claim record throws", () => {
    const { records, claims } = fixture();
    const wrongKind = records.map((r) => (r.id === "rec-o1" ? { ...r, kind: "review" } : r));
    expect(() => run(claims, wrongKind as never)).toThrow(/not a claim one/);
  });

  test("two different records sharing an id throw", () => {
    const { records, claims } = fixture();
    expect(() => run(claims, [...records, outputRecord("rec-o1", 0)])).toThrow(/share id rec-o1/);
  });

  test("a record's answers key order changes neither the hash nor the shared-id check", () => {
    const { records, claims } = fixture();
    const reordered = records.map((r) =>
      r.id === "rec-o1"
        ? { ...r, answers: Object.fromEntries(Object.entries(r.answers).reverse()) }
        : r,
    );
    expect(Object.keys(reordered[0]?.answers ?? {})).not.toEqual(
      Object.keys(records[0]?.answers ?? {}),
    );
    expect(run(claims, reordered).inputHash).toBe(run(claims, records).inputHash);
    expect(() => run(claims, [...records, ...reordered])).not.toThrow();
  });

  test("two accepted claims naming one record throw, naming the record and both claims", () => {
    const { records, claims } = fixture();
    const shared = [...claims, claim("o9", { recordId: "rec-o1" })];
    expect(() => run(shared, records)).toThrow(JudgmentInvariantError);
    expect(() => run(shared, records)).toThrow(/rec-o1.*o1.*o9/);
  });

  test("a shared record throws whatever order the claims and records arrive in", () => {
    const { records, claims } = fixture();
    const shared = [...claims, claim("o9", { recordId: "rec-o1" })];
    expect(() => run([...shared].reverse(), [...records].reverse())).toThrow(
      JudgmentInvariantError,
    );
    expect(() => run([...shared.slice(-1), ...shared.slice(0, -1)], records)).toThrow(/rec-o1/);
  });

  test("distinct records for every claim pass", () => {
    const { records, claims } = fixture();
    expect(() => run(claims, records)).not.toThrow();
    expect(() => run([...claims].reverse(), [...records].reverse())).not.toThrow();
  });

  test("non-accepted claims may share a record id or have none", () => {
    const { records, claims } = fixture();
    const extra = [
      claim("r1", { status: "review", recordId: "rec-o1" }),
      claim("r2", { status: "review", recordId: "rec-o1" }),
      claim("r3", { status: "review", recordId: "rec-none" }),
    ];
    expect(() => run([...claims, ...extra], records)).not.toThrow();
  });

  test("an accepted claim naming a missing record throws", () => {
    const { records, claims } = fixture();
    const orphan = claim("o9", { recordId: "rec-missing" });
    expect(() => run([...claims, orphan], records)).toThrow(/claim o9 names missing record/);
  });

  test("an invalid evidence cutoff throws", () => {
    const { records, claims } = fixture();
    expect(() => run(claims, records, new Date(Number.NaN))).toThrow(/evidenceCutoff/);
    expect(() => run(claims, records, "2025-01-01" as never)).toThrow(/evidenceCutoff/);
    expect(() => outputOnlyRollup({ personId: PERSON, records, claims } as never)).toThrow(
      /evidenceCutoff/,
    );
  });

  test("an out-of-range config throws", () => {
    const { records, claims } = fixture();
    for (const config of [
      { ...OUTPUT_ONLY_ROLLUP_V1_0_0, sFloor: 1.5 },
      { ...OUTPUT_ONLY_ROLLUP_V1_0_0, sFloor: -0.1 },
      { ...OUTPUT_ONLY_ROLLUP_V1_0_0, minOutputClaims: 1.5 },
    ]) {
      expect(() =>
        outputOnlyRollup({ personId: PERSON, records, claims, evidenceCutoff: CUTOFF, config }),
      ).toThrow(/output-only roll-up/);
    }
  });
});

describe("outputOnlyRollup thin candidates", () => {
  test("no claims gives s_floor and thin, never a missing value", () => {
    const result = run([], []);
    expect(result.substance).toBe(0.3);
    expect(result.thin).toBe(true);
    expect(result.selection).toBeNull();
    expect(result.claimCount).toBe(0);
  });

  test("all claims after the cutoff gives s_floor and thin", () => {
    const { records, claims } = fixture();
    const result = run(claims, records, new Date("2000-01-01T00:00:00.000Z"));
    expect(result.substance).toBe(0.3);
    expect(result.thin).toBe(true);
  });

  test("weak output claims are raised to s_floor and marked thin", () => {
    const records = [outputRecord("rec-a", 0), outputRecord("rec-b", 0), outputRecord("rec-c", 0)];
    const claims = [claim("a"), claim("b"), claim("c")];
    const result = run(claims, records);
    expect(result.substance).toBe(0.3);
    expect(result.thin).toBe(true);
    expect(result.claimCount).toBe(3);
  });

  test("fewer output claims than the minimum is thin even when strong", () => {
    const records = [outputRecord("rec-a", 4), outputRecord("rec-b", 3)];
    const result = run([claim("a"), claim("b")], records);
    const measured =
      ([4, 3] as const)
        .map((at) => scoreClaimValueV12(outputSubject(at), "self_reported").claimValue)
        .reduce((sum, value) => sum + value, 0) / 2;
    expect(measured).toBeGreaterThan(0.3);
    expect(result.thin).toBe(true);
    expect(result.substance).toBeCloseTo(measured, 12);
  });

  test("enough strong output claims is not thin and keeps its own substance", () => {
    const { records, claims } = fixture();
    const result = run(claims, records);
    expect(result.thin).toBe(false);
    expect(result.substance).toBeGreaterThan(0.3);
    expect(result.selection).not.toBeNull();
  });

  test("selection claims do not count toward the output minimum", () => {
    const records = [
      outputRecord("rec-a", 4),
      outputRecord("rec-b", 4),
      selectionRecord("rec-s1"),
      selectionRecord("rec-s2"),
    ];
    const claims = [
      claim("a"),
      claim("b"),
      claim("s1", { claimClass: "selection" }),
      claim("s2", { claimClass: "selection" }),
    ];
    expect(run(claims, records).thin).toBe(true);
  });
});

describe("truth-label guard", () => {
  test("claimValuesToLongitudinalRecords has no callers, not even in its own file", async () => {
    const root = join(import.meta.dir, "..");
    const result = Bun.spawnSync(
      ["git", "grep", "-l", "claimValuesToLongitudinalRecords", "--", ".", ":!tests", ":!docs"],
      { cwd: root },
    );
    const files = new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean);
    expect(files).toEqual(["src/longitudinal/claimValue.ts"]);
    const source = await Bun.file(join(root, "src/longitudinal/claimValue.ts")).text();
    expect(source.match(/claimValuesToLongitudinalRecords/g)).toHaveLength(1);
  });
});
