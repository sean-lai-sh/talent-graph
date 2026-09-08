import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "../src/domain/constants.ts";
import {
  validateComparison,
  validateEvaluation,
  validateReferral,
} from "../src/domain/validate.ts";
import { generateSeed } from "../src/seed/generate.ts";
import { PERSONAS } from "../src/seed/personaShapes.ts";
import { PERSONA_IDS, PERSONA_PROFILES } from "../src/seed/personas.ts";
import { gaussian, int, mulberry32, pick, shuffle } from "../src/seed/prng.ts";

const data = generateSeed();

function comparisonsOf(id: string) {
  return data.comparisons.filter((c) => c.personAId === id || c.personBId === id);
}

describe("prng", () => {
  test("mulberry32 is deterministic and in [0,1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  test("helpers respect bounds", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const n = int(rng, 3, 5);
      expect(n >= 3 && n <= 5 && Number.isInteger(n)).toBe(true);
    }
    expect(["x", "y"]).toContain(pick(rng, ["x", "y"]));
    expect(shuffle(rng, [1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
    expect(Number.isFinite(gaussian(rng))).toBe(true);
  });
});

describe("generateSeed", () => {
  test("same seed ⇒ deep-equal dataset; different seed ⇒ differs", () => {
    expect(generateSeed({ seed: 42 })).toEqual(generateSeed({ seed: 42 }));
    expect(generateSeed({ seed: 43 })).not.toEqual(data);
  });

  test("counts meet minimums and all dimensions are present", () => {
    expect(data.people.length).toBeGreaterThanOrEqual(25);
    expect(data.referrals.length).toBeGreaterThanOrEqual(40);
    expect(data.comparisons.length).toBeGreaterThanOrEqual(100);
    expect(data.evaluations.length).toBeGreaterThanOrEqual(20);
    const dims = new Set(data.comparisons.map((c) => c.dimension));
    for (const d of DIMENSIONS) expect(dims.has(d)).toBe(true);
  });

  test("status mix: some members, 1–2 archived, rest candidates", () => {
    const members = data.people.filter((p) => p.status === "member").length;
    const archived = data.people.filter((p) => p.status === "archived").length;
    expect(members).toBeGreaterThanOrEqual(6);
    expect(archived >= 1 && archived <= 2).toBe(true);
  });

  test("every record passes the domain validators", () => {
    for (const r of data.referrals) {
      const res = validateReferral(r, data.referrals);
      expect(res).toEqual({ ok: true });
    }
    for (const c of data.comparisons) expect(validateComparison(c)).toEqual({ ok: true });
    for (const e of data.evaluations) expect(validateEvaluation(e)).toEqual({ ok: true });
  });

  test("ids are unique and dates deterministic from the base", () => {
    const ids = [
      ...data.people.map((p) => p.id),
      ...data.referrals.map((r) => r.id),
      ...data.comparisons.map((c) => c.id),
      ...data.evaluations.map((e) => e.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of data.referrals)
      expect(r.createdAt.getTime() >= Date.UTC(2026, 0, 1)).toBe(true);
  });

  test("personas exist with the required shapes", () => {
    for (const id of PERSONA_IDS) expect(data.people.some((p) => p.id === id)).toBe(true);

    const incoming = (id: string) => data.referrals.filter((r) => r.candidateId === id);
    expect(incoming("p-alice")).toHaveLength(4);
    expect(incoming("p-cleo")).toHaveLength(1);
    expect(incoming("p-cleo")[0]?.evidenceType).toBe("reputation");
    expect(incoming("p-dev")).toHaveLength(1);
    expect(incoming("p-dev")[0]).toMatchObject({
      conviction: 5,
      confidence: 5,
      relationshipDepth: 5,
      evidenceType: "firsthand_work",
    });
    expect(incoming("p-ember")).toHaveLength(6);

    expect(comparisonsOf("p-fox").filter((c) => c.dimension === "generativity")).toHaveLength(0);
    expect(
      comparisonsOf("p-fox").filter((c) => c.dimension === "problem_solving").length,
    ).toBeGreaterThanOrEqual(10);
    expect(comparisonsOf("p-dev").length).toBeLessThanOrEqual(2);
    expect(comparisonsOf("p-dev").length).toBeGreaterThanOrEqual(1);
    expect(comparisonsOf("p-cleo").length).toBeGreaterThanOrEqual(15);
    expect(comparisonsOf("p-alice").length).toBeGreaterThanOrEqual(15);
  });

  test("outcome mix includes skip / insufficient_observation / tie", () => {
    const outcomes = new Set(data.comparisons.map((c) => c.outcome));
    expect(outcomes.has("tie")).toBe(true);
    expect(outcomes.has("skip") || outcomes.has("insufficient_observation")).toBe(true);
    expect(data.evaluations.some((e) => e.score === null)).toBe(true);
  });

  test("no hidden ability leaks into the dataset", () => {
    const json = JSON.stringify(data);
    expect(json).not.toContain("theta");
    expect(json).not.toContain("trueTheta");
  });

  test("persona profiles carry display data only; shapes align with them", () => {
    expect(PERSONA_IDS).toEqual(PERSONA_PROFILES.map((p) => p.id));
    expect(PERSONAS.map((p) => p.id)).toEqual([...PERSONA_IDS]);
    for (const p of PERSONA_PROFILES) {
      expect(Object.keys(p).sort()).toEqual(["affiliation", "bio", "id", "name"]);
      const person = data.people.find((x) => x.id === p.id);
      expect(person).toMatchObject({ name: p.name, affiliation: p.affiliation, bio: p.bio });
    }
    expect(PERSONAS.every((p) => "trueTheta" in p && "referrals" in p)).toBe(true);
  });
});
