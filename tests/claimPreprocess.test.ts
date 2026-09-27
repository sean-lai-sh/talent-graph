import { describe, expect, test } from "bun:test";
import { type ClaimFacts, preprocessClaims } from "../src/longitudinal/claimPreprocess.ts";

function factsOf(statement: string): ClaimFacts {
  const claims = preprocessClaims(statement, "parent");
  expect(claims).toHaveLength(1);
  const facts = claims[0]?.facts;
  if (facts === undefined) throw new Error("missing facts");
  return facts;
}

describe("selection ratios", () => {
  test("of, slash, out of, plus, commas, and k", () => {
    expect(factsOf("Picked 3 of 90 Harborline applicants.").selections).toEqual([
      { kind: "ratio", selected: 3, pool: 90, rate: 3 / 90, poolLowerBound: false },
    ]);
    expect(factsOf("Picked 3/90 Harborline applicants.").selections).toEqual([
      { kind: "ratio", selected: 3, pool: 90, rate: 3 / 90, poolLowerBound: false },
    ]);
    expect(factsOf("Picked 1 out of 80 Pylon applicants.").selections).toEqual([
      { kind: "ratio", selected: 1, pool: 80, rate: 1 / 80, poolLowerBound: false },
    ]);
    expect(factsOf("Picked 1 of 400+ Northwind applicants.").selections).toEqual([
      { kind: "ratio", selected: 1, pool: 400, rate: 1 / 400, poolLowerBound: true },
    ]);
    expect(factsOf("Picked 12 of 10,000 Lumen applicants.").selections).toEqual([
      { kind: "ratio", selected: 12, pool: 10000, rate: 12 / 10000, poolLowerBound: false },
    ]);
    expect(factsOf("Picked 4 of 10k Ferry applicants.").selections).toEqual([
      { kind: "ratio", selected: 4, pool: 10000, rate: 4 / 10000, poolLowerBound: false },
    ]);
    expect(factsOf("Picked 1/10k Ferry applicants.").selections).toEqual([
      { kind: "ratio", selected: 1, pool: 10000, rate: 1 / 10000, poolLowerBound: false },
    ]);
    const top = factsOf("Finished in the top 5% of the Pylon quiz.");
    expect(top.selections).toEqual([{ kind: "top_percent", rate: 5 / 100 }]);
    expect(top.percentages).toEqual([]);
  });

  test("team size, years, and small slash pairs are not selection ratios", () => {
    expect(factsOf("Worked in a team of 4 at Pylon Hall.").selections).toEqual([]);
    expect(factsOf("Joined Q3/2024 planning at Northwind.").selections).toEqual([]);
    expect(factsOf("Read 3/4 of the Lumen brief.").selections).toEqual([]);
    expect(factsOf("Shipped v3.2.1 of the Northwind catalog.").selections).toEqual([]);
    expect(factsOf("Read 3/4 of 90 Lumen pages.").selections).toEqual([]);
    expect(factsOf("Read 3/4 students.").counts).toEqual([]);
    expect(factsOf("Upgraded v3.2.1/90 at Northwind.").selections).toEqual([]);
    expect(factsOf("Used Node 18/20 and Go.").selections).toEqual([]);
    expect(factsOf("Picked 1/2k applicants.").selections).toEqual([
      { kind: "ratio", selected: 1, pool: 2000, rate: 1 / 2000, poolLowerBound: false },
    ]);
    expect(factsOf("See 3/2024 of 9000 Pylon seats.").selections).toEqual([]);
  });
});

