import { describe, expect, mock, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeActionError } from "../apps/club/lib/actionError.ts";
import { runClubPass } from "../apps/club/lib/engine/pass.ts";
import {
  addComparison,
  addEvaluation,
  addPerson,
  addReferral,
  computeView,
  decide,
  EXAMPLE_REQUIRED_DIMENSIONS,
  EXAMPLE_T_END,
  EXAMPLE_T_START,
  initialState,
  loadClub,
  OWNER_EVALUATOR_ID,
  recordFeedback,
  requestFeedback,
  resetClub,
  setReviewConfig,
  setStatus,
} from "../apps/club/lib/engine.ts";
import {
  cohortAverage,
  fmtDateShort,
  meanConviction,
  scoreRank,
  signalBand,
  signalContext,
} from "../apps/club/lib/format.ts";
import {
  availableDecisions,
  daysBetween,
  FEEDBACK_WINDOW_HOURS,
  feedbackState,
  nextReviewStatus,
  statusForReview,
} from "../apps/club/lib/review.ts";
import { sortRows } from "../apps/club/lib/tableModel.ts";
import type { ClubState } from "../apps/club/lib/types.ts";
import { loadSpecs } from "../src/config.ts";
import { BANNED_LANGUAGE, PRODUCT_LANGUAGE, SCALE_LABELS } from "../src/domain/constants.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { computeJudgeCalibration, judgeWeightOptions } from "../src/judges/reliability.ts";
import { TRACK_RECORD_ORDER } from "../src/judges/trackRecord.ts";
import { advance } from "../src/pipeline/advance.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import * as referralStrengthModule from "../src/scoring/referralStrength.ts";
import { generateSeed } from "../src/seed/generate.ts";

/**
 * R_uv is computed in exactly one place — `referralStrengthBreakdown` — so
 * counting its calls counts the work the seam was supposed to remove. The mock
 * delegates to the real implementation captured before the swap, so no number
 * moves; only `strengthCalls` changes.
 */
const realStrength = { ...referralStrengthModule };
let strengthCalls = 0;
mock.module("../src/scoring/referralStrength.ts", () => ({
  ...realStrength,
  referralStrengthBreakdown: (
    ...args: Parameters<typeof realStrength.referralStrengthBreakdown>
  ) => {
    strengthCalls++;
    return realStrength.referralStrengthBreakdown(...args);
  },
}));

const root = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Every module of the split engine, `engine.ts` first. */
const engineSources = (): string[] => [
  "apps/club/lib/engine.ts",
  ...readdirSync(join(root, "apps/club/lib/engine"))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => `apps/club/lib/engine/${f}`),
];

function personNamed(view: ReturnType<typeof computeView>, name: string) {
  const p = view.people.find((row) => row.name === name);
  if (!p) throw new Error(`expected ${name} on the seed`);
  return p;
}

