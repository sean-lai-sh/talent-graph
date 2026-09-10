import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addPerson,
  addReferral,
  computeView,
  EXAMPLE_T_END,
  emptyState,
  initialState,
  setStatus,
} from "../apps/club/lib/engine.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("SEA-10 Convex persistence path", () => {
  test("empty club compute, then members / referrals / status round-trip via engine", () => {
    const start = emptyState();
    expect(start.people).toEqual([]);
    expect(start.referrals).toEqual([]);
    expect(start.now).toBe(EXAMPLE_T_END);

    const emptyView = computeView(start);
    expect(emptyView.counts.people).toBe(0);
    expect(emptyView.counts.referrals).toBe(0);
    expect(emptyView.counts.members).toBe(0);

    const ada = addPerson(start, { name: "Ada Cole" });
    expect(ada.error).toBeUndefined();
    expect(ada.state.people).toHaveLength(1);
    expect(ada.view.counts.people).toBe(1);
    expect(ada.view.people[0]?.status).toBe("candidate");
    const adaId = ada.state.people[0]?.id;
    if (!adaId) throw new Error("expected Ada id");

    const bea = addPerson(ada.state, { name: "Bea Shah" });
    expect(bea.error).toBeUndefined();
    const beaId = bea.state.people.find((p) => p.name === "Bea Shah")?.id;
    if (!beaId) throw new Error("expected Bea id");

    const referred = addReferral(bea.state, {
      referrerId: adaId,
      candidateId: beaId,
      conviction: 5,
      confidence: 4,
      relationshipDepth: 3,
      evidenceType: "firsthand_work",
      evidenceText: "Shipped together.",
    });
    expect(referred.error).toBeUndefined();
    expect(referred.state.referrals).toHaveLength(1);
    expect(referred.view.counts.referrals).toBe(1);
    const beaView = referred.view.people.find((p) => p.id === beaId);
    expect(beaView?.incomingCount).toBe(1);
    expect(beaView?.v2Signal).not.toBeNull();

    const accepted = setStatus(referred.state, beaId, "member");
    expect(accepted.error).toBeUndefined();
    expect(accepted.state.people.find((p) => p.id === beaId)?.status).toBe("member");
    expect(accepted.view.counts.members).toBe(1);
    expect(accepted.state.snapshots[0]?.decision).toBe("member");
    expect(accepted.state.snapshots[0]?.personName).toBe("Bea Shah");
    expect(accepted.view.people.find((p) => p.id === beaId)?.v2Signal).toBe(beaView?.v2Signal);
  });

  test("addPerson rejects a blank name and does not invent a person", () => {
    const start = emptyState();
    const result = addPerson(start, { name: "   " });
    expect(result.error).toBe("name required");
    expect(result.state.people).toHaveLength(0);
    expect(result.view.counts.people).toBe(0);
  });

  test("example seed path is unchanged and does not go through Convex", () => {
    const seed = initialState();
    expect(seed.people.length).toBeGreaterThan(6);
    expect(seed.people.some((p) => p.id === "p-cleo")).toBe(true);
    const engine = read("apps/club/lib/engine.ts");
    expect(engine).toContain("generateSeed()");
    expect(engine).toContain("emptyState");
    expect(engine).toContain("addPerson");
    expect(engine).not.toContain("convex");
    expect(engine).not.toContain("better-auth");
  });

  test("/club wires Convex queries and mutations; example routes stay seed", () => {
    const home = read("apps/club/app/page.tsx");
    const example = read("apps/club/app/example/page.tsx");
    const shell = read("apps/club/app/club/ClubShell.tsx");
    const persisted = read("apps/club/app/club/PersistedClub.tsx");
    const club = read("apps/club/convex/club.ts");

    for (const source of [home, example]) {
      expect(source).toContain("loadClub()");
      expect(source).not.toContain("PersistedClub");
      expect(source).not.toContain("api.club");
    }
    expect(shell).toContain("configured ? <PersistedClub");
    expect(shell).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(persisted).toContain("api.club.getBoard");
    expect(persisted).toContain("api.club.addPerson");
    expect(persisted).toContain("api.club.setStatus");
    expect(persisted).toContain("api.club.addReferral");
    expect(persisted).toContain('variant="club"');
    expect(club).toContain("computeView(state)");
    expect(club).toContain("setStatusEngine");
    expect(club).toContain("addReferralEngine");
    expect(club).toContain("addPersonEngine");
  });
});
