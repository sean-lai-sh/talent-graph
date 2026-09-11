import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeActionError } from "../apps/club/lib/actionError.ts";
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
import { rankAmong, rankLabel, relativeRankText } from "../apps/club/lib/format.ts";
import {
  availableDecisions,
  daysBetween,
  FEEDBACK_WINDOW_HOURS,
  feedbackState,
  nextReviewStatus,
  statusForReview,
} from "../apps/club/lib/review.ts";
import {
  CASE_DECISION_BAR,
  CASE_OPEN_AFTER_IDENTITY,
  caseOpenPath,
  OPEN_REVIEWERS_PAGE,
} from "../apps/club/lib/reviewLoop.ts";
import { sortRows } from "../apps/club/lib/tableModel.ts";
import { loadSpecs } from "../src/config.ts";
import { BANNED_LANGUAGE, PRODUCT_LANGUAGE, SCALE_LABELS } from "../src/domain/constants.ts";
import { TRACK_RECORD_ORDER } from "../src/judges/trackRecord.ts";
import { generateSeed } from "../src/seed/generate.ts";

const root = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

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
    const source = read("apps/club/lib/engine.ts");
    expect(source).toContain("referralsAsOf");
    expect(source).toContain("createdAt.getTime() <= t");
    expect(source).toContain("loadSpecs()");
    expect(source).not.toContain("CURRENT_SPECS");
    expect(source).not.toContain("Date.UTC(2026");
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

