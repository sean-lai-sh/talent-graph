import { describe, expect, test } from "bun:test";
import {
  applyProxyLift,
  COMPANY_EVIDENCE_CONFIG,
  type CompanyEvidenceConfig,
  type CompanySelectionEvidence,
  type CompanySelectionQuery,
  companyEvidenceConfigHash,
  companySelectionEvidence,
} from "../src/longitudinal/companyEvidence.ts";
import type {
  CompanySeed,
  SeedCompany,
  SeedInvestor,
  SeedRound,
} from "../src/longitudinal/companySeed.ts";
import { selectivityLevelForRate } from "../src/models/careerEvidenceV12.ts";
import { SYNTHETIC_COMPANY_SEED } from "./fixtures/companySeed.synthetic.ts";

const PINNED_CONFIG_HASH = "5e494b90bc4523a5afa4ec9b4e7a79c74c1513c62cb0862908fe59829720e56c";

const SEED = SYNTHETIC_COMPANY_SEED;

type Forbidden = "network" | "connections" | "brand" | "hotness" | "trend" | "growth";
type ScorerSurface = CompanySelectionQuery &
  CompanySelectionEvidence &
  CompanySeed &
  SeedCompany &
  SeedInvestor &
  SeedRound;
type NoForbiddenField = Extract<keyof ScorerSurface, Forbidden> extends never ? true : never;

function hire(org: string, startedAt: string | null): CompanySelectionQuery {
  return { org, startedAt, founder: false };
}

function withoutWidgetRate(): CompanySeed {
  const seed = structuredClone(SEED);
  const widget = seed.investors.find((investor) => investor.name === "Widget Batch");
  if (!widget) throw new Error("expected Widget Batch");
  widget.publishedRates = [];
  return seed;
}

function pylonWithBar(): CompanySeed {
  const seed = structuredClone(SEED);
  const pylon = seed.companies.find((company) => company.name === "Pylon");
  if (!pylon) throw new Error("expected Pylon");
  pylon.hiringBar = {
    note: "Pylon publishes a five-round interview loop.",
    source: "https://example.invalid/pylon-bar",
  };
  return seed;
}

