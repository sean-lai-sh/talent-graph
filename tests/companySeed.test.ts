import { describe, expect, test } from "bun:test";
import {
  COMPANY_SEED,
  type CompanySeed,
  companyByOrg,
  companySeedHash,
  normalizeOrgName,
  PINNED_COMPANY_SEED_HASH,
} from "../src/longitudinal/companySeed.ts";
import { SYNTHETIC_COMPANY_SEED } from "./fixtures/companySeed.synthetic.ts";

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).reverse()) {
      out[key] = reverseKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe("company seed", () => {
  test("the seed hash is pinned, and key order does not change it", () => {
    expect(companySeedHash()).toBe(PINNED_COMPANY_SEED_HASH);
    const reordered = reverseKeys(structuredClone(COMPANY_SEED)) as CompanySeed;
    expect(companySeedHash(reordered)).toBe(PINNED_COMPANY_SEED_HASH);
  });

  test("editing a seed field changes the hash", () => {
    const hash = companySeedHash();

    const renamed = structuredClone(COMPANY_SEED);
    renamed.investors[0]!.name = "Other Name";
    expect(companySeedHash(renamed)).not.toBe(hash);

    const retiered = structuredClone(COMPANY_SEED);
    retiered.investors[0]!.tier = 1;
    expect(companySeedHash(retiered)).not.toBe(hash);

    const sourced = structuredClone(COMPANY_SEED);
    sourced.investors[1]!.source = "https://example.invalid/other";
    expect(companySeedHash(sourced)).not.toBe(hash);

    const rated = structuredClone(COMPANY_SEED);
    const rate = rated.investors[0]?.publishedRates[0];
    if (!rate) throw new Error("expected the YC rate");
    rate.rate = 0.5;
    expect(companySeedHash(rated)).not.toBe(hash);

    const northwind = SYNTHETIC_COMPANY_SEED.companies[0];
    if (!northwind) throw new Error("expected a synthetic company");
    const withCompany: CompanySeed = {
      ...structuredClone(COMPANY_SEED),
      companies: [structuredClone(northwind)],
    };
    expect(companySeedHash(withCompany)).not.toBe(hash);
  });

  test("org matching ignores case, punctuation, and a legal suffix", () => {
    expect(normalizeOrgName("Northwind, Inc.")).toBe("northwind");
    expect(normalizeOrgName("Y Combinator")).toBe("y combinator");
    expect(normalizeOrgName("Foo & Bar LLC")).toBe("foo and bar");
    expect(companyByOrg("Northwind, Inc.", SYNTHETIC_COMPANY_SEED)?.name).toBe("Northwind");
    expect(companyByOrg("Northwind Labs", SYNTHETIC_COMPANY_SEED)).toBeUndefined();
  });
});
