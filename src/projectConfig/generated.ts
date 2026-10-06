// Generated from config.yml by scripts/gen-config.ts. Do not edit by hand.
// After editing config.yml, run `bun run config:gen`; `bun run check:config-gen` fails in CI if this file is stale.
import { deepFreeze } from "../models/freeze.ts";
import type { ProjectConfig } from "./parse.ts";

export const PROJECT_CONFIG: ProjectConfig = deepFreeze<ProjectConfig>({
  "company_seed": {
    "investors": [
      {
        "name": "Y Combinator",
        "aliases": [
          "YC"
        ],
        "tier": 3,
        "source": "https://www.ycombinator.com/blog/meet-the-yc-winter-2024-batch/",
        "publishedRates": [
          {
            "rate": 0.01,
            "upperBound": true,
            "source": "https://www.ycombinator.com/blog/meet-the-yc-winter-2024-batch/",
            "labels": [
              "W24",
              "Winter 2024"
            ]
          }
        ]
      },
      {
        "name": "Sequoia",
        "aliases": [],
        "tier": 3,
        "source": "https://www.sequoiacap.com/",
        "publishedRates": []
      },
      {
        "name": "Andreessen Horowitz",
        "aliases": [],
        "tier": 3,
        "source": "https://a16z.com/",
        "publishedRates": []
      },
      {
        "name": "Benchmark",
        "aliases": [],
        "tier": 3,
        "source": "https://www.benchmark.com/",
        "publishedRates": []
      },
      {
        "name": "Accel",
        "aliases": [],
        "tier": 2,
        "source": "https://www.accel.com/",
        "publishedRates": []
      },
      {
        "name": "Greylock",
        "aliases": [],
        "tier": 2,
        "source": "https://greylock.com/",
        "publishedRates": []
      },
      {
        "name": "Index Ventures",
        "aliases": [],
        "tier": 2,
        "source": "https://www.indexventures.com/",
        "publishedRates": []
      },
      {
        "name": "Precursor Ventures",
        "aliases": [
          "Precursor VC"
        ],
        "tier": 1,
        "source": "https://precursorvc.com/",
        "publishedRates": []
      },
      {
        "name": "Hustle Fund",
        "aliases": [],
        "tier": 1,
        "source": "https://www.hustlefund.vc/",
        "publishedRates": []
      }
    ],
    "companies": []
  },
  "person_rollup": {
    "wTrend": 0.2,
    "wSubstance": 0.6,
    "wConsensus": 0.4,
    "topN": 3,
    "minCohortSize": 30,
    "minBucketSize": 2,
    "consensusCuts": [
      0.0625,
      0.25,
      0.5625
    ],
    "weightSumTolerance": 1e-9
  }
});