describe("council page engine: seed pins", () => {
  test("Cleo quiet, Bram loud, no incoming is Insufficient Evidence not 0, never a merged score", () => {
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    const bram = personNamed(view, "Bram Okafor");
    expect(cleo.v2Signal).toBe(7);
    expect(cleo.incomingCount).toBe(1);
    expect(bram.v2Signal).toBe(62);
    expect(bram.incomingCount).toBe(4);
    for (const name of ["Ife Doyle", "Noor Petrov"]) {
      const p = personNamed(view, name);
      expect(p.incomingCount).toBe(0);
      expect(p.v2Signal).toBeNull();
      expect(p.v0Signal).toBeNull();
    }
    const rows = new Map(view.candidates.map((c) => [c.personId, c]));
    expect(rows.get("p-cleo")?.v2Signal).toBe(7);
    expect(rows.get("p-bram")?.v2Signal).toBe(62);
    expect(
      view.candidates.filter((c) => c.incomingCount === 0).every((c) => c.v2Signal === null),
    ).toBe(true);
    expect(view.now).toBe(EXAMPLE_T_END);
    const json = JSON.stringify(view);
    for (const phrase of BANNED_LANGUAGE) expect(json).not.toContain(phrase);
  });

  test("review queue buckets on the seed, and members/archived carry no bucket", () => {
    const { view } = loadClub();
    const bucketOf = (id: string) => view.people.find((p) => p.id === id)?.queue?.bucket ?? null;
    expect(bucketOf("p-cleo")).toBe("under_recognized");
    expect(personNamed(view, "Cleo Marsh").queue?.flags).toEqual([
      "under_recognized",
      "single_source",
    ]);
    expect(bucketOf("p-dev")).toBe("single_source");
    expect(bucketOf("p-alice")).toBe("ready_to_decide");
    expect(bucketOf("p-bram")).toBe("ready_to_decide");
    expect(bucketOf("p-ember")).toBe("under_recognized");
    expect(bucketOf("p-fox")).toBe("under_recognized");
    expect(personNamed(view, "Ife Doyle").queue?.bucket).toBe("no_referrals");
    for (const p of view.people.filter((row) => row.status !== "candidate")) {
      expect(p.queue).toBeNull();
    }
  });

  test("three channels on Cleo: signal, seven dimensions, rubric rows; required marks follow config", () => {
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    expect(view.config.requiredDimensions).toEqual([...EXAMPLE_REQUIRED_DIMENSIONS]);
    expect(cleo.dimensions).toHaveLength(7);
    expect(cleo.dimensions.find((d) => d.dimension === "agency")?.state).toBe("estimated");
    expect(cleo.dimensions.find((d) => d.dimension === "agency")?.required).toBe(true);
    expect(cleo.dimensions.find((d) => d.dimension === "taste")?.required).toBe(false);
    expect(cleo.rubric).toHaveLength(7);
    const output = cleo.rubric.find((r) => r.dimension === "output");
    expect(output?.scored).toBe(1);
    expect(output?.mean).toBe(2);
    expect(output?.anchor).toBe(SCALE_LABELS.rubric[2]);
    expect(cleo.rubric.find((r) => r.dimension === "agency")?.mean).toBeNull();
    expect(cleo.gaps.some((g) => g.dimension === "agency" && g.gap >= 25)).toBe(true);
  });

  test("missing evidence names required dimensions Cleo lacks and her single source", () => {
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    const kinds = cleo.missingEvidence.map((m) => `${m.kind}:${m.dimension ?? ""}`);
    expect(kinds).toContain("single_source:");
    expect(kinds).toContain("rubric_missing:problem_solving");
    expect(kinds).toContain("rubric_missing:agency");
    expect(kinds).not.toContain("rubric_missing:output");
    expect(kinds).toContain("capability_insufficient:output");
    const fox = personNamed(view, "Fox Delacroix");
    expect(fox.dimensions.find((d) => d.dimension === "agency")?.state).toBe(
      "insufficient_evidence",
    );
  });

  test("evidence by judge: grouped by author, ordered by trust, no raw weights", () => {
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    const referrerGroups = cleo.judgeEvidence.filter((g) =>
      g.items.some((i) => i.kind === "referral"),
    );
    expect(referrerGroups).toHaveLength(1);
    expect(referrerGroups[0]?.name).toBe("Rafael de Vries");
    expect(referrerGroups[0]?.trackRecord.label).toBe("tends_to_underrate");
    const trusts = cleo.judgeEvidence.map((g) => g.trackRecord.trust ?? Number.NEGATIVE_INFINITY);
    expect(trusts).toEqual([...trusts].sort((a, b) => b - a));
    expect(cleo.judgeEvidence.some((g) => g.trackRecord.trust !== null)).toBe(true);
    for (const g of cleo.judgeEvidence) {
      for (const item of g.items) {
        if (item.kind === "referral") expect(item.evidenceText.length).toBeGreaterThan(0);
      }
    }
    const json = JSON.stringify(view);
    for (const key of [
      '"reliability":',
      '"meanSquaredError":',
      '"rawBias":',
      '"bias":',
      '"rawReliability":',
    ]) {
      expect(json).not.toContain(key);
    }
    const tomas = view.members.find((m) => m.name === "Tomas Lindqvist");
    expect(tomas?.trackRecord.label).toBe("calibrated");
    expect(view.members.every((m) => m.trackRecord.label !== undefined)).toBe(true);
  });

  test("seeded feedback requests: pending, overdue, responded — against the example clock", () => {
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    const dev = personNamed(view, "Dev Raman");
    const bram = personNamed(view, "Bram Okafor");
    expect(cleo.feedback.map((f) => f.state)).toEqual(["pending"]);
    expect(cleo.reviewStatus).toBe("under_review");
    expect(dev.feedback.map((f) => f.state)).toEqual(["overdue"]);
    expect(dev.reviewStatus).toBe("needs_data");
    expect(bram.feedback.map((f) => f.state)).toEqual(["responded"]);
    expect(bram.feedback[0]?.evaluationId).toBe(bram.evaluations[0]?.id ?? "");
    expect(view.counts.pendingFeedback).toBe(1);
    expect(view.counts.overdueFeedback).toBe(1);
    expect(personNamed(view, "Alice Tanaka").reviewStatus).toBe("new");
    expect(personNamed(view, "Noor Petrov").reviewStatus).toBe("admitted");
    const suggested = cleo.suggestedMembers.map((m) => m.name);
    expect(suggested).not.toContain("Tomas Lindqvist"); // pending request
    expect(suggested).toContain("Rafael de Vries"); // referred her, no rubric on required dims
    expect(cleo.suggestedMembers.map((m) => TRACK_RECORD_ORDER[m.trackRecord.label])).toEqual(
      cleo.suggestedMembers
        .map((m) => TRACK_RECORD_ORDER[m.trackRecord.label])
        .sort((a, b) => a - b),
    );
  });

  test("load and reset match generateSeed identity", () => {
    const seed = generateSeed();
    const loaded = loadClub();
    const reset = resetClub();
    expect(loaded.state.people.map((p) => p.id)).toEqual(seed.people.map((p) => p.id));
    expect(loaded.state.referrals.map((r) => r.id)).toEqual(seed.referrals.map((r) => r.id));
    expect(reset.state.people.map((p) => p.id)).toEqual(seed.people.map((p) => p.id));
    expect(reset.view.people.find((p) => p.id === "p-cleo")?.v2Signal).toBe(7);
  });

  test("at the start of the year the judge window is closed and V2 equals V0", () => {
    const state = initialState();
    const early = computeView({ ...state, now: EXAMPLE_T_START });
    expect(early.calibration.windowOpen).toBe(false);
    expect(early.calibration.evaluatedReferrals).toBe(0);
    for (const p of early.people.filter((row) => row.persona)) expect(p.v2Signal).toBe(p.v0Signal);
    const late = computeView({ ...state, now: EXAMPLE_T_END });
    expect(late.calibration.windowOpen).toBe(true);
    expect(late.calibration.judgesWithEvidence).toBeGreaterThan(0);
    expect(late.people.some((p) => p.persona && p.v2Signal !== p.v0Signal)).toBe(true);
    // The as-of filter and the spec default live with the orchestrator.
    const source = read("apps/club/lib/engine/computeView.ts");
    expect(source).toContain("referralsAsOf");
    expect(source).toContain("createdAt.getTime() <= t");
    expect(source).toContain("loadSpecs()");
    for (const rel of engineSources()) {
      const text = read(rel);
      expect(text, `${rel} must not pin a spec snapshot`).not.toContain("CURRENT_SPECS");
      expect(text, `${rel} must not hardcode the example clock`).not.toContain("Date.UTC(2026");
    }
  });

  test("club view applies loadSpecs TG_* the same way as the CLI", () => {
    const state = initialState();
    const tightened = loadSpecs({ TG_TOP_K_REFERRALS: "1" }, { warn: () => {} });
    const view = computeView(state, tightened);
    const ember = view.people.find((p) => p.id === "p-ember");
    if (!ember) throw new Error("expected Ember on the seed");
    expect(ember.referrals).toHaveLength(6);
    expect(ember.contributing).toHaveLength(1);
    expect(ember.referrals.filter((r) => !r.contributing)).toHaveLength(5);
    expect(ember.neighbourhood.referrers).toHaveLength(6);
  });
});