describe("review-loop display (SEA-13/14/15)", () => {
  test("relative ranks: 1 is best, last place is not Insufficient Evidence, null is", () => {
    expect(rankAmong(100, 6)).toBe(1);
    expect(rankAmong(0, 6)).toBe(6);
    expect(rankLabel(100, 6)).toBe("1st of 6");
    expect(relativeRankText(80, 6, "Agency")).toBe("2nd of 6 on Agency");
    expect(relativeRankText(0, 6, "Agency")).toBe("6th of 6 on Agency");
    expect(relativeRankText(null, 6, "Agency")).toBe(PRODUCT_LANGUAGE.insufficientEvidence);
    expect(relativeRankText(50, null, "Agency")).toBe(PRODUCT_LANGUAGE.insufficientEvidence);
    expect(relativeRankText(null, null)).toBe(PRODUCT_LANGUAGE.insufficientEvidence);
    expect(relativeRankText(null, null)).not.toBe("0");
    expect(relativeRankText(0, 6)).not.toBe("0");
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    const agency = cleo.dimensions.find((d) => d.dimension === "agency");
    expect(relativeRankText(agency?.percentile, agency?.poolSize, agency?.label)).toBe(
      "1st of 4 on Agency",
    );
    const ife = personNamed(view, "Ife Doyle");
    const ifeAgency = ife.dimensions.find((d) => d.dimension === "agency");
    expect(ifeAgency?.state).toBe("insufficient_evidence");
    expect(relativeRankText(ifeAgency?.percentile, ifeAgency?.poolSize, ifeAgency?.label)).toBe(
      PRODUCT_LANGUAGE.insufficientEvidence,
    );
    expect(String(ifeAgency?.percentile ?? PRODUCT_LANGUAGE.insufficientEvidence)).not.toBe("0");
  });

  test("CaseView opens on evaluator feedback; ranks and channel hero are off the open path", () => {
    const { view } = loadClub();
    const cleo = personNamed(view, "Cleo Marsh");
    const path = caseOpenPath(cleo);
    expect(path.afterIdentity[0]).toBe("evaluator_feedback");
    expect(path.afterIdentity).toEqual([...CASE_OPEN_AFTER_IDENTITY]);
    expect(path.ranksOnOpenPath).toBe(false);
    expect(path.decisionBar).toBe(CASE_DECISION_BAR);
    expect(path.reviewers.length).toBeGreaterThan(0);
    expect(path.reviewers.length).toBeGreaterThanOrEqual(1);
    const first = path.reviewers[0];
    if (!first) throw new Error("expected a reviewer on Cleo");
    expect(first.blocks[0]?.kind).toBe("evidence");
    if (first.blocks[0]?.kind !== "evidence") throw new Error("expected evidence first");
    expect(first.blocks[0].text.length).toBeGreaterThan(0);
    expect(first.blocks.at(-1)?.kind).toBe("who");
    expect(first.blocks.findIndex((b) => b.kind === "evidence")).toBeLessThan(
      first.blocks.findIndex((b) => b.kind === "who"),
    );
    for (const reviewer of path.reviewers) {
      const evidenceAt = reviewer.blocks.findIndex((b) => b.kind === "evidence");
      const whoAt = reviewer.blocks.findIndex((b) => b.kind === "who");
      expect(evidenceAt).toBe(0);
      expect(whoAt).toBeGreaterThan(evidenceAt);
    }

    const src = read("apps/club/components/case/CaseView.tsx");
    const scrollAt = src.indexOf("data-case-scroll");
    const barAt = src.indexOf(`data-decision-bar={CASE_DECISION_BAR}`);
    const reviewsAt = src.indexOf("<Reviews");
    const moreAt = src.indexOf("<details");
    const channelAt = src.indexOf("<ChannelSummary");
    expect(scrollAt).toBeGreaterThan(0);
    expect(reviewsAt).toBeGreaterThan(scrollAt);
    expect(moreAt).toBeGreaterThan(reviewsAt);
    expect(channelAt).toBeGreaterThan(moreAt);
    expect(barAt).toBeGreaterThan(moreAt);
    expect(src.indexOf("<NeighbourhoodPane")).toBeGreaterThan(moreAt);
    expect(src.indexOf("<ComparisonsPane")).toBeGreaterThan(moreAt);
    expect(src.indexOf("<DecisionContext")).toBeGreaterThan(moreAt);

    const scrollPane = src.slice(scrollAt, barAt);
    expect(scrollPane).toContain("overflow-y-auto");
    expect(scrollPane).toContain("<Reviews");
    expect(scrollPane).toContain("openByDefault");
    expect(scrollPane).toContain("<details");
    expect(scrollPane).toMatch(/<summary[\s\S]*?>\s*More\s*<\/summary>/);
    expect(scrollPane).toContain("<ChannelSummary");
    expect(scrollPane).not.toContain("relativeRankText");
    expect(scrollPane).not.toContain("Need more");
    expect(scrollPane).not.toContain("DECISION_COPY");

    const bar = src.slice(barAt, src.indexOf("<Sheet"));
    expect(bar).toContain("shrink-0");
    expect(bar).toContain("Need more");
    expect(bar).toContain("Request feedback");
    expect(bar).not.toContain("overflow-y-auto");
    expect(bar).not.toContain("<Reviews");
    expect(bar).not.toContain("<details");
    expect(src).toContain('data-case-layout="scroll-plus-bar"');
    expect(src).not.toContain("sticky bottom-0");
    expect(src).not.toContain("relativeRankText");
    expect(src).not.toContain("JudgeSim");
    expect(src).not.toContain("meddle");

    const board = read("apps/club/components/ClubBoard.tsx");
    expect(board).toContain("h-dvh");
    expect(board).toContain("overflow-hidden");
    expect(board).toContain("flex-col overflow-hidden");

    const reviews = read("apps/club/components/case/Evidence.tsx");
    const openCardAt = reviews.indexOf("data-reviewer-open");
    const opinionAt = reviews.indexOf("<Opinion", openCardAt);
    const whoAt = reviews.indexOf("<WhoRow", opinionAt);
    expect(openCardAt).toBeGreaterThan(0);
    expect(opinionAt).toBeGreaterThan(openCardAt);
    expect(whoAt).toBeGreaterThan(opinionAt);
    expect(reviews).toContain("TRACK_RECORD_COPY");
    expect(reviews).toContain("Evaluator feedback");
    expect(reviews).toContain("defaultOpen");
    expect(reviews).toContain("OPEN_REVIEWERS_PAGE");
    expect(OPEN_REVIEWERS_PAGE).toBe(5);
    expect(reviews).not.toContain("JudgeSim");
    expect(reviews).not.toContain("meddle");
  });

  test("queue defaults are lean and list ranks use peer-order copy, not percentiles", () => {
    const list = read("apps/club/components/candidates/CandidateList.tsx");
    const board = read("apps/club/components/ClubBoard.tsx");
    expect(list).toContain("Who to review next");
    expect(list).toContain('dimension: "agency"');
    expect(list).toContain("To review");
    expect(list).toContain("Hide filters");
    expect(list).toContain("relativeRankText");
    expect(list).not.toContain("Dimension percentile");
    expect(list).not.toContain("signalText");
    expect(board).toContain("DEFAULT_SORT");
  });
});

describe("council page UX pins", () => {
  test("failed actions surface a recoverable message", () => {
    expect(describeActionError(new Error("unknown referral"))).toBe("unknown referral");
    expect(describeActionError("self-referral is not allowed")).toBe(
      "self-referral is not allowed",
    );
    expect(describeActionError({})).toContain("Reset to seed");
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
