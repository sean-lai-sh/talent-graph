import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type SmokeItem } from "../scripts/jev-claim-smoke.ts";
import type { V11JevClient } from "../scripts/jev-claim-smoke-v11.ts";
import type { V12JevClient } from "../scripts/jev-claim-smoke-v12.ts";
import type { JevJudgmentService } from "../src/longitudinal/judgments.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import { fixtureAnswers, fixtureV12Client } from "./fixtures/jev-claim-smoke-v12-client.ts";

const fixturePath = join(import.meta.dir, "fixtures/jev-claim-smoke-v12.items.json");
const RUBRIC_HASH = "cd500b05728594c6599e31e8aee5c6db81a2c7814aca61332dbd195b3fc662a6";
const CONFIG_HASH = "6aaa508fff88d6f3dedabf803f3b21ea9b20b6a1dec25911fff495ffe6e697f8";
const CONFIG_ID = "claim_value@1.2.0:6aaa508f";
const ROLLUP_HASH = "35a1b965b63e251f71c85be0a9ca43504584a800328bb4c73f59665ae5527efb";

const PRIVATE = [
  "Harborline",
  "Pine Widget",
  "Quiet Press",
  "Northwind",
  "40 club members",
  "YC W24",
  "example roster alpha",
  "ycombinator.com",
];

test("career_evidence@1.2.0 scores claims offline and rolls people up", async () => {
  const seen: { keys: string[]; roleSeed: string | null; selectionRate: number | null }[] = [];
  const client: V12JevClient = {
    systemOne(request) {
      seen.push({
        keys: Object.keys(request.questions),
        roleSeed: "role_seed" in request.state ? request.state.role_seed : null,
        selectionRate: request.state.selection_rate,
      });
      return fixtureV12Client().systemOne(request);
    },
  };
  const dir = await mkdtemp(join(tmpdir(), "jev-v12-"));
  const code = await main(
    ["--items", fixturePath, "--rubric", "career_evidence@1.2.0", "--out", dir],
    throwingV10(),
    throwingV11(),
    client,
  );
  expect(code).toBe(0);
  expect(
    seen.some((call) => call.keys.includes("pool_strength") && !call.keys.includes("role")),
  ).toBe(true);
  expect(seen.some((call) => call.keys.includes("role") && call.keys.includes("scale"))).toBe(true);
  expect(seen.every((call) => !call.keys.includes("generalized_impact"))).toBe(true);
  expect(seen.every((call) => !call.keys.includes("ownership"))).toBe(true);
  expect(seen.find((call) => call.roleSeed === "major_contributor")).toBeDefined();
  expect(seen.some((call) => call.selectionRate === 0.0025)).toBe(true);
  expect(seen.some((call) => call.selectionRate === 0.01)).toBe(true);

  const summary = await readFile(join(dir, "summary.md"), "utf8");
  const jsonl = await readFile(join(dir, "claims.jsonl"), "utf8");
  for (const phrase of PRIVATE) {
    expect(summary).not.toContain(phrase);
    expect(jsonl).not.toContain(phrase);
  }
  expect(summary).toContain("Rubric career_evidence@1.2.0.");
  expect(summary).toContain(`Rubric hash ${RUBRIC_HASH}.`);
  expect(summary).toContain(`Claim value ${CONFIG_ID}.`);
  expect(summary).toContain(`Claim value hash ${CONFIG_HASH}.`);
  expect(summary).toContain("Claims accepted 13. Review 1. Rejected 0.");
  expect(summary).toContain("Calls 16. Answered 16. judgment_unavailable 0. Invariant failures 0.");
  expect(summary).toContain("respondedModel fixture-v12.");
  expect(summary).toContain("### A");
  expect(summary).toContain("Jobs 4. Job selection claims 3. One selection claim per job: no.");
  expect(summary).toContain("Founders 2. Funding claims 1. Founders with no funding claim: 1.");
  expect(summary).toContain("Jobs 2. Job selection claims 2. One selection claim per job: yes.");
  expect(summary).toContain("Founders 0. Funding claims 0. Founders with no funding claim: 0.");
  expect(summary).toContain("| 1 | 1 |");
  expect(summary).toContain("| 3 | 1 |");
  expect(summary).toContain("| maintainer | 1 |");
  expect(summary).toContain("| minor_part | 1 |");
  expect(summary).toContain("### northwind");
  expect(summary).toContain("pool_strength 2.0000");
  expect(summary).toContain("### repeat");
  expect(summary).toContain("difficulty 2.0000");
  expect(summary).toContain("scale 1.0000");
  expect(summary).toContain(
    "Max absolute difference of expected level, resume B against resume A, zipped in input order.",
  );
  expect(summary).toContain(`Person rollup hash ${ROLLUP_HASH}.`);
  expect(summary).toContain("Alpha not_enough_cohort cohort 2 minimum 30");
  expect(summary).toContain(`person_rollup ${ROLLUP_HASH}.`);
  expect(summary).toContain("## Failures\n\nNone.");

  const rows = jsonl
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(rows).toHaveLength(14);
  const hire = rows.find((row) => row.claimId === "a-harbor#hire");
  const built = rows.find((row) => row.claimId === "a-harbor#1");
  const lamp = rows.find((row) => row.claimId === "a-harbor#2");
  const funding = rows.find((row) => row.claimId === "a-pine#funding");
  expect(hire).toMatchObject({
    itemId: "a-harbor",
    class: "selection",
    claimClass: "selection",
    status: "accepted",
    selectivity: 4,
    poolStrength: 2,
    role: null,
    claimValue: 0.3,
    rubricHash: RUBRIC_HASH,
    configHash: CONFIG_HASH,
    configId: CONFIG_ID,
  });
  expect(built).toMatchObject({
    class: "output",
    status: "accepted",
    difficulty: 2,
    scale: 1,
    role: "major_contributor",
    claimValue: 0.06,
  });
  expect(lamp).toMatchObject({
    status: "review",
    reviewReasons: ["dimension_low_confidence"],
  });
  expect(funding).toMatchObject({
    itemId: "a-pine",
    class: "funding",
    claimClass: "selection",
    status: "accepted",
  });
  expect(rows.some((row) => row.claimId === "a-quiet#funding")).toBe(false);
  expect(rows.every((row) => row.rubricId === "career_evidence@1.2.0")).toBe(true);
});