describe("council page engine: decisions", () => {
  test("transition table", () => {
    expect(nextReviewStatus("new", "start_review")).toBe("under_review");
    expect(nextReviewStatus("new", "admit")).toBe("admitted");
    expect(nextReviewStatus("under_review", "deny")).toBe("denied");
    expect(nextReviewStatus("under_review", "request_data")).toBe("needs_data");
    expect(nextReviewStatus("needs_data", "request_data")).toBeNull();
    expect(nextReviewStatus("needs_data", "start_review")).toBe("under_review");
    expect(nextReviewStatus("admitted", "admit")).toBeNull();
    expect(nextReviewStatus("admitted", "reopen")).toBe("under_review");
    expect(nextReviewStatus("denied", "reopen")).toBe("under_review");
    expect(availableDecisions("new").sort()).toEqual([
      "admit",
      "deny",
      "request_data",
      "start_review",
    ]);
    expect(availableDecisions("admitted")).toEqual(["reopen"]);
    expect(statusForReview("admitted")).toBe("member");
    expect(statusForReview("denied")).toBe("archived");
    expect(statusForReview("needs_data")).toBe("candidate");
  });

  test("admit records a snapshot, maps to member, and changes no number", () => {
    const start = loadClub();
    const before = start.view.people.find((p) => p.id === "p-cleo");
    const after = decide(start.state, "p-cleo", "admit");
    expect(after.error).toBeUndefined();
    const cleo = after.view.people.find((p) => p.id === "p-cleo");
    expect(cleo?.reviewStatus).toBe("admitted");
    expect(cleo?.status).toBe("member");
    expect(cleo?.queue).toBeNull();
    expect(cleo?.v2Signal).toBe(before?.v2Signal ?? -1);
    expect(after.view.counts.admitted).toBe(start.view.counts.admitted + 1);
    expect(after.state.snapshots[0]?.decision).toBe("admitted");
    expect(after.state.snapshots[0]?.personName).toBe("Cleo Marsh");
    expect(after.state.snapshots[0]?.values.referralSignal).toBe(7);
    expect(after.state.snapshots[0]?.values.incomingCount).toBe(1);
    const invalid = decide(after.state, "p-cleo", "admit");
    expect(invalid.error).toContain("cannot admit from admitted");
    const reopened = decide(after.state, "p-cleo", "reopen");
    expect(reopened.view.people.find((p) => p.id === "p-cleo")?.reviewStatus).toBe("under_review");
    expect(reopened.view.people.find((p) => p.id === "p-cleo")?.status).toBe("candidate");
  });

  test("deny and request-more-data; setStatus stays consistent with review status", () => {
    const start = loadClub();
    const denied = decide(start.state, "p-bram", "deny");
    expect(denied.view.people.find((p) => p.id === "p-bram")?.status).toBe("archived");
    expect(denied.view.counts.denied).toBe(start.view.counts.denied + 1);
    const needs = decide(start.state, "p-alice", "request_data");
    expect(needs.view.people.find((p) => p.id === "p-alice")?.reviewStatus).toBe("needs_data");
    expect(needs.view.counts.needsData).toBe(start.view.counts.needsData + 1);
    const viaStatus = setStatus(start.state, "p-alice", "member");
    expect(viaStatus.view.people.find((p) => p.id === "p-alice")?.reviewStatus).toBe("admitted");
    expect(viaStatus.state.snapshots[0]?.decision).toBe("member");
    expect(decide(start.state, "nobody", "admit").error).toBe("unknown person");
  });
});

