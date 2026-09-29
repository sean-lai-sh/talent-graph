import { describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/jev-company-worklist.ts";
import { CLAIM_VALUE_V1_2_0, claimValueV12ConfigHash } from "../src/longitudinal/claimValue.ts";
import {
  type CompanyResearchProposal,
  companyWorklist,
  mergeSeedCompanies,
  parseCompanyResearchProposals,
} from "../src/longitudinal/companyResearch.ts";
import { parseProjectConfig, projectConfigPath } from "../src/projectConfig/load.ts";
import { hashInputs } from "../src/provenance/hash.ts";
import { SYNTHETIC_COMPANY_SEED } from "./fixtures/companySeed.synthetic.ts";

const PROPOSALS = join(import.meta.dir, "fixtures/company-research.proposals.json");
const ITEMS = join(import.meta.dir, "fixtures/jev-claim-smoke-v12.items.json");
const PIN = join(import.meta.dir, "../src/projectConfig/companySeedPin.ts");

async function proposals(): Promise<unknown[]> {
  return JSON.parse(await readFile(PROPOSALS, "utf8")) as unknown[];
}

function withQuarry(edit: (quarry: Record<string, unknown>) => void, raw: unknown[]): unknown[] {
  const copy = structuredClone(raw) as Record<string, unknown>[];
  const quarry = copy[0];
  if (!quarry) throw new Error("expected Quarry");
  edit(quarry);
  return copy;
}

describe("company research proposals", () => {
  test("the fixture proposal parses into a seed company", async () => {
    const [quarry] = parseCompanyResearchProposals(await proposals());
    expect(quarry?.name).toBe("Quarry");
    expect(quarry?.hiringBar).toEqual({
      note: "Quarry runs a five-round loop with a hiring committee.",
      source: "https://example.invalid/quarry-bar",
    });
  });

  test("an unsourced or estimated fact is rejected", async () => {
    const raw = await proposals();
    const bad: [string, (quarry: Record<string, unknown>) => void, RegExp][] = [
      [
        "http round source",
        (q) => {
          (q.rounds as Record<string, unknown>[])[0]!.source = "http://example.invalid/a";
        },
        /proposals\[0\]\.rounds\[0\]\.source: source URL is not a valid https URL/,
      ],
      [
        "hiring bar without a note",
        (q) => {
          q.hiringBar = { source: "https://example.invalid/quarry-bar" };
        },
        /proposals\[0\]\.hiringBar\.note: must be a non-empty string/,
      ],
      [
        "estimated rate",
        (q) => {
          q.publishedRate = {
            rate: 0.02,
            upperBound: false,
            source: "https://example.invalid/r",
            estimated: true,
          };
        },
        /estimated or inferred/,
      ],
      [
        "rate without a source",
        (q) => {
          q.publishedRate = { rate: 0.02, upperBound: false };
        },
        /published rate is missing a source URL/,
      ],
    ];
    for (const [label, edit, error] of bad) {
      expect(() => parseCompanyResearchProposals(withQuarry(edit, raw)), label).toThrow(error);
    }
    expect(() => parseCompanyResearchProposals([...raw, ...raw])).toThrow(
      /proposals\[1\]: duplicate "Quarry"/,
    );
  });
});

describe("company worklist", () => {
  test("each hire or funding org appears once with titles, earliest start, seed match, and evidence", async () => {
    const items = JSON.parse(await readFile(ITEMS, "utf8")) as {
      id: string;
      statement: string;
      publishedAt: string;
    }[];
    const worklist = companyWorklist(
      items.map((item) => ({
        id: item.id,
        statement: item.statement,
        publishedAt: item.publishedAt,
      })),
      SYNTHETIC_COMPANY_SEED,
    );
    expect(worklist.map((item) => item.org)).toEqual(["Harborline", "Pine Widget", "Example Lab"]);
    const [harbor, , lab] = worklist;
    expect(harbor).toMatchObject({
      titles: ["Engineer"],
      earliestStartedAt: "2020-01-01",
      seeded: "Harborline",
      evidence: {
        knownRate: {
          rate: 0.04,
          upperBound: false,
          source: "https://example.invalid/harborline-intern",
        },
        investorTier: 3,
        topInvestor: "Ferry Capital",
        stageAtHire: "pre_seed_seed",
      },
    });
    expect(lab).toMatchObject({
      titles: ["Engineer"],
      earliestStartedAt: "2021-01-01",
      seeded: null,
      evidence: { knownRate: null, investorTier: null, stageAtHire: null },
    });
  });

  test("the script prints the same worklist as JSON", async () => {
    const out = await main(["--items", ITEMS], { config: "", pin: "" }, SYNTHETIC_COMPANY_SEED);
    expect((JSON.parse(out) as { org: string }[]).map((item) => item.org)).toEqual([
      "Harborline",
      "Pine Widget",
      "Example Lab",
    ]);
  });
});

describe("applying proposals", () => {
  test("merges into company_seed, keeps comments, rewrites the pin, and is idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "company-apply-"));
    const paths = { config: join(dir, "config.yml"), pin: join(dir, "companySeedPin.ts") };
    await copyFile(projectConfigPath(), paths.config);
    await copyFile(PIN, paths.pin);

    const out = await main(["--apply", PROPOSALS], paths);
    const text = await readFile(paths.config, "utf8");
    const seed = parseProjectConfig(text).company_seed;
    const hash = hashInputs(seed);
    expect(seed.companies.map((company) => company.name)).toEqual(["Quarry"]);
    expect(text).toContain("# companies[].hiringBar: a sourced hiring-bar note, or null.");
    expect(await readFile(paths.pin, "utf8")).toContain(`"${hash}"`);
    expect(out).toContain(`company_seed ${hash}`);
    expect(out).toContain(
      `claim_value@1.2.0 ${claimValueV12ConfigHash({ ...CLAIM_VALUE_V1_2_0, companySeedHash: hash })}`,
    );
    expect(out).toContain("round investors with no seed entry (they add no tier): Quarry Angels");

    await main(["--apply", PROPOSALS], paths);
    expect(await readFile(paths.config, "utf8")).toBe(text);
  });

  test("an update replaces the entry by name, and an alias another company owns fails", async () => {
    const base = await readFile(projectConfigPath(), "utf8");
    const [quarry] = parseCompanyResearchProposals(await proposals());
    if (!quarry) throw new Error("expected Quarry");
    const once = mergeSeedCompanies(base, [quarry]).text;
    const updated: CompanyResearchProposal = { ...quarry, aliases: ["Quarry Inc", "QRY"] };
    const twice = mergeSeedCompanies(once, [updated]);
    const companies = parseProjectConfig(twice.text).company_seed.companies;
    expect(companies).toHaveLength(1);
    expect(companies[0]?.aliases).toEqual(["Quarry Inc", "QRY"]);

    const clash: CompanyResearchProposal = { ...quarry, name: "Quarry Labs", aliases: ["QRY"] };
    expect(() => mergeSeedCompanies(twice.text, [clash])).toThrow(
      /"QRY" names both Quarry and Quarry Labs/,
    );
  });
});
