import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { PINNED_COMPANY_SEED_HASH } from "../src/projectConfig/companySeedPin.ts";
import { checkConfigText, projectConfigPath } from "../src/projectConfig/load.ts";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/config/${name}`, import.meta.url), "utf8");
}

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

describe("config.yml", () => {
  test("the real file matches the pinned company_seed hash", () => {
    const text = readFileSync(projectConfigPath(), "utf8");
    expect(checkConfigText(text)).toBe(PINNED_COMPANY_SEED_HASH);
  });

  test("comments, whitespace, and key order do not change the hash", () => {
    const text = readFileSync(projectConfigPath(), "utf8");
    const commented = `\n# note\n\n${text}\n\n`;
    expect(checkConfigText(commented)).toBe(PINNED_COMPANY_SEED_HASH);
    const flipped = stringify(reverseKeys(parse(text, { schema: "core" })));
    expect(checkConfigText(flipped)).toBe(PINNED_COMPANY_SEED_HASH);
  });

  test("a missing source URL fails", () => {
    expect(() => checkConfigText(fixture("missing-source.yml"))).toThrow(/missing source URL/);
  });

  test("a non-https source URL fails", () => {
    expect(() => checkConfigText(fixture("bad-url.yml"))).toThrow(/not a valid https URL/);
  });

  test("an estimated rate fails", () => {
    expect(() => checkConfigText(fixture("estimated-rate.yml"))).toThrow(/estimated or inferred/);
  });

  test("an inferred rate fails", () => {
    expect(() => checkConfigText(fixture("inferred-rate.yml"))).toThrow(/estimated or inferred/);
  });

  test("a rate without a source fails", () => {
    expect(() => checkConfigText(fixture("rate-missing-source.yml"))).toThrow(
      /published rate is missing a source URL/,
    );
  });

  test("a duplicate id fails", () => {
    expect(() => checkConfigText(fixture("duplicate-id.yml"))).toThrow(/duplicate id "Lamp Fund"/);
  });

  test("a wrong type fails", () => {
    expect(() => checkConfigText(fixture("wrong-type.yml"))).toThrow(/must be 1, 2, or 3/);
  });

  test("a missing field fails", () => {
    expect(() => checkConfigText(fixture("missing-field.yml"))).toThrow(/missing id/);
  });

  test("an unknown section fails", () => {
    expect(() => checkConfigText(fixture("unknown-section.yml"))).toThrow(
      /unknown section "scoring"/,
    );
  });

  test("a changed value with the old pin fails", () => {
    expect(() => checkConfigText(fixture("stale-hash.yml"))).toThrow(
      `does not match pinned hash ${PINNED_COMPANY_SEED_HASH}`,
    );
  });
});