describe("council page engine: feedback loop", () => {
  test("request feedback opens a 48-hour window and moves a new case under review", () => {
    const start = loadClub();
    const tomas = start.state.people.find((p) => p.name === "Tomas Lindqvist");
    const hana = start.state.people.find((p) => p.name === "Hana Nakamura");
    if (!tomas || !hana) throw new Error("expected members");
    const after = requestFeedback(start.state, {
      candidateId: "p-alice",
      memberIds: [tomas.id, hana.id],
      note: "Anything on agency?",
    });
    expect(after.error).toBeUndefined();
    const alice = after.view.people.find((p) => p.id === "p-alice");
    expect(alice?.reviewStatus).toBe("under_review");
    expect(alice?.feedback).toHaveLength(2);
    const req = alice?.feedback[0];
    if (!req) throw new Error("expected a request");
    expect(req.state).toBe("pending");
    expect(new Date(req.dueAt).getTime() - new Date(req.requestedAt).getTime()).toBe(
      FEEDBACK_WINDOW_HOURS * 3_600_000,
    );
    expect(feedbackState(req, req.dueAt)).toBe("pending");
    expect(feedbackState(req, new Date(new Date(req.dueAt).getTime() + 1).toISOString())).toBe(
      "overdue",
    );
    expect(alice?.suggestedMembers.some((m) => m.personId === tomas.id)).toBe(false);
    const dup = requestFeedback(after.state, {
      candidateId: "p-alice",
      memberIds: [tomas.id],
      note: "",
    });
    expect(dup.error).toContain("already has a pending request");
    expect(
      requestFeedback(start.state, { candidateId: "p-alice", memberIds: ["p-alice"], note: "" })
        .error,
    ).toContain("cannot review themselves");
    expect(
      requestFeedback(start.state, { candidateId: "p-alice", memberIds: [], note: "" }).error,
    ).toContain("at least one");
  });

  test("record feedback stores a rubric evaluation, closes the request, and updates the rubric row", () => {
    const start = loadClub();
    const cleoBefore = start.view.people.find((p) => p.id === "p-cleo");
    const pending = cleoBefore?.feedback.find((f) => f.state === "pending");
    if (!pending) throw new Error("expected Cleo's pending request");
    const after = recordFeedback(start.state, {
      requestId: pending.id,
      evaluatorId: pending.memberId,
      candidateId: "p-cleo",
      dimension: "agency",
      score: 3,
      confidence: 4,
      evidenceText: "Took an underspecified brief and shipped without check-ins.",
    });
    expect(after.error).toBeUndefined();
    const cleo = after.view.people.find((p) => p.id === "p-cleo");
    expect(cleo?.feedback.find((f) => f.id === pending.id)?.state).toBe("responded");
    expect(cleo?.rubric.find((r) => r.dimension === "agency")?.mean).toBe(3);
    expect(
      cleo?.missingEvidence.some((m) => m.kind === "rubric_missing" && m.dimension === "agency"),
    ).toBe(false);
    expect(
      cleo?.judgeEvidence.some(
        (g) => g.judgeId === pending.memberId && g.items.some((i) => i.kind === "evaluation"),
      ),
    ).toBe(true);
    expect(after.view.counts.evaluations).toBe(start.view.counts.evaluations + 1);
    expect(after.view.counts.pendingFeedback).toBe(start.view.counts.pendingFeedback - 1);
    expect(cleo?.v2Signal).toBe(cleoBefore?.v2Signal ?? -1);
  });

  test("evaluation validation: self, blank text, not-observed keeps no confidence", () => {
    const start = loadClub();
    expect(
      addEvaluation(start.state, {
        evaluatorId: "p-cleo",
        candidateId: "p-cleo",
        dimension: "agency",
        score: 2,
        confidence: 3,
        evidenceText: "x",
      }).error,
    ).toContain("must differ");
    expect(
      addEvaluation(start.state, {
        evaluatorId: "p-alice",
        candidateId: "p-cleo",
        dimension: "agency",
        score: 2,
        confidence: 3,
        evidenceText: "   ",
      }).error,
    ).toContain("non-empty");
    const notObserved = addEvaluation(start.state, {
      evaluatorId: "p-alice",
      candidateId: "p-cleo",
      dimension: "taste",
      score: null,
      confidence: 3,
      evidenceText: "Never saw her choose a problem.",
    });
    expect(notObserved.error).toBeUndefined();
    const row = notObserved.view.people
      .find((p) => p.id === "p-cleo")
      ?.evaluations.find((e) => e.dimension === "taste");
    expect(row?.score).toBeNull();
    expect(row?.confidence).toBeNull();
    expect(row?.scoreLabel).toBe(SCALE_LABELS.rubricNotObserved);
  });

  test("round settings change required marks and the missing-evidence list", () => {
    const start = loadClub();
    const after = setReviewConfig(start.state, { requiredDimensions: ["taste"] });
    expect(after.error).toBeUndefined();
    const cleo = after.view.people.find((p) => p.id === "p-cleo");
    expect(cleo?.dimensions.filter((d) => d.required).map((d) => d.dimension)).toEqual(["taste"]);
    expect(
      cleo?.missingEvidence.filter((m) => m.kind === "rubric_missing").map((m) => m.dimension),
    ).toEqual(["taste"]);
    expect(setReviewConfig(start.state, { requiredDimensions: [] }).error).toContain(
      "at least one",
    );
  });
});