describe("company selection evidence", () => {
  test("the evidence config hash is pinned, and an edit changes it", () => {
    expect(companyEvidenceConfigHash()).toBe(PINNED_CONFIG_HASH);
    expect(COMPANY_EVIDENCE_CONFIG).toEqual({
      proxyLiftCap: 1,
      maxProxyLevel: 3,
      earlyJoinerBonus: 0,
      earlyJoinerBonusMax: 0.25,
    });
    const edited: CompanyEvidenceConfig = { ...COMPANY_EVIDENCE_CONFIG, earlyJoinerBonus: 0.1 };
    expect(companyEvidenceConfigHash(edited)).not.toBe(PINNED_CONFIG_HASH);
  });

  test("the scorer surface has no network, brand, or trend field", () => {
    const check: NoForbiddenField = true;
    expect(check).toBe(true);
  });

  test("a known rate wins over a proxy that would lift", () => {
    const query: CompanySelectionQuery = {
      org: "Northwind",
      startedAt: "2020-01-01",
      founder: true,
      fundingText: "Accepted into Widget Batch WB24",
    };
    const withRate = companySelectionEvidence(query, SEED);
    const proxiesOnly = companySelectionEvidence(query, withoutWidgetRate());

    expect(withRate.knownRate).toEqual({
      rate: 0.01,
      upperBound: true,
      source: "https://example.invalid/widget-wb24",
    });
    expect(withRate.investorTier).toBe(3);
    expect(withRate.stageAtHire).toBe("pre_seed_seed");
    expect(withRate.proxyLift).toBe(0);
    expect(applyProxyLift(0, withRate)).toBe(0);
    expect(selectivityLevelForRate(withRate.knownRate?.rate ?? -1)).toBe(4);

    expect(proxiesOnly.knownRate).toBeNull();
    expect(proxiesOnly.proxyLift).toBe(1);
    expect(applyProxyLift(0, proxiesOnly)).toBe(1);
  });

  test("stage and tier are the round on or before the hire date", () => {
    const before = companySelectionEvidence(hire("Northwind", "2019-02-01"), SEED);
    expect(before.stageAtHire).toBeNull();
    expect(before.investorTier).toBe(0);
    expect(before.proxyLift).toBe(0);

    const atSeed = companySelectionEvidence(hire("Northwind", "2020-01-01"), SEED);
    expect(atSeed.stageAtHire).toBe("pre_seed_seed");
    expect(atSeed.investorTier).toBe(1);

    const afterSeriesA = companySelectionEvidence(hire("Northwind", "2021-06-01"), SEED);
    expect(afterSeriesA.stageAtHire).toBe("series_a_b");
    expect(afterSeriesA.investorTier).toBe(3);

    const undated = companySelectionEvidence(hire("Northwind", null), SEED);
    expect(undated.stageAtHire).toBeNull();
    expect(undated.investorTier).toBeNull();
    expect(undated.proxyLift).toBe(0);
  });

  test("proxies add at most one level and never reach level 4", () => {
    const evidence = companySelectionEvidence(hire("Northwind", "2020-01-01"), SEED);
    expect(evidence.proxyLift).toBe(1);
    expect(applyProxyLift(0, evidence)).toBe(1);
    expect(applyProxyLift(2, evidence)).toBe(3);
    expect(applyProxyLift(3, evidence)).toBe(3);
    expect(applyProxyLift(4, evidence)).toBe(4);
  });

  test("growth or public at hire ignores investor tier unless a hiring bar is listed", () => {
    const ignored = companySelectionEvidence(hire("Pylon", "2020-01-01"), SEED);
    expect(ignored.stageAtHire).toBe("growth_late");
    expect(ignored.investorTier).toBe(3);
    expect(ignored.proxyLift).toBe(0);
    expect(applyProxyLift(1, ignored)).toBe(1);

    const barred = companySelectionEvidence(hire("Pylon", "2020-01-01"), pylonWithBar());
    expect(barred.investorTier).toBe(3);
    expect(barred.proxyLift).toBe(1);
    expect(applyProxyLift(1, barred)).toBe(2);
  });

  test("joined_early is a flag at bonus 0, and the bonus clamps at 0.25", () => {
    const early = companySelectionEvidence(hire("Northwind", "2020-01-01"), SEED);
    expect(early.joinedEarly).toBe(true);
    expect(early.earlyJoinerBonus).toBe(0);
    expect(applyProxyLift(1, early)).toBe(2);

    const generous: CompanyEvidenceConfig = { ...COMPANY_EVIDENCE_CONFIG, earlyJoinerBonus: 0.5 };
    expect(
      companySelectionEvidence(hire("Northwind", "2020-01-01"), SEED, generous).earlyJoinerBonus,
    ).toBe(0.25);
    const partial: CompanyEvidenceConfig = { ...COMPANY_EVIDENCE_CONFIG, earlyJoinerBonus: 0.1 };
    expect(
      companySelectionEvidence(hire("Northwind", "2020-01-01"), SEED, partial).earlyJoinerBonus,
    ).toBe(0.1);

    const lateSeed: CompanySeed = {
      ...structuredClone(SEED),
      companies: SEED.companies.map((company) =>
        company.name === "Northwind"
          ? {
              ...company,
              rounds: [
                ...company.rounds,
                {
                  date: "2023-01-01",
                  stage: "public_large" as const,
                  investors: ["Ferry Capital"],
                  source: "https://example.invalid/northwind-public",
                },
              ],
            }
          : company,
      ),
    };
    const late = companySelectionEvidence(hire("Northwind", "2023-06-01"), lateSeed, generous);
    expect(late.stageAtHire).toBe("public_large");
    expect(late.joinedEarly).toBe(false);
    expect(late.earlyJoinerBonus).toBe(0);
    expect(late.proxyLift).toBe(0);
  });

  test("a standing company rate is copied, and a program rate needs its label", () => {
    const harbor = companySelectionEvidence(hire("Harborline, Inc.", "2020-01-01"), SEED);
    expect(harbor.knownRate).toEqual({
      rate: 0.04,
      upperBound: false,
      source: "https://example.invalid/harborline-intern",
    });
    expect(harbor.proxyLift).toBe(0);
    expect(harbor.investorTier).toBe(3);
    expect(applyProxyLift(0, harbor)).toBe(0);

    const otherBatch = companySelectionEvidence(
      {
        org: "Northwind",
        startedAt: "2020-01-01",
        founder: true,
        fundingText: "Accepted into Widget Batch WB23",
      },
      SEED,
    );
    expect(otherBatch.knownRate).toBeNull();
    expect(otherBatch.proxyLift).toBe(1);
  });
});
