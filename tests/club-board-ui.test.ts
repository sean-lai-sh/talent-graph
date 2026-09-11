import { describe, expect, test } from "bun:test";
import {
  comparisonCountOf,
  nextQueueId,
  readinessOf,
  sortByChip,
  sortByReadiness,
} from "../apps/club/components/board/readiness.ts";
import { loadClub } from "../apps/club/lib/engine.ts";
import type { PersonView } from "../apps/club/lib/types.ts";
import { BANNED_LANGUAGE, PRODUCT_LANGUAGE } from "../src/domain/constants.ts";

function person(partial: Partial<PersonView> & Pick<PersonView, "id" | "name">): PersonView {
  return {
    bio: "",
    affiliation: "",
    status: "candidate",
    note: null,
    persona: false,
    v0Signal: null,
    v2Signal: null,
    incomingCount: 0,
    firsthandCount: 0,
    strongest: null,
    contributing: [],
    dimensions: [],
    gaps: [],
    ...partial,
  };
}

describe("review queue readiness", () => {
  test("orders both, referrals-only, compares-only, then nothing", () => {
    const both = person({
      id: "both",
      name: "Both",
      incomingCount: 2,
      v2Signal: 12,
      dimensions: [
        {
          dimension: "taste",
          label: "taste",
          prompt: "",
          state: "estimated",
          percentile: 80,
          comparisonCount: 4,
          opponentCount: 3,
          poolSize: 6,
          poolConfidence: "low",
          reason: null,
        },
      ],
    });
    const referralsOnly = person({
      id: "ref",
      name: "Referrals",
      incomingCount: 1,
      v2Signal: 9,
      dimensions: [
        {
          dimension: "taste",
          label: "taste",
          prompt: "",
          state: "insufficient_evidence",
          percentile: null,
          comparisonCount: 0,
          opponentCount: 0,
          poolSize: null,
          poolConfidence: null,
          reason: "no comparison data",
        },
      ],
    });
    const comparesOnly = person({
      id: "cmp",
      name: "Compares",
      dimensions: [
        {
          dimension: "taste",
          label: "taste",
          prompt: "",
          state: "insufficient_evidence",
          percentile: null,
          comparisonCount: 2,
          opponentCount: 1,
          poolSize: null,
          poolConfidence: null,
          reason: "too few",
        },
      ],
    });
    const nothing = person({ id: "none", name: "Nothing" });

    const ordered = sortByReadiness([nothing, comparesOnly, both, referralsOnly]);
    expect(ordered.map((p) => p.id)).toEqual(["both", "ref", "cmp", "none"]);
    expect(readinessOf(both).tag).toBe("Ready");
    expect(readinessOf(referralsOnly).tag).toBe("Needs compares");
    expect(readinessOf(comparesOnly).tag).toBe("Needs referrals");
    expect(readinessOf(nothing).tag).toBe("Needs referrals");
  });

  test("does not invent a numeric readiness score or merge the two measures", () => {
    const { view } = loadClub();
    const cleo = view.people.find((p) => p.id === "p-cleo");
    if (!cleo) throw new Error("expected Cleo");
    const ready = readinessOf(cleo);
    expect(ready).not.toHaveProperty("score");
    expect(typeof ready.rank).toBe("number");
    expect(comparisonCountOf(cleo)).toBeGreaterThanOrEqual(0);
    expect(PRODUCT_LANGUAGE.referralSignal).toBe("Referral Signal");
    expect(PRODUCT_LANGUAGE.relativeCapability).toBe("Relative Capability Estimate");
    for (const phrase of BANNED_LANGUAGE) {
      expect(JSON.stringify(ready)).not.toContain(phrase);
    }
  });

  test("sort chips use one axis each and never a merged score", () => {
    const quiet = person({ id: "q", name: "Quiet", incomingCount: 1, v2Signal: 7 });
    const loud = person({ id: "l", name: "Loud", incomingCount: 4, v2Signal: 62 });
    const created = new Map([
      ["q", "2024-02-01T00:00:00.000Z"],
      ["l", "2024-01-01T00:00:00.000Z"],
    ]);
    expect(sortByChip([quiet, loud], "loudest", created).map((p) => p.id)).toEqual(["l", "q"]);
    expect(sortByChip([quiet, loud], "newest", created).map((p) => p.id)).toEqual(["q", "l"]);
  });

  test("accepting a row points at the next queue id", () => {
    expect(nextQueueId([{ id: "a" }, { id: "b" }, { id: "c" }], "a")).toBe("b");
    expect(nextQueueId([{ id: "a" }, { id: "b" }, { id: "c" }], "c")).toBe("b");
    expect(nextQueueId([{ id: "a" }], "a")).toBe("");
  });
});