test("a transport failure stays on its claim and an invariant exits 1", async () => {
  const down = "Helped the example crew file notes.";
  const kept = "Engineer at Harborline (Jan 2020 - Mar 2021)\n- Built the kiosk";
  const items: SmokeItem[] = [
    item("down-item", "A", down, null),
    item("kept-item", "A", kept, null),
  ];
  const dir = await mkdtemp(join(tmpdir(), "jev-v12-down-"));
  const itemsPath = join(dir, "items.json");
  await Bun.write(itemsPath, JSON.stringify(items));
  const client: V12JevClient = {
    systemOne(request) {
      return {
        async withResponse() {
          if (request.state.text === down) throw new Error("socket down");
          return { data: { model: "fixture-v12", answers: fixtureAnswers(request) } };
        },
      };
    },
  };
  const code = await main(
    ["--items", itemsPath, "--rubric", "career_evidence@1.2.0", "--out", dir],
    throwingV10(),
    throwingV11(),
    client,
  );
  expect(code).toBe(0);
  const summary = await readFile(join(dir, "summary.md"), "utf8");
  expect(summary).toContain("judgment_unavailable");
  expect(summary).toContain("down-item");
  expect(summary).toContain("socket down");
  expect(summary).not.toContain(down);
  expect(summary).not.toContain("Built the kiosk");
  expect(summary).toContain("| kept-item#hire |");
  expect(summary).toContain("| accepted |");

  const broken: V12JevClient = {
    systemOne() {
      return {
        async withResponse() {
          throw new JudgmentInvariantError("broken legend");
        },
      };
    },
  };
  const invariantDir = await mkdtemp(join(tmpdir(), "jev-v12-invariant-"));
  const invariantCode = await main(
    ["--items", itemsPath, "--rubric", "career_evidence@1.2.0", "--out", invariantDir],
    throwingV10(),
    throwingV11(),
    broken,
  );
  expect(invariantCode).toBe(1);
  const invariant = await readFile(join(invariantDir, "summary.md"), "utf8");
  expect(invariant).toContain("Invariant failures");
  expect(invariant).toContain("broken legend");
  expect(invariant).not.toContain(down);
});