describe("before/after metrics", () => {
  test("percent pairs and mixed time units", () => {
    const yieldChange = factsOf("Raised yield from 60% to 99.5% on the Ferry line.").changes;
    expect(yieldChange).toEqual([
      {
        metric: "yield",
        unit: "percent",
        before: 60,
        after: 99.5,
        relative_change: (99.5 - 60) / 60,
      },
    ]);

    const duration = factsOf("Cut the nightly job from 5 minutes to 8 seconds.").changes;
    expect(duration).toEqual([
      {
        metric: "nightly job",
        unit: "duration",
        before: 300,
        after: 8,
        relative_change: (8 - 300) / 300,
      },
    ]);

    expect(factsOf("5 minutes to 8 seconds on the Pylon batch.").changes).toEqual([
      {
        metric: "duration",
        unit: "duration",
        before: 300,
        after: 8,
        relative_change: (8 - 300) / 300,
      },
    ]);

    expect(factsOf("Moved the bake from 2 hours to 30 minutes.").changes).toEqual([
      {
        metric: "bake",
        unit: "duration",
        before: 7200,
        after: 1800,
        relative_change: -0.75,
      },
    ]);

    expect(factsOf("Raised yield from +10% to +20%.").changes).toEqual([
      {
        metric: "yield",
        unit: "percent",
        before: 10,
        after: 20,
        relative_change: 1,
      },
    ]);
    expect(factsOf("Raised yield from +10% to +20%.").percentages).toEqual([]);
    expect(factsOf("Moved uptime from -2% to 4%.").changes).toEqual([
      {
        metric: "uptime",
        unit: "percent",
        before: -2,
        after: 4,
        relative_change: 3,
      },
    ]);

    expect(factsOf("Moved uptime from 0% to 40%.").changes).toEqual([
      {
        metric: "uptime",
        unit: "percent",
        before: 0,
        after: 40,
        relative_change: null,
      },
    ]);
  });

  test("a before/after percent is not also a plain percent", () => {
    const facts = factsOf("Raised yield from 60% to 99.5% on the Ferry line.");
    expect(facts.percentages).toEqual([]);
    expect(facts.changes).toHaveLength(1);
  });
});

describe("percents, counts, team size, and ownership", () => {
  test("plain percents, deltas, and counts with units", () => {
    expect(factsOf("Kept a 12% share of replies at Lumen.").percentages).toEqual([
      { kind: "level", value: 12 },
    ]);
    expect(factsOf("Improving latency 10% on the Ferry gate.").percentages).toEqual([
      { kind: "delta", value: 10 },
    ]);
    expect(factsOf("Cut error rate by 3%.").percentages).toEqual([{ kind: "delta", value: 3 }]);
    expect(factsOf("Posted a +4% lift and a -2% drop.").percentages).toEqual([
      { kind: "delta", value: 4 },
      { kind: "delta", value: -2 },
    ]);

    expect(factsOf("Served 1,200 students, 40 events, and 800 users.").counts).toEqual([
      { value: 1200, unit: "students" },
      { value: 40, unit: "events" },
      { value: 800, unit: "users" },
    ]);
    expect(factsOf("Handled 10k daily requests and 800 requests per day.").counts).toEqual([
      { value: 10000, unit: "requests_per_day" },
      { value: 800, unit: "requests_per_day" },
    ]);
    expect(factsOf("Billed $2.5k and $4,500 for the Pylon booth.").counts).toEqual([
      { value: 2500, unit: "usd" },
      { value: 4500, unit: "usd" },
    ]);
    expect(factsOf("Logged 500 requests for the catalog.").counts).toEqual([
      { value: 500, unit: "requests" },
    ]);
  });

  test("team size and the lead ownership verb", () => {
    expect(factsOf("Worked in team of 4 at Pylon Hall.").teamSize).toBe(4);
    expect(factsOf("Worked in a team of 6 at Lumen.").teamSize).toBe(6);
    expect(factsOf("Led the night desk at Pylon Hall.").ownership).toBe("led");
    expect(factsOf("Owned the Ferry ledger.").ownership).toBe("led");
    expect(factsOf("Founded the Lumen press.").ownership).toBe("led");
    expect(factsOf("Built the Harborline router.").ownership).toBe("built");
    expect(factsOf("Developed the Pylon parser.").ownership).toBe("built");
    expect(factsOf("Designed the exhibit lights.").ownership).toBe("built");
    expect(factsOf("Contributed a chapter to the Lumen notes.").ownership).toBe("contributed");
    expect(factsOf("Assisted the night editor.").ownership).toBe("contributed");
    expect(factsOf("Helped the editor at Ferry.").ownership).toBe("contributed");
    expect(factsOf("Worked under Nia on the catalog.").ownership).toBe("contributed");
    expect(factsOf("Worked on the catalog at Ferry.").ownership).toBeNull();
    expect(factsOf("Filed notes for 12 students.").ownership).toBeNull();
    expect(factsOf("Helped lead the migration at Pylon.").ownership).toBe("contributed");
    expect(factsOf("Built the archive and later founded the press.").ownership).toBe("built");
    expect(factsOf("Shipped the Northwind catalog.").ownership).toBeNull();
  });

  test("numbers inside a ratio or a team size are not also counts", () => {
    const ratio = factsOf("Won the harbor quiz bowl (1 of 80 teams).");
    expect(ratio.selections).toEqual([
      { kind: "ratio", selected: 1, pool: 80, rate: 1 / 80, poolLowerBound: false },
    ]);
    expect(ratio.counts).toEqual([]);
    expect(factsOf("Taught 30 students in a team of 4.").counts).toEqual([
      { value: 30, unit: "students" },
    ]);
    expect(factsOf("Taught 30 students in a team of 4.").teamSize).toBe(4);
  });
});

