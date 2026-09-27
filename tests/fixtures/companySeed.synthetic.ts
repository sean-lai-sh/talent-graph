import type { CompanySeed } from "../../src/longitudinal/companySeed.ts";

export const SYNTHETIC_COMPANY_SEED: CompanySeed = {
  investors: [
    {
      name: "Lamp Fund",
      aliases: [],
      tier: 1,
      source: "https://example.invalid/lamp",
      publishedRates: [],
    },
    {
      name: "Ferry Capital",
      aliases: ["Ferry"],
      tier: 3,
      source: "https://example.invalid/ferry",
      publishedRates: [],
    },
    {
      name: "Widget Batch",
      aliases: ["WB"],
      tier: 3,
      source: "https://example.invalid/widget",
      publishedRates: [
        {
          rate: 0.01,
          upperBound: true,
          source: "https://example.invalid/widget-wb24",
          labels: ["WB24"],
        },
      ],
    },
  ],
  companies: [
    {
      name: "Northwind",
      aliases: ["Northwind Inc"],
      source: "https://example.invalid/northwind",
      currentStage: "public_large",
      rounds: [
        {
          date: "2019-03-01",
          stage: "pre_seed_seed",
          investors: ["Lamp Fund"],
          source: "https://example.invalid/northwind-seed",
        },
        {
          date: "2021-06-01",
          stage: "series_a_b",
          investors: ["Ferry Capital"],
          source: "https://example.invalid/northwind-a",
        },
      ],
      publishedRate: null,
      hiringBar: null,
    },
    {
      name: "Harborline",
      aliases: [],
      source: "https://example.invalid/harborline",
      currentStage: "pre_seed_seed",
      rounds: [
        {
          date: "2018-01-01",
          stage: "pre_seed_seed",
          investors: ["Ferry Capital"],
          source: "https://example.invalid/harborline-seed",
        },
      ],
      publishedRate: {
        rate: 0.04,
        upperBound: false,
        source: "https://example.invalid/harborline-intern",
      },
      hiringBar: null,
    },
    {
      name: "Pylon",
      aliases: [],
      source: "https://example.invalid/pylon",
      currentStage: "public_large",
      rounds: [
        {
          date: "2016-01-01",
          stage: "growth_late",
          investors: ["Ferry Capital"],
          source: "https://example.invalid/pylon-growth",
        },
      ],
      publishedRate: null,
      hiringBar: null,
    },
  ],
};
