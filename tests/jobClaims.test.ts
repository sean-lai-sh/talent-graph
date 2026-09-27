import { describe, expect, test } from "bun:test";
import {
  countsTowardSubstance,
  type JobSplitOptions,
  preprocessClaims,
  preprocessJobClaims,
  type SplitClaim,
} from "../src/longitudinal/claimPreprocess.ts";

const V12: JobSplitOptions = { version: "1.2.0" };

function outline(claim: SplitClaim) {
  const dated = "claimClass" in claim ? claim : null;
  return {
    id: claim.id,
    parentId: claim.parentId,
    claimClass: dated?.claimClass ?? null,
    text: claim.text,
    startedAt: dated?.startedAt ?? null,
    endedAt: dated?.endedAt ?? null,
    observedAt: dated?.observedAt ?? null,
    noWorkDescribed: dated?.noWorkDescribed === true,
    ownership: claim.facts.ownership,
    selectionRates: claim.facts.selections.map((selection) => selection.rate),
  };
}

function jobClass(claim: SplitClaim): "selection" | "output" | null {
  return "claimClass" in claim ? claim.claimClass : null;
}

function datedOf(claim: SplitClaim | undefined) {
  if (claim === undefined || !("claimClass" in claim)) throw new Error("expected a job claim");
  return claim;
}

