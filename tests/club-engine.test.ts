import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeActionError } from "../apps/club/lib/actionError.ts";
import {
  addComparison,
  addReferral,
  computeView,
  EXAMPLE_T_END,
  EXAMPLE_T_START,
  exampleTimeSteps,
  initialState,
  loadClub,
  meddleReferral,
  resetClub,
  setNow,
  setStatus,
} from "../apps/club/lib/engine.ts";
import {
  nodeRadius,
  OTHER_GRAPH_LIMIT,
  selectGraphNodes,
  UNMEASURED_NODE_RADIUS,
} from "../apps/club/lib/graphLayout.ts";
import { loadSpecs } from "../src/config.ts";
import { BANNED_LANGUAGE, PRODUCT_LANGUAGE, SCALE_LABELS } from "../src/domain/constants.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";
import { generateSeed } from "../src/seed/generate.ts";

describe("example club engine", () => {
  test("seed view pins Cleo quiet, Bram loud, and never emits a single accept score", () => {
    const { view } = loadClub();
    const personas = view.people.filter((p) => p.persona);
    expect(personas.map((p) => p.id).sort()).toEqual(
      ["p-alice", "p-bram", "p-cleo", "p-dev", "p-ember", "p-fox"].sort(),
    );

    const cleo = view.people.find((p) => p.id === "p-cleo");
    const bram = view.people.find((p) => p.id === "p-bram");
    if (!cleo) throw new Error("expected Cleo on the seed");
    if (!bram) throw new Error("expected Bram on the seed");
    expect(cleo.v2Signal).toBe(7);
    expect(cleo.incomingCount).toBe(1);
    expect(bram.v2Signal).toBe(62);
    expect(bram.incomingCount).toBe(4);
    expect(view.topReferral.some((row) => row.personId === "p-cleo" && row.signal === 7)).toBe(
      true,
    );
    expect(view.topReferral.some((row) => row.personId === "p-bram" && row.signal === 62)).toBe(
      true,
    );
    expect(
      view.topReferral.filter((row) => row.signal <= 20).some((row) => row.personId === "p-cleo"),
    ).toBe(true);
    expect(view.graph.nodes.find((n) => n.id === "p-cleo")?.v2Signal).toBe(7);
    expect(view.graph.nodes.find((n) => n.id === "p-bram")?.v2Signal).toBe(62);

    expect(view.topReferral.length).toBeGreaterThan(0);
    expect(view.topCapability.length).toBeGreaterThan(0);
    expect(view.now).toBe(EXAMPLE_T_END);
    expect(JSON.stringify(view)).not.toContain("Talent Score");
    expect(JSON.stringify(view)).not.toContain("Capability Score");
  });

  test("zero incoming is Insufficient Evidence, not Referral Signal 0", () => {
    const { view } = loadClub();
    const zero = view.people.filter((p) => p.incomingCount === 0);
    expect(zero.length).toBeGreaterThan(0);
    for (const person of zero) {
      expect(person.v2Signal).toBeNull();
      expect(person.v0Signal).toBeNull();
    }
    const ife = view.people.find((p) => p.name === "Ife Doyle");
    const noor = view.people.find((p) => p.name === "Noor Petrov");
    if (!ife) throw new Error("expected Ife Doyle on the seed");
    if (!noor) throw new Error("expected Noor Petrov on the seed");
    expect(ife.incomingCount).toBe(0);
    expect(noor.incomingCount).toBe(0);
    expect(ife.v2Signal).toBeNull();
    expect(noor.v2Signal).toBeNull();
    expect(view.topReferral.every((row) => row.incomingCount >= 1)).toBe(true);
    expect(
      view.graph.nodes.filter((n) => n.incomingCount === 0).every((n) => n.v2Signal === null),
    ).toBe(true);
  });

  test("Fox Agency is insufficient evidence; gaps carry both V2 inputs", () => {
    const { view } = loadClub();
    const fox = view.people.find((p) => p.id === "p-fox");
    if (!fox) throw new Error("expected Fox on the seed");
    expect(fox.dimensions.find((d) => d.dimension === "agency")?.state).toBe(
      "insufficient_evidence",
    );
    expect(view.underRecognized.length).toBeGreaterThan(0);
    for (const row of view.underRecognized) {
      expect(typeof row.capabilityPercentile).toBe("number");
      expect(typeof row.referralPercentile).toBe("number");
      expect(row.tag).toBe("exploratory");
    }
  });

  test("load and reset match generateSeed identity", () => {
    const seed = generateSeed();
    const loaded = loadClub();
    const reset = resetClub();
    expect(loaded.state.people.map((p) => p.id)).toEqual(seed.people.map((p) => p.id));
    expect(loaded.state.referrals.map((r) => r.id)).toEqual(seed.referrals.map((r) => r.id));
    expect(reset.state.people.map((p) => p.id)).toEqual(seed.people.map((p) => p.id));
    expect(reset.state.referrals.map((r) => r.id)).toEqual(seed.referrals.map((r) => r.id));
    expect(reset.view.people.find((p) => p.id === "p-cleo")?.v2Signal).toBe(7);
  });

  test("at the start of the year V2 equals V0; by year end some signals move", () => {
    const state = initialState();
    const early = computeView({ ...state, now: EXAMPLE_T_START });
    expect(early.windowOpen).toBe(false);
    expect(early.evaluatedReferrals).toBe(0);
    for (const p of early.people.filter((row) => row.persona)) {
      expect(p.v2Signal).toBe(p.v0Signal);
    }

    const late = computeView({ ...state, now: EXAMPLE_T_END });
    expect(late.windowOpen).toBe(true);
    expect(late.evaluatedReferrals).toBeGreaterThan(0);
    expect(late.judgesWithEvidence).toBeGreaterThan(0);
    const moved = late.people.filter((p) => p.persona && p.v2Signal !== p.v0Signal);
    expect(moved.length).toBeGreaterThan(0);
  });

  test("accepting a candidate records a snapshot without changing scores", () => {
    const start = loadClub();
    const cleo = start.view.people.find((p) => p.id === "p-cleo");
    expect(cleo?.status).toBe("candidate");
    const after = setStatus(start.state, "p-cleo", "member");
    expect(after.view.people.find((p) => p.id === "p-cleo")?.status).toBe("member");
    expect(after.view.counts.members).toBe(start.view.counts.members + 1);
    expect(after.state.snapshots[0]?.decision).toBe("member");
    expect(after.state.snapshots[0]?.personName).toBe("Cleo Marsh");
    expect(after.state.snapshots[0]?.values.referralSignal).toBe(7);
    expect(after.state.snapshots[0]?.values.incomingCount).toBe(1);
    expect(after.view.snapshots[0]?.decision).toBe("member");
    expect(after.view.people.find((p) => p.id === "p-cleo")?.v2Signal).toBe(cleo?.v2Signal);
  });

  test("meddling a referral slider changes Referral Signal and does not bump updatedAt", () => {
    const start = loadClub();
    const alice = start.view.people.find((p) => p.id === "p-alice");
    if (!alice) throw new Error("expected Alice on the seed");
    const first = alice.contributing[0];
    if (!first) throw new Error("expected Alice to have a contributing referral");
    const before = start.state.referrals.find((r) => r.id === first.referralId);
    if (!before) throw new Error("expected the contributing referral in state");
    const after = meddleReferral(start.state, first.referralId, {
      conviction: 1,
      confidence: 1,
      relationshipDepth: 1,
    });
    expect(after.error).toBeUndefined();
    const row = after.state.referrals.find((r) => r.id === first.referralId);
    expect(row?.updatedAt).toBe(before.updatedAt);
    expect(after.view.people.find((p) => p.id === "p-alice")?.v2Signal).not.toBe(alice.v2Signal);
  });

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
    const applied = referred.error
      ? addReferral(start.state, {
          referrerId: "p-fox",
          candidateId: "p-dev",
          conviction: 5,
          confidence: 4,
          relationshipDepth: 3,
          evidenceType: "artifact",
          evidenceText: "Read the work. It is unusually careful.",
        })
      : referred;
    expect(applied.error).toBeUndefined();
    expect(applied.view.counts.referrals).toBe(start.view.counts.referrals + 1);

    const pair = applied.view.nextCompare;
    if (!pair) throw new Error("expected a proposed compare");
    const compared = addComparison(applied.state, {
      personAId: pair.personAId,
      personBId: pair.personBId,
      dimension: pair.dimension,
      outcome: "a",
    });
    expect(compared.error).toBeUndefined();
    expect(compared.view.counts.comparisons).toBe(applied.view.counts.comparisons + 1);
  });

  test("setNow is a pure time-step change", () => {
    const start = loadClub();
    const early = setNow(start.state, EXAMPLE_T_START);
    expect(early.view.now).toBe(EXAMPLE_T_START);
    expect(early.view.evaluatedReferrals).toBe(0);
  });

  test("graph nodes with no incoming evidence are not painted as signal 0", () => {
    const { view } = loadClub();
    const ife = view.graph.nodes.find((n) => n.name === "Ife Doyle");
    const cleo = view.graph.nodes.find((n) => n.id === "p-cleo");
    const bram = view.graph.nodes.find((n) => n.id === "p-bram");
    if (!ife || !cleo || !bram) throw new Error("expected Ife, Cleo, and Bram on the graph");
    expect(ife.v2Signal).toBeNull();
    expect(nodeRadius(ife, false)).toBe(UNMEASURED_NODE_RADIUS);
    expect(nodeRadius({ v2Signal: 0 }, false)).toBe(7);
    expect(nodeRadius(ife, false)).not.toBe(nodeRadius({ v2Signal: 0 }, false));
    expect(nodeRadius(ife, false)).not.toBe(nodeRadius(cleo, false));
    expect(nodeRadius(cleo, false)).toBeLessThan(nodeRadius(bram, false));
    expect(nodeRadius(ife, false)).toBeGreaterThan(nodeRadius(cleo, false));
  });

  test("graph edges use real R_uv and mark TopK-dropped referrals", () => {
    const { view } = loadClub();
    const ember = view.people.find((p) => p.id === "p-ember");
    if (!ember) throw new Error("expected Ember on the seed");
    expect(ember.incomingCount).toBe(6);
    expect(ember.contributing).toHaveLength(5);
    const edges = view.graph.edges.filter((e) => e.to === "p-ember");
    expect(edges).toHaveLength(6);
    expect(edges.filter((e) => e.contributing)).toHaveLength(5);
    const dropped = edges.filter((e) => !e.contributing);
    expect(dropped).toHaveLength(1);
    const droppedEdge = dropped[0];
    if (!droppedEdge) throw new Error("expected a dropped Ember edge");
    const pair = generateSeed().referrals.find(
      (r) => r.referrerId === droppedEdge.from && r.candidateId === "p-ember",
    );
    if (!pair) throw new Error("expected the dropped Ember referral in the seed");
    expect(droppedEdge.strength).toBe(referralStrength(pair));
    expect(droppedEdge.strength).not.toBe(0.4);
  });

  test("exampleTimeSteps follows EXAMPLE_T_* and the judge panel shares one clock", () => {
    const steps = exampleTimeSteps();
    expect(steps[0]).toBe(EXAMPLE_T_START);
    expect(steps[steps.length - 1]).toBe(EXAMPLE_T_END);
    expect(steps).toContain(
      new Date(
        Date.UTC(
          new Date(EXAMPLE_T_START).getUTCFullYear(),
          new Date(EXAMPLE_T_START).getUTCMonth() + 1,
          1,
        ),
      ).toISOString(),
    );
    const source = readFileSync(join(import.meta.dir, "../apps/club/lib/engine.ts"), "utf8");
    expect(source).not.toContain("Date.UTC(2026");
    expect(source).toContain("loadSpecs()");
    expect(source).not.toContain("CURRENT_SPECS");

    const { view } = loadClub();
    expect(view.timeline.map((f) => f.now)).toEqual(steps);
    const first = view.timeline[0];
    const last = view.timeline[view.timeline.length - 1];
    if (!first || !last) throw new Error("expected timeline frames");
    expect(first.judges).toEqual([]);
    expect(last.judges.map((j) => [j.judgeId, j.reliability, j.evaluatedCount])).toEqual(
      view.judges.map((j) => [j.judgeId, j.reliability, j.evaluatedCount]),
    );
    const judgeSim = readFileSync(
      join(import.meta.dir, "../apps/club/components/JudgeSim.tsx"),
      "utf8",
    );
    expect(judgeSim).toContain("frame.judges");
    expect(judgeSim).not.toContain("view.judges");
  });

  test("club view applies loadSpecs TG_* the same way as the CLI", () => {
    const state = initialState();
    const tightened = loadSpecs({ TG_TOP_K_REFERRALS: "1" }, { warn: () => {} });
    const view = computeView(state, tightened);
    const ember = view.people.find((p) => p.id === "p-ember");
    if (!ember) throw new Error("expected Ember on the seed");
    expect(ember.contributing).toHaveLength(1);
    expect(view.graph.edges.filter((e) => e.to === "p-ember" && e.contributing)).toHaveLength(1);
    expect(view.graph.edges.filter((e) => e.to === "p-ember" && !e.contributing)).toHaveLength(5);
  });

  test("judge timeline is live: first frame V2=V0, last frame moves, meddling changes it", () => {
    const start = loadClub();
    expect(start.view.timeline.length).toBeGreaterThan(2);
    const first = start.view.timeline[0];
    const last = start.view.timeline[start.view.timeline.length - 1];
    if (!first) throw new Error("expected a first timeline frame");
    if (!last) throw new Error("expected a last timeline frame");
    expect(first.windowOpen).toBe(false);
    expect(first.evaluatedReferrals).toBe(0);
    for (const p of first.personas) expect(p.v2).toBe(p.v0);
    expect(last.windowOpen).toBe(true);
    expect(last.personas.some((p) => p.v2 !== p.v0)).toBe(true);

    const alice = start.view.people.find((p) => p.id === "p-alice");
    const referralId = alice?.contributing[0]?.referralId;
    if (!referralId) throw new Error("expected Alice to have a contributing referral");
    const meddled = meddleReferral(start.state, referralId, {
      conviction: 1,
      confidence: 1,
      relationshipDepth: 1,
    });
    const before = last.personas.find((p) => p.id === "p-alice")?.v2;
    const after = meddled.view.timeline[meddled.view.timeline.length - 1]?.personas.find(
      (p) => p.id === "p-alice",
    )?.v2;
    expect(after).not.toBe(before);
  });
});

describe("example club UX pins", () => {
  test("failed actions surface a recoverable message", () => {
    expect(describeActionError(new Error("unknown referral"))).toBe("unknown referral");
    expect(describeActionError("self-referral is not allowed")).toBe(
      "self-referral is not allowed",
    );
    expect(describeActionError({})).toContain("Reset to seed");
  });

  test("personas-off keeps personas plus a short outer ring, not a hairball", () => {
    const { view } = loadClub();
    const only = selectGraphNodes(view.graph.nodes, true);
    const all = selectGraphNodes(view.graph.nodes, false);
    expect(only.map((n) => n.id)).toEqual([
      "p-alice",
      "p-bram",
      "p-cleo",
      "p-dev",
      "p-ember",
      "p-fox",
    ]);
    expect(view.graph.nodes.length).toBeGreaterThan(18);
    expect(all.length).toBeLessThanOrEqual(6 + OTHER_GRAPH_LIMIT);
    expect(all.filter((n) => n.persona).length).toBe(6);
    expect(all.some((n) => !n.persona)).toBe(true);
  });

  test("club UI copy uses product language and never banned phrases", () => {
    const root = join(import.meta.dir, "..");
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
    expect(SCALE_LABELS.rubricNotObserved).toBe("not observed");
  });
});