describe("council page engine: referrals and compares still validate", () => {
  test("a new referral and a compare are validated then folded into the view", () => {
    const start = loadClub();
    const referred = addReferral(start.state, {
      referrerId: "p-alice",
      candidateId: "p-cleo",
      conviction: 5,
      confidence: 5,
      relationshipDepth: 4,
      evidenceType: "firsthand_work",
      evidenceText: "Watched her rewrite a stuck systems problem in a day.",
    });
    expect(referred.error).toBeUndefined();
    expect(referred.view.counts.referrals).toBe(start.view.counts.referrals + 1);
    expect(referred.view.people.find((p) => p.id === "p-cleo")?.incomingCount).toBe(2);
    expect(addReferral(start.state, { ...referredInput(), referrerId: "ghost" }).error).toContain(
      "unknown person",
    );

    const compared = addComparison(referred.state, {
      personAId: "p-cleo",
      personBId: "p-bram",
      dimension: "agency",
      outcome: "a",
      confidence: 3,
      evidenceText: "Cleo drove; Bram waited for direction.",
    });
    expect(compared.error).toBeUndefined();
    expect(compared.view.counts.comparisons).toBe(referred.view.counts.comparisons + 1);
    const last = compared.state.comparisons[compared.state.comparisons.length - 1];
    expect(last?.confidence).toBe(3);
    expect(last?.evaluatorId).toBe(OWNER_EVALUATOR_ID);
    expect(last?.evidenceText).toContain("Cleo drove");
    const skipped = addComparison(compared.state, {
      personAId: "p-cleo",
      personBId: "p-bram",
      dimension: "agency",
      outcome: "skip",
      confidence: 5,
    });
    expect(skipped.state.comparisons[skipped.state.comparisons.length - 1]?.confidence).toBeNull();
  });

  test("addPerson stores contact metadata and starts a case as new", () => {
    const start = loadClub();
    const added = addPerson(start.state, {
      name: "Ada Cole",
      phone: "+1 555 0100",
      linkedin: "linkedin.com/in/adacole",
      resume: "https://example.com/ada.pdf",
    });
    expect(added.error).toBeUndefined();
    const ada = added.view.people.find((p) => p.name === "Ada Cole");
    expect(ada?.reviewStatus).toBe("new");
    expect(ada?.phone).toBe("+1 555 0100");
    expect(ada?.resume).toBe("https://example.com/ada.pdf");
    expect(ada?.queue?.bucket).toBe("no_evidence");
    expect(ada?.missingEvidence[0]?.kind).toBe("no_referrals");
    expect(daysBetween(ada?.createdAt ?? "", added.view.now)).toBe(0);
  });
});