describe("career_evidence@1.2.0 job split", () => {
  test("a job with N bullets yields one selection claim and N output claims", () => {
    const statement = [
      "Engineer at Harborline (Jan 2020 - Mar 2021)",
      "- Built the kiosk",
      "- Designed the lamp",
      "- Shipped the ferry",
    ].join("\n");
    const claims = preprocessJobClaims([{ id: "job", statement, publishedAt: null }], V12);
    expect(claims.map(outline)).toEqual([
      {
        id: "job#hire",
        parentId: "job",
        claimClass: "selection",
        text: "Engineer at Harborline (Jan 2020 - Mar 2021)",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2020-01-01",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [],
      },
      {
        id: "job#1",
        parentId: "job#1",
        claimClass: "output",
        text: "Built the kiosk",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2021-03-01",
        noWorkDescribed: false,
        ownership: "built",
        selectionRates: [],
      },
      {
        id: "job#2",
        parentId: "job#2",
        claimClass: "output",
        text: "Designed the lamp",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2021-03-01",
        noWorkDescribed: false,
        ownership: "built",
        selectionRates: [],
      },
      {
        id: "job#3",
        parentId: "job#3",
        claimClass: "output",
        text: "Shipped the ferry",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2021-03-01",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [],
      },
    ]);
    expect(claims.filter((claim) => jobClass(claim) === "selection")).toHaveLength(1);
    expect(claims.filter((claim) => jobClass(claim) === "output")).toHaveLength(3);
  });

  test("bullets that repeat the header share one selection claim", () => {
    const header = "Engineer at Harborline (Jan 2020 - Mar 2021)";
    const claims = preprocessJobClaims(
      [
        { id: "b1", statement: `${header}: Built the kiosk`, publishedAt: null },
        { id: "b2", statement: `${header}: Designed the lamp`, publishedAt: null },
        { id: "b3", statement: `${header}: Shipped the ferry`, publishedAt: null },
      ],
      V12,
      "output",
    );
    expect(claims.map((claim) => [claim.id, jobClass(claim), claim.text])).toEqual([
      ["b1#hire", "selection", header],
      ["b1", "output", "Built the kiosk"],
      ["b2", "output", "Designed the lamp"],
      ["b3", "output", "Shipped the ferry"],
    ]);
    expect(claims.filter((claim) => jobClass(claim) === "selection")).toHaveLength(1);
  });

  test("a different start date is a different job", () => {
    const claims = preprocessJobClaims(
      [
        {
          id: "early",
          statement: "Engineer at Harborline (Jan 2020 - Mar 2021): Built the kiosk",
          publishedAt: null,
        },
        {
          id: "late",
          statement: "Engineer at Harborline (Apr 2022 - May 2023): Built the ferry",
          publishedAt: null,
        },
      ],
      V12,
    );
    expect(claims.map((claim) => claim.id)).toEqual(["early#hire", "early", "late#hire", "late"]);
  });

  test("a bullet with its own selection fact still splits as in 1.1.1", () => {
    const body = "Built the routing service; selected as 1 of 400 applicants.";
    const statement = `Engineer at Harborline (Jan 2020 - Mar 2021): ${body}`;
    const claims = preprocessJobClaims(
      [{ id: "bullet-1", statement, publishedAt: null }],
      V12,
      "output",
    );
    expect(claims.map(outline)).toEqual([
      {
        id: "bullet-1#hire",
        parentId: "bullet-1",
        claimClass: "selection",
        text: "Engineer at Harborline (Jan 2020 - Mar 2021)",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2020-01-01",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [],
      },
      {
        id: "bullet-1#0",
        parentId: "bullet-1",
        claimClass: "output",
        text: "Built the routing service",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2021-03-01",
        noWorkDescribed: false,
        ownership: "built",
        selectionRates: [],
      },
      {
        id: "bullet-1#1",
        parentId: "bullet-1",
        claimClass: "selection",
        text: "selected as 1 of 400 applicants.",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2020-01-01",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [1 / 400],
      },
    ]);
    expect(preprocessClaims(body, "bullet-1").map((claim) => claim.text)).toEqual([
      "Built the routing service",
      "selected as 1 of 400 applicants.",
    ]);
  });

  test("a header-only job is flagged no_work_described and is not a zero score", () => {
    const claims = preprocessJobClaims(
      [
        {
          id: "empty",
          statement: "Engineer at Harborline (Jan 2020 - Mar 2021)",
          publishedAt: null,
        },
      ],
      V12,
    );
    expect(claims.map(outline)).toEqual([
      {
        id: "empty#hire",
        parentId: "empty",
        claimClass: "selection",
        text: "Engineer at Harborline (Jan 2020 - Mar 2021)",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2020-01-01",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [],
      },
      {
        id: "empty#no-work",
        parentId: "empty",
        claimClass: "output",
        text: "Engineer at Harborline (Jan 2020 - Mar 2021)",
        startedAt: "2020-01-01",
        endedAt: "2021-03-01",
        observedAt: "2021-03-01",
        noWorkDescribed: true,
        ownership: null,
        selectionRates: [],
      },
    ]);
    const output = claims[1];
    if (output === undefined) throw new Error("missing output");
    expect(datedOf(output).noWorkDescribed).toBe(true);
    expect(countsTowardSubstance(output)).toBe(false);
    expect(countsTowardSubstance(claims[0]!)).toBe(true);
    expect(output).not.toHaveProperty("claimValue");
  });

  test("mixed bullets outside a job match the 1.1.1 split", () => {
    const statement =
      "Built the routing service for Harborline Transit; selected as 1 of 400 applicants.";
    const claims = preprocessJobClaims(
      [{ id: "bullet-1", statement, publishedAt: null }],
      V12,
      "both",
    );
    expect(claims).toEqual(preprocessClaims(statement, "bullet-1"));
    expect(claims.map((claim) => claim.text)).toEqual([
      "Built the routing service for Harborline Transit",
      "selected as 1 of 400 applicants.",
    ]);
    expect(claims.every((claim) => !Object.hasOwn(claim, "claimClass"))).toBe(true);
    expect(claims.every((claim) => !Object.hasOwn(claim, "startedAt"))).toBe(true);
  });

  test("month-year, year-only, Present, Current, and missing dates", () => {
    const month = preprocessClaims(
      "Engineer at Harborline (Jan 2020 - Mar 2021): Built the kiosk",
      "month",
      { version: "1.2.0", publishedAt: "2024-05-31T00:00:00.000Z" },
    );
    expect(
      month.map((claim) => {
        const dated = datedOf(claim);
        return [dated.claimClass, dated.startedAt, dated.endedAt, dated.observedAt];
      }),
    ).toEqual([
      ["selection", "2020-01-01", "2021-03-01", "2020-01-01"],
      ["output", "2020-01-01", "2021-03-01", "2021-03-01"],
    ]);

    const years = preprocessClaims(
      "Engineer at Harborline (2019 - 2021): Built the kiosk",
      "years",
      V12,
    );
    expect(years.map((claim) => [datedOf(claim).startedAt, datedOf(claim).endedAt])).toEqual([
      ["2019-01-01", "2021-01-01"],
      ["2019-01-01", "2021-01-01"],
    ]);

    const slash = preprocessClaims(
      "Engineer at Harborline (01/2020 - 03/2021): Built the kiosk",
      "slash",
      V12,
    );
    expect(datedOf(slash[0]).startedAt).toBe("2020-01-01");
    expect(datedOf(slash[0]).endedAt).toBe("2021-03-01");

    const spelled = preprocessClaims(
      "Engineer at Harborline, Jan 2024 to May 2024: Built the kiosk",
      "to",
      V12,
    );
    expect(
      spelled.map((claim) => {
        const dated = datedOf(claim);
        return [dated.startedAt, dated.endedAt, dated.observedAt];
      }),
    ).toEqual([
      ["2024-01-01", "2024-05-01", "2024-01-01"],
      ["2024-01-01", "2024-05-01", "2024-05-01"],
    ]);

    const present = preprocessClaims(
      "Engineer at Harborline (Jan 2020 - Present): Built the kiosk",
      "present",
      { version: "1.2.0", publishedAt: "2024-05-31T00:00:00.000Z" },
    );
    expect(
      present.map((claim) => {
        const dated = datedOf(claim);
        return [dated.claimClass, dated.startedAt, dated.endedAt, dated.observedAt];
      }),
    ).toEqual([
      ["selection", "2020-01-01", null, "2020-01-01"],
      ["output", "2020-01-01", null, "2024-05-31"],
    ]);

    const current = preprocessClaims(
      "Engineer at Harborline (Jan 2020 - Current): Built the kiosk",
      "current",
      { version: "1.2.0", publishedAt: "2024-06-30T00:00:00.000Z" },
    );
    expect(datedOf(current[0]).endedAt).toBeNull();
    expect(datedOf(current[0]).observedAt).toBe("2020-01-01");
    expect(datedOf(current[1]).observedAt).toBe("2024-06-30");

    const missing = preprocessClaims("Engineer at Harborline: Built the kiosk", "missing", {
      version: "1.2.0",
      publishedAt: null,
    });
    expect(
      missing.map((claim) => {
        const dated = datedOf(claim);
        return [dated.startedAt, dated.endedAt, dated.observedAt];
      }),
    ).toEqual([
      [null, null, null],
      [null, null, null],
    ]);

    const open = preprocessClaims("Engineer at Harborline (Jun 2024): Built the kiosk", "open", {
      version: "1.2.0",
      publishedAt: "2024-06-30T00:00:00.000Z",
    });
    expect(
      open.map((claim) => {
        const dated = datedOf(claim);
        return [dated.claimClass, dated.startedAt, dated.endedAt, dated.observedAt];
      }),
    ).toEqual([
      ["selection", "2024-06-01", null, "2024-06-01"],
      ["output", "2024-06-01", null, "2024-06-30"],
    ]);
  });

  test("the default preprocess path does not job-split", () => {
    const statement = "Engineer at Harborline (Jan 2020 - Mar 2021): Built the kiosk";
    const legacy = preprocessClaims(statement, "job");
    expect(legacy.map((claim) => [claim.id, claim.parentId, claim.text, claim.statement])).toEqual([
      ["job", "job", statement, statement],
    ]);
    expect(Object.hasOwn(legacy[0] ?? {}, "claimClass")).toBe(false);
    expect(Object.hasOwn(legacy[0] ?? {}, "startedAt")).toBe(false);
    const opted = preprocessClaims(statement, "job", V12);
    expect(opted.map((claim) => jobClass(claim))).toEqual(["selection", "output"]);
  });

  test("a YC acceptance is the founder's selection claim, observed on the round date", () => {
    const statement = [
      "Founder at Pine Widget (Jan 2018 - Present)",
      "- Accepted into Y Combinator in Jun 2019",
      "- Shipped the editor",
    ].join("\n");
    const claims = preprocessJobClaims(
      [{ id: "pine", statement, publishedAt: "2020-01-15T00:00:00.000Z" }],
      V12,
      "output",
    );
    expect(claims.map(outline)).toEqual([
      {
        id: "pine#funding",
        parentId: "pine",
        claimClass: "selection",
        text: "Accepted into Y Combinator in Jun 2019",
        startedAt: "2019-06-01",
        endedAt: null,
        observedAt: "2019-06-01",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [],
      },
      {
        id: "pine#2",
        parentId: "pine#2",
        claimClass: "output",
        text: "Shipped the editor",
        startedAt: "2018-01-01",
        endedAt: null,
        observedAt: "2020-01-15",
        noWorkDescribed: false,
        ownership: null,
        selectionRates: [],
      },
    ]);
  });

  test("a top-fund raise is the founder's selection claim, with the round date", () => {
    const statement = [
      "Co-founder at Lumen Ferry (Mar 2020 - Dec 2021)",
      "- Raised a seed round from Sequoia in Mar 2020",
      "- Built the routing service",
    ].join("\n");
    const claims = preprocessJobClaims([{ id: "ferry", statement, publishedAt: null }], V12);
    expect(
      claims.map((claim) => [claim.id, jobClass(claim), claim.text, datedOf(claim).observedAt]),
    ).toEqual([
      ["ferry#funding", "selection", "Raised a seed round from Sequoia in Mar 2020", "2020-03-01"],
      ["ferry#2", "output", "Built the routing service", "2021-12-01"],
    ]);
    expect(datedOf(claims[1]).startedAt).toBe("2020-03-01");
    expect(datedOf(claims[1]).endedAt).toBe("2021-12-01");
    expect(claims[1]?.facts.ownership).toBe("built");
  });

  test("an unfunded founder gets no selection claim", () => {
    const statement = [
      "Founder at Lumen Ferry (2020 - 2021)",
      "- Raised $20k from friends and family",
      "- Built the booth",
    ].join("\n");
    const claims = preprocessJobClaims([{ id: "boot", statement, publishedAt: null }], V12);
    expect(claims.map((claim) => [jobClass(claim), claim.text])).toEqual([
      ["output", "Raised $20k from friends and family"],
      ["output", "Built the booth"],
    ]);
    expect(claims.some((claim) => jobClass(claim) === "selection")).toBe(false);

    const headerOnly = preprocessJobClaims(
      [{ id: "bare", statement: "Founder at Pine Widget (2019 - Present)", publishedAt: null }],
      V12,
    );
    expect(
      headerOnly.map((claim) => [claim.id, jobClass(claim), datedOf(claim).noWorkDescribed]),
    ).toEqual([["bare#no-work", "output", true]]);
  });

  test("an employee who mentions a fund is still a hire, and claim_class is ignored", () => {
    const statement = "Engineer at Harborline (Jan 2020 - Mar 2021): Built the kiosk";
    const asOutput = preprocessJobClaims(
      [{ id: "e", statement, publishedAt: null }],
      V12,
      "output",
    );
    const asSelection = preprocessJobClaims(
      [{ id: "e", statement, publishedAt: null }],
      V12,
      "selection",
    );
    const asBoth = preprocessJobClaims([{ id: "e", statement, publishedAt: null }], V12, "both");
    expect(asOutput).toEqual(asSelection);
    expect(asOutput).toEqual(asBoth);
    expect(asOutput[0]?.id).toBe("e#hire");
    expect(asOutput[0]?.text).toBe("Engineer at Harborline (Jan 2020 - Mar 2021)");

    const fundedBullet = preprocessJobClaims(
      [
        {
          id: "e2",
          statement:
            "Engineer at Harborline (Jan 2020 - Mar 2021): Raised a seed round from Sequoia in Jan 2020",
          publishedAt: null,
        },
      ],
      V12,
      "output",
    );
    expect(fundedBullet.map((claim) => [claim.id, jobClass(claim), claim.text])).toEqual([
      ["e2#hire", "selection", "Engineer at Harborline (Jan 2020 - Mar 2021)"],
      ["e2", "output", "Raised a seed round from Sequoia in Jan 2020"],
    ]);
  });

  test("the same resume is byte-identical", () => {
    const lines = [
      {
        id: "job",
        statement: "Engineer at Harborline (Jan 2020 - Present): Built the kiosk",
        publishedAt: "2024-05-31T00:00:00.000Z",
      },
    ];
    expect(JSON.stringify(preprocessJobClaims(lines, V12))).toBe(
      JSON.stringify(preprocessJobClaims(lines, V12, "both")),
    );
  });
});
