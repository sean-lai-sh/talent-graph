import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALPHA_SANITY_SEED,
  buildAlphaReport,
  main,
  orderingProblems,
  parseExtraClaims,
  syntheticCohort,
  VARIANTS_PER_ARCHETYPE,
} from "../scripts/jev-alpha-sanity.ts";
import { PINNED_PERSON_ROLLUP_HASH } from "../src/longitudinal/personRollup.ts";

test("the synthetic cohort keeps the section 10 alpha order", () => {
  const claims = syntheticCohort();
  const people = new Set(claims.map((claim) => claim.personId));
  expect(people.size).toBeGreaterThanOrEqual(30);
  const report = buildAlphaReport(claims);
  expect(report.ok).toBe(true);
  expect(report.problems).toEqual([]);
  expect(report.cohortSize).toBeGreaterThanOrEqual(30);
  expect(report.means.map((mean) => mean.n)).toEqual([
    VARIANTS_PER_ARCHETYPE,
    VARIANTS_PER_ARCHETYPE,
    VARIANTS_PER_ARCHETYPE,
    VARIANTS_PER_ARCHETYPE,
  ]);
  expect(report.text).toContain(`Seed ${ALPHA_SANITY_SEED}.`);
  expect(report.text).toContain(`Person rollup hash ${PINNED_PERSON_ROLLUP_HASH}.`);
  expect(report.text).toContain("Section 10 ordering holds.");
  expect(report.text).toContain("big company, big result");
  expect(report.text).toContain("obscure maintainer");
  expect(report.extras).toEqual([]);
  expect(orderingProblems(report.means)).toEqual([]);
});

test("a reversed archetype table fails the ordering check", () => {
  const problems = orderingProblems([
    {
      archetype: "big_company_big_result",
      label: "big company, big result",
      n: 4,
      alphaPercentile: 0.9,
      alphaResidual: 0.2,
      value: 0.6,
    },
    {
      archetype: "big_company_thin_work",
      label: "big company, thin work",
      n: 4,
      alphaPercentile: 0.2,
      alphaResidual: -0.2,
      value: 0.3,
    },
    {
      archetype: "obscure_maintainer",
      label: "obscure maintainer",
      n: 4,
      alphaPercentile: 0.5,
      alphaResidual: 0,
      value: 0.4,
    },
    {
      archetype: "hackathon",
      label: "hackathon",
      n: 4,
      alphaPercentile: 0.7,
      alphaResidual: 0.1,
      value: 0.2,
    },
  ]);
  expect(problems.length).toBeGreaterThan(0);
});

test("main runs synthetic-only and merges an extra file", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    expect(await main([])).toBe(0);
  } finally {
    console.log = original;
  }
  expect(lines.join("\n")).toContain("Section 10 ordering holds.");

  const dir = await mkdtemp(join(tmpdir(), "jev-alpha-extra-"));
  const path = join(dir, "extra.json");
  await writeFile(
    path,
    JSON.stringify([
      {
        personId: "extra-1",
        id: "extra-1-selection",
        claimClass: "selection",
        claimValue: 0.125,
        status: "accepted",
        observedAt: "2020-06-01",
      },
      {
        personId: "extra-1",
        id: "extra-1-output",
        claimClass: "output",
        claimValue: 0.125,
        status: "accepted",
        observedAt: "2020-06-01T00:00:00.000Z",
      },
    ]),
  );
  const extraLines: string[] = [];
  console.log = (...args: unknown[]) => {
    extraLines.push(args.map(String).join(" "));
  };
  try {
    expect(await main(["--extra", path])).toBe(0);
  } finally {
    console.log = original;
  }
  const text = extraLines.join("\n");
  expect(text).toContain("| extra-1 |");
  expect(text).toContain("Section 10 ordering holds.");
  expect(text).not.toContain("Harborline");
});

test("extra claims must be scored rows, not resume text", async () => {
  expect(() => parseExtraClaims({ statement: "secret resume" })).toThrow(/usage:/);
  expect(() =>
    parseExtraClaims([
      {
        personId: "extra-1",
        id: "x",
        claimClass: "funding",
        claimValue: 0.2,
        status: "accepted",
        observedAt: "2020-06-01",
      },
    ]),
  ).toThrow(/claimClass/);
  await expect(main(["--extra"])).rejects.toThrow(/usage:/);
});