function referredInput() {
  return {
    referrerId: "p-alice",
    candidateId: "p-cleo",
    conviction: 5 as const,
    confidence: 5 as const,
    relationshipDepth: 4 as const,
    evidenceType: "firsthand_work" as const,
    evidenceText: "Watched her rewrite a stuck systems problem in a day.",
  };
}

describe("council page UX pins", () => {
  test("failed actions surface a recoverable message", () => {
    expect(describeActionError(new Error("unknown referral"))).toBe("unknown referral");
    expect(describeActionError("self-referral is not allowed")).toBe(
      "self-referral is not allowed",
    );
    expect(describeActionError({})).toContain("Reset to seed");
  });

  test("referral signal bands are a coarse read, not a merged score", () => {
    expect(signalBand(100)).toBe("Very strong applicant");
    expect(signalBand(90)).toBe("Very strong applicant");
    expect(signalBand(89)).toBe("Strong applicant");
    expect(signalBand(70)).toBe("Strong applicant");
    expect(signalBand(69)).toBe("Promising applicant");
    expect(signalBand(50)).toBe("Promising applicant");
    expect(signalBand(49)).toBe("Mixed signal");
    expect(signalBand(30)).toBe("Mixed signal");
    expect(signalBand(29)).toBe("Early signal");
    expect(signalBand(7)).toBe("Early signal");
  });

  test("dial context and round rank stay on Referral Signal only", () => {
    expect(fmtDateShort("2026-01-25T00:00:00.000Z")).toBe("Jan 25");
    expect(cohortAverage([78, 62, null, 7])).toBe(49);
    expect(cohortAverage([null, null])).toBeNull();
    expect(signalContext(null, 63)).toBe("Missing evidence is not a score of 0.");
    expect(signalContext(63, 63)).toBe("Right at the round average of 63");
    expect(signalContext(79, 63)).toBe("16 above the round average of 63");
    expect(signalContext(50, 63)).toBe("13 below the round average of 63");
    expect(scoreRank(78, [91, 78, 54, null])).toEqual({ rank: 2, of: 3 });
    expect(scoreRank(null, [91, 78])).toBeNull();
    expect(meanConviction([4, 3, 3, 1])).toBeCloseTo(2.75);
    expect(meanConviction([])).toBeNull();
  });

  test("table model sorts nulls last in both directions", () => {
    const rows = [
      { id: "a", n: 5 as number | null },
      { id: "b", n: null },
      { id: "c", n: 1 as number | null },
    ];
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  test("club UI copy uses product language, hides weights, and never uses banned phrases", () => {
    const glob = new Bun.Glob("apps/club/{app,components,lib}/**/*.{ts,tsx}");
    const files = [...glob.scanSync({ cwd: root, absolute: true })];
    expect(files.length).toBeGreaterThan(5);
    const joined = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const phrase of BANNED_LANGUAGE) {
      expect(joined.includes(phrase), `club UI contains "${phrase}"`).toBe(false);
    }
    expect(joined.includes('from "../../../src/domain/constants.ts"')).toBe(true);
    for (const key of Object.keys(PRODUCT_LANGUAGE)) {
      expect(joined.includes(`PRODUCT_LANGUAGE.${key}`), `club UI unused ${key}`).toBe(true);
    }
    expect(joined.includes("SCALE_LABELS.rubricNotObserved")).toBe(true);
    expect(joined.includes("not a score of 0")).toBe(true);
    expect(joined.includes("Reset to seed")).toBe(true);
    const components = files
      .filter((f) => f.includes("/components/"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const forbidden of [
      "p̂",
      "Ē",
      "reliability.toFixed",
      "bias.toFixed",
      'type="range"',
      "transition-all",
    ]) {
      expect(components.includes(forbidden), `components contain ${forbidden}`).toBe(false);
    }
    expect(existsSync(join(root, "apps/club/components/JudgeSim.tsx"))).toBe(false);
    expect(existsSync(join(root, "apps/club/components/GraphPanel.tsx"))).toBe(false);
  });
});

describe("council page engine: the pipeline seam", () => {
  const specs = loadSpecs({}, { warn: () => {} });
  const seedModelInput = () => {
    const seed = generateSeed();
    const now = new Date(EXAMPLE_T_END);
    const t = now.getTime();
    return {
      people: seed.people,
      referrals: seed.referrals.filter((r) => r.createdAt.getTime() <= t),
      comparisons: seed.comparisons,
      outcomes: seed.outcomes,
      opportunities: seed.opportunities,
      now,
      specs,
    };
  };

  test("the club's knownPerson guard means the seed has no dangling edges", () => {
    const pass = runClubPass(seedModelInput());
    expect(pass.scored.dangling).toEqual([]);
    expect(pass.scored.policy).toBe("score");
    expect(pass.scored.specVersion).toBe(specs.referral_signal.version);
  });

  /**
   * The club's pass is `advance()`, so the numbers it reads off the runs must
   * be the numbers the hand-sequenced `compute*` calls it replaced produced —
   * V0, the calibration, V2, and the capability fit, against the same inputs.
   */
  test("pass v0/v2/calibration are the numbers the hand-sequenced compute* calls produced", () => {
    const input = seedModelInput();
    const pass = runClubPass(input);
    const v0 = computeAllReferralSignals(input.people, input.referrals, {
      spec: specs.referral_signal,
    });
    const cal = computeJudgeCalibration({
      people: input.people,
      referrals: input.referrals,
      outcomes: input.outcomes,
      opportunities: input.opportunities,
      now: input.now,
      spec: specs.judge_reliability,
      referralSpec: specs.referral_signal,
    });
    const v2 = computeAllReferralSignals(input.people, input.referrals, {
      spec: specs.referral_signal,
      ...judgeWeightOptions(cal),
    });
    const cap = computeCapabilityVectors(input.people, input.comparisons, {
      spec: specs.bradley_terry,
    });
    expect([...pass.v0.keys()]).toEqual([...v0.keys()]);
    expect([...pass.v2.keys()]).toEqual([...v2.keys()]);
    expect(pass.v0).toEqual(v0);
    expect(pass.v2).toEqual(v2);
    expect(pass.calibration).toEqual(cal);
    expect(pass.capability).toEqual(cap);
  });

  test("the pass names one run per evaluated arm and a spec version per kind", () => {
    const pass = runClubPass(seedModelInput());
    // V0 signals, capability, calibration, judge-weighted signals.
    expect(pass.provenance.modelRunIds).toHaveLength(4);
    expect(new Set(pass.provenance.modelRunIds).size).toBe(4);
    expect(pass.provenance.specVersions).toEqual({
      referral_signal: specs.referral_signal.version,
      bradley_terry: specs.bradley_terry.version,
      judge_reliability: specs.judge_reliability.version,
    });
  });

  test("every referral in the index is scored exactly once and matches referralStrength", () => {
    const input = seedModelInput();
    const pass = runClubPass(input);
    expect(pass.scored.byReferralId.size).toBe(input.referrals.length);
    for (const r of input.referrals) {
      const edge = pass.scored.byReferralId.get(r.id);
      if (!edge) throw new Error(`referral ${r.id} missing from the index`);
      expect(edge.strength).toBe(realStrength.referralStrength(r, specs.referral_signal));
    }
  });

  /**
   * The regression guard for the seam itself, in two halves so that neither
   * side can hide the other.
   *
   * The pass is pinned absolutely: `advance` scores the referral graph once
   * per Referral Signal run — the V0 baseline and the judge-weighted one —
   * plus whatever `computeJudgeCalibration` does on its own, which is
   * measured against the same inputs rather than hard-coded. Using the pass
   * as its own baseline would let a third scoring appear inside it silently.
   *
   * The view is then pinned relative to that: pre-seam, `computeView` derived
   * R_uv five ways in one pass (228 calls on the seed), two of them with an
   * O(P·R) scan per person. It now adds exactly one scoring of each referral
   * — the index every displayed strength is read from — on top of the pass.
   */
  test("the pass scores each referral once per signal run, the view once more", () => {
    const input = seedModelInput();
    const calibration = () =>
      computeJudgeCalibration({
        people: input.people,
        referrals: input.referrals,
        outcomes: input.outcomes,
        opportunities: input.opportunities,
        now: input.now,
        spec: specs.judge_reliability,
        referralSpec: specs.referral_signal,
      });

    strengthCalls = 0;
    calibration();
    const calibrationCalls = strengthCalls;

    strengthCalls = 0;
    advance(
      null,
      {
        people: input.people,
        referrals: input.referrals,
        comparisons: input.comparisons,
        outcomes: input.outcomes,
        opportunities: input.opportunities,
      },
      specs,
      input.now,
      { asOf: true, drift: false },
    );
    const passCalls = strengthCalls;
    expect(passCalls).toBe(2 * input.referrals.length + calibrationCalls);

    strengthCalls = 0;
    computeView(initialState(), specs);
    expect(strengthCalls).toBe(input.referrals.length + passCalls);
  });

  /**
   * Pins the self-referral exclusion documented at the `myReferrals` seam:
   * `scoreReferralGraph` drops u → u under V0's incoming rule, so the view has
   * no row for it and no NaN strength. `addReferral` cannot produce one
   * (`validateReferral` rejects it), hence the hand-built state.
   */
  test("a hand-built self-referral produces no referral row and no NaN strength", () => {
    const now = "2024-06-01T00:00:00.000Z";
    const earlier = "2024-05-01T00:00:00.000Z";
    const person = (id: string, name: string) => ({
      id,
      name,
      status: "member" as const,
      createdAt: earlier,
      updatedAt: earlier,
    });
    const referral = (id: string, referrerId: string, candidateId: string) => ({
      id,
      referrerId,
      candidateId,
      conviction: 4 as const,
      confidence: 4 as const,
      relationshipDepth: 3 as const,
      evidenceType: "firsthand_work" as const,
      evidenceText: "worked together on the same team for two years",
      createdAt: earlier,
      updatedAt: earlier,
    });
    const state: ClubState = {
      people: [person("p-self", "Ada"), person("p-other", "Bo")],
      referrals: [referral("r-self", "p-self", "p-self"), referral("r-real", "p-other", "p-self")],
      comparisons: [],
      evaluations: [],
      outcomes: [],
      opportunities: [],
      snapshots: [],
      feedbackRequests: [],
      config: { requiredDimensions: [...EXAMPLE_REQUIRED_DIMENSIONS] },
      now,
    };

    const view = computeView(state, specs);
    const ada = view.people.find((p) => p.id === "p-self");
    if (!ada) throw new Error("hand-built person missing from the view");
    expect(ada.referrals.map((r) => r.referralId)).toEqual(["r-real"]);
    expect(ada.incomingCount).toBe(1);
    for (const p of view.people) {
      for (const r of p.referrals) {
        expect(Number.isNaN(r.strength)).toBe(false);
      }
      for (const n of [...p.neighbourhood.referrers, ...p.neighbourhood.referred]) {
        expect(Number.isNaN(n.strength)).toBe(false);
      }
    }
  });
});