test("rubric flags disagree and an unknown rubric is rejected", async () => {
  await expect(
    main([
      "--items",
      fixturePath,
      "--out",
      "unused",
      "--spec",
      "career_evidence@1.0.0",
      "--rubric",
      "career_evidence@1.2.0",
    ]),
  ).rejects.toThrow("rubric flags disagree");
  await expect(
    main(["--items", fixturePath, "--out", "unused", "--rubric", "career_evidence@9.9.9"]),
  ).rejects.toThrow("unknown rubric career_evidence@9.9.9");
});

function throwingV10(): JevJudgmentService {
  return {
    identityFingerprint() {
      throw new Error("identity");
    },
    claimFingerprint() {
      throw new Error("fingerprint");
    },
    async assessIdentity() {
      throw new Error("identity");
    },
    async assessClaim() {
      throw new Error("1.0.0 assessClaim was called");
    },
  };
}

function throwingV11(): V11JevClient {
  return {
    systemOne() {
      throw new Error("1.1.0 client was called");
    },
  };
}

function item(id: string, resume: "A" | "B", statement: string, pair: string | null): SmokeItem {
  return {
    id,
    resume,
    org: "Example Lab",
    role: "Example Role",
    dates: "2024",
    statement,
    pair,
    publishedAt: "2024-01-01T00:00:00.000Z",
  };
}

test("one hire claim per job passes, including a bare selection", async () => {
  const summary = await jobsSummary([
    item("shift", "A", "Engineer at Example Lab (Jan 2020 - Mar 2021)\n- Built the kiosk", null),
    item(
      "north",
      "A",
      "Selected as 1 of 400 applicants from one school for the Example program.",
      null,
    ),
  ]);
  expect(summary).toContain("Jobs 2. Hire claims 2. One hire claim per job: yes.");
  expect(summary).toContain("Award claims 0.");
});

test("an award inside a job is reported and does not fail the hire check", async () => {
  const summary = await jobsSummary([
    item(
      "prize",
      "A",
      "Engineer at Example Lab (Jan 2020 - Mar 2021)\n- Won the example prize\n- Built the kiosk",
      null,
    ),
  ]);
  expect(summary).toContain("Jobs 1. Hire claims 1. One hire claim per job: yes.");
  expect(summary).toContain("Award claims 1: prize.");
  expect(summary).toContain("| prize#hire |");
});

test("a founder funding claim is that job's hire claim", async () => {
  const summary = await jobsSummary([
    item(
      "foundry",
      "A",
      "Founder at Example Foundry (Jan 2024 - Present)\n- Accepted into YC W24\n- Won the example prize",
      null,
    ),
  ]);
  expect(summary).toContain("Jobs 1. Hire claims 1. One hire claim per job: yes.");
  expect(summary).toContain("Award claims 1: foundry.");
  expect(summary).toContain("Founders 1. Funding claims 1. Founders with no funding claim: 0.");
  expect(summary).toContain("| foundry#funding |");
  expect(summary).not.toContain("#hire");
});

async function jobsSummary(items: SmokeItem[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jev-v12-jobs-"));
  const itemsPath = join(dir, "items.json");
  await Bun.write(itemsPath, JSON.stringify(items));
  const code = await main(
    ["--items", itemsPath, "--rubric", "career_evidence@1.2.0", "--out", dir],
    throwingV10(),
    throwingV11(),
    fixtureV12Client(),
  );
  expect(code).toBe(0);
  return readFile(join(dir, "summary.md"), "utf8");
}
