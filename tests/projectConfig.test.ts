import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { PINNED_COMPANY_SEED_HASH } from "../src/projectConfig/companySeedPin.ts";
import { projectConfigPath } from "../src/projectConfig/load.ts";
import { checkConfigText } from "../src/projectConfig/parse.ts";
import { PINNED_PERSON_ROLLUP_HASH } from "../src/projectConfig/personRollupPin.ts";
import { hashInputs } from "../src/provenance/hash.ts";

function fixture(name: string): string {
  const text = readFileSync(new URL(`./fixtures/config/${name}`, import.meta.url), "utf8");
  return withLivePersonRollup(text);
}

function withLivePersonRollup(text: string): string {
  let parsed: unknown;
  try {
    parsed = parse(text, { schema: "core", strict: true, uniqueKeys: true });
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  if ("person_rollup" in parsed) return text;
  const live = parse(readFileSync(projectConfigPath(), "utf8"), { schema: "core" }) as {
    person_rollup: unknown;
  };
  return `${text.trimEnd()}\n${stringify({ person_rollup: live.person_rollup })}`;
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

  test("a hiring bar without a note fails", () => {
    const company = {
      name: "Quarry",
      aliases: [],
      source: "https://example.invalid/quarry",
      currentStage: "public_large",
      rounds: [],
      publishedRate: null,
      hiringBar: { source: "https://example.invalid/quarry-bar" },
    };
    const text = withLivePersonRollup(
      stringify({ company_seed: { investors: [], companies: [company] } }),
    );
    expect(() => checkConfigText(text)).toThrow(
      /companies\[0\]\.hiringBar\.note: must be a non-empty string/,
    );
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

  test("the real file matches the pinned person_rollup hash", () => {
    const text = readFileSync(projectConfigPath(), "utf8");
    const parsed = parse(text, { schema: "core" }) as { person_rollup: unknown };
    expect(hashInputs(parsed.person_rollup)).toBe(PINNED_PERSON_ROLLUP_HASH);
    expect(checkConfigText(text)).toBe(PINNED_COMPANY_SEED_HASH);
  });

  test("a document without person_rollup fails", () => {
    expect(() => checkConfigText("company_seed:\n  investors: []\n  companies: []\n")).toThrow(
      /missing section "person_rollup"/,
    );
  });

  test("a non-numeric person_rollup weight fails", () => {
    expect(() => checkConfigText(fixture("person-rollup-bad-type.yml"))).toThrow(
      /wTrend: must be a finite number in \[0, 1\]/,
    );
  });

  test("a person_rollup weight outside [0, 1] fails", () => {
    expect(() => checkConfigText(fixture("person-rollup-range.yml"))).toThrow(
      /wTrend: must be a finite number in \[0, 1\]/,
    );
  });

  test("person_rollup value weights that do not sum to 1 fail", () => {
    expect(() => checkConfigText(fixture("person-rollup-sum.yml"))).toThrow(
      /wSubstance and wConsensus must sum to 1/,
    );
  });

  test("an unknown person_rollup field fails", () => {
    expect(() => checkConfigText(fixture("person-rollup-unknown.yml"))).toThrow(
      /unknown field "extra"/,
    );
  });

  test("editing wTrend fails the person_rollup pin", () => {
    const text = readFileSync(projectConfigPath(), "utf8").replace("wTrend: 0.2", "wTrend: 0.3");
    expect(() => checkConfigText(text)).toThrow(
      /person_rollup hash [0-9a-f]+ does not match pinned hash/,
    );
  });

  test("editing a consensus cut fails the person_rollup pin", () => {
    const text = readFileSync(projectConfigPath(), "utf8").replace(
      "consensusCuts: [0.0625, 0.25, 0.5625]",
      "consensusCuts: [0.07, 0.25, 0.5625]",
    );
    expect(() => checkConfigText(text)).toThrow(
      /person_rollup hash [0-9a-f]+ does not match pinned hash/,
    );
  });

  test("editing weightSumTolerance fails the person_rollup pin", () => {
    const text = readFileSync(projectConfigPath(), "utf8").replace(
      "weightSumTolerance: 1.0e-9",
      "weightSumTolerance: 1.0e-8",
    );
    expect(() => checkConfigText(text)).toThrow(
      /person_rollup hash [0-9a-f]+ does not match pinned hash/,
    );
  });

  test("non-increasing consensus cuts fail", () => {
    expect(() => checkConfigText(fixture("person-rollup-cuts.yml"))).toThrow(
      /consensusCuts\[1\]: must be strictly increasing/,
    );
  });

  test("a consensus cut outside [0, 1] fails", () => {
    expect(() => checkConfigText(fixture("person-rollup-cut-range.yml"))).toThrow(
      /consensusCuts\[0\]: must be a finite number in \[0, 1\]/,
    );
  });

  test("a weight-sum tolerance outside (0, 1e-6] fails", () => {
    expect(() => checkConfigText(fixture("person-rollup-tolerance.yml"))).toThrow(
      /weightSumTolerance: must be a finite number in \(0, 1e-6\]/,
    );
  });
});