describe("splitting", () => {
  test("a role clause and a selection clause split, and each child keeps the source", () => {
    const statement =
      "Built the routing service for Harborline Transit; selected as 1 of 400 applicants.";
    const claims = preprocessClaims(statement, "bullet-1");
    expect(claims.map((claim) => claim.id)).toEqual(["bullet-1#0", "bullet-1#1"]);
    expect(claims.map((claim) => claim.parentId)).toEqual(["bullet-1", "bullet-1"]);
    expect(claims.map((claim) => claim.statement)).toEqual([statement, statement]);
    expect(claims.map((claim) => claim.text)).toEqual([
      "Built the routing service for Harborline Transit",
      "selected as 1 of 400 applicants.",
    ]);
    expect(claims[0]?.facts.ownership).toBe("built");
    expect(claims[0]?.facts.selections).toEqual([]);
    expect(claims[1]?.facts.ownership).toBeNull();
    expect(claims[1]?.facts.selections).toEqual([
      { kind: "ratio", selected: 1, pool: 400, rate: 1 / 400, poolLowerBound: false },
    ]);
  });

  test("a sentence boundary and an and/to-win boundary also split", () => {
    const sentences = preprocessClaims(
      "Designed the exhibit lights for Pylon Hall. Won the city student prize, 3 of 90 entries.",
      "bullet-2",
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[0]?.facts.ownership).toBe("built");
    expect(sentences[1]?.facts.selections).toEqual([
      { kind: "ratio", selected: 3, pool: 90, rate: 3 / 90, poolLowerBound: false },
    ]);

    const joined = preprocessClaims(
      "Led the survey for Northwind Foods and won the campus case contest (1 out of 80).",
      "bullet-3",
    );
    expect(joined.map((claim) => claim.text)).toEqual([
      "Led the survey for Northwind Foods",
      "won the campus case contest (1 out of 80).",
    ]);
    expect(joined[0]?.facts.ownership).toBe("led");
    expect(joined[1]?.facts.selections).toEqual([
      { kind: "ratio", selected: 1, pool: 80, rate: 1 / 80, poolLowerBound: false },
    ]);

    const toWin = preprocessClaims(
      "Led the night desk for Pylon Hall to win the harbor quiz, 1 of 400+ entries.",
      "bullet-4",
    );
    expect(toWin).toHaveLength(2);
    expect(toWin[1]?.text).toBe("win the harbor quiz, 1 of 400+ entries.");
    expect(toWin[1]?.facts.selections).toEqual([
      { kind: "ratio", selected: 1, pool: 400, rate: 1 / 400, poolLowerBound: true },
    ]);

    const titled = preprocessClaims(
      "Built the router for Dr. Chen. Won the city prize, 2 of 40 entries.",
      "bullet-5",
    );
    expect(titled.map((claim) => claim.text)).toEqual([
      "Built the router for Dr. Chen.",
      "Won the city prize, 2 of 40 entries.",
    ]);

    const bareWin = preprocessClaims(
      "Built the night ferry kiosk to win the harbor quiz bowl.",
      "bullet-6",
    );
    expect(bareWin.map((claim) => claim.text)).toEqual([
      "Built the night ferry kiosk",
      "win the harbor quiz bowl.",
    ]);

    const titledName = preprocessClaims(
      "Built the router for Mrs. Chen. Won the harbor quiz bowl.",
      "bullet-7",
    );
    expect(titledName.map((claim) => claim.text)).toEqual([
      "Built the router for Mrs. Chen.",
      "Won the harbor quiz bowl.",
    ]);

    const aside = preprocessClaims(
      "Built the router for Dr. Chen. The notes were short. Won the harbor quiz bowl.",
      "bullet-8",
    );
    expect(aside.map((claim) => claim.text)).toEqual([
      "Built the router for Dr. Chen. The notes were short.",
      "Won the harbor quiz bowl.",
    ]);
  });

  test("a single claim is never split", () => {
    const single = [
      "Built the portal with React, Postgres, and Redis.",
      "Served 1,200 students, 40 events, and 800 users.",
      "Cut the nightly job from 5 minutes to 8 seconds.",
      "Worked in a team of 6 on the Lumen catalog.",
      "Won the harbor quiz bowl (1 of 80 teams).",
      "Built the API and designed the schema for Lumen Ferry.",
      "Used Go, Rust, and Python for the batch job.",
      "Shipped v3.2.1 of the Northwind catalog.",
      "Filed notes for 12 students.",
      "Built the portal and selected libraries for the Lumen catalog.",
      "Built the router for Dr. Chen. The notes were short.",
      "Built the API. Designed the schema for Lumen Ferry.",
      "Built the portal and award-winning libraries.",
      "Built the portal. The competition was hard.",
      "Built the portal and admitted the notes were short.",
      "Designed the poster and the prize table.",
      "Led the desk. Awarded vendors sent the crates.",
    ];
    for (const statement of single) {
      const claims = preprocessClaims(statement, "only");
      expect(claims).toHaveLength(1);
      expect(claims[0]?.id).toBe("only");
      expect(claims[0]?.parentId).toBe("only");
      expect(claims[0]?.text).toBe(statement);
      expect(claims[0]?.statement).toBe(statement);
    }
  });
});

describe("determinism", () => {
  test("the same input is byte-identical", () => {
    const statement =
      "Led the night desk for Pylon Hall to win the harbor quiz, 1 of 400+ entries.";
    const once = JSON.stringify(preprocessClaims(statement, "parent-9"));
    const twice = JSON.stringify(preprocessClaims(statement, "parent-9"));
    expect(once).toBe(twice);

    const again = preprocessClaims(statement, "parent-9");
    expect(again).toEqual([
      {
        id: "parent-9#0",
        parentId: "parent-9",
        text: "Led the night desk for Pylon Hall",
        statement,
        facts: {
          selections: [],
          changes: [],
          percentages: [],
          counts: [],
          teamSize: null,
          ownership: "led",
        },
      },
      {
        id: "parent-9#1",
        parentId: "parent-9",
        text: "win the harbor quiz, 1 of 400+ entries.",
        statement,
        facts: {
          selections: [
            { kind: "ratio", selected: 1, pool: 400, rate: 1 / 400, poolLowerBound: true },
          ],
          changes: [],
          percentages: [],
          counts: [],
          teamSize: null,
          ownership: null,
        },
      },
    ]);
  });
});
