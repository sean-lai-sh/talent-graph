import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXAMPLE_PEOPLE } from "../apps/club/fixtures/example-data.ts";
import { EXAMPLE_DATA_LABEL, UNKNOWN_VALUE } from "../apps/club/lib/copy.ts";
import { computeView } from "../apps/club/lib/engine.ts";
import {
  exampleDirectory,
  exampleForumPost,
  exampleName,
  parseDemoHash,
} from "../apps/club/lib/exampleDemo.ts";
import { exampleBoard, exampleInputs } from "../apps/club/lib/exampleScore.ts";
import { roundAverageOf } from "../apps/club/lib/format.ts";
import type { ClubView } from "../apps/club/lib/types.ts";

const root = join(import.meta.dir, "..");

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push() {},
    replace() {},
  }),
}));

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type Spec = { spec: string; typeOnly: boolean };

/** Value and type import specifiers, plus dynamic import(). */
function importSpecs(source: string): Spec[] {
  const clean = stripComments(source);
  const found: Spec[] = [];
  const fromRe = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\sfrom\s*["']([^"']+)["']/g;
  for (const match of clean.matchAll(fromRe)) {
    const clause = match[1] ?? "";
    found.push({ spec: match[2] ?? "", typeOnly: /^\s*type\b/.test(clause) });
  }
  const sideRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (const match of clean.matchAll(sideRe)) {
    found.push({ spec: match[1] ?? "", typeOnly: false });
  }
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of clean.matchAll(dynamicRe)) {
    found.push({ spec: match[1] ?? "", typeOnly: false });
  }
  return found;
}

function resolveFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  if (spec.startsWith(".")) return resolveFile(join(dirname(fromFile), spec));
  if (spec.startsWith("@/")) return resolveFile(join(root, "apps/club", spec.slice(2)));
  return null;
}

const CONVEX_SPEC =
  /(?:^|\/)convex(?:\/|$)|convex\/_generated|convex\/react|convex\/browser|convex\/server/;

const QUERY_CALL =
  /\b(?:useQuery|useMutation|useAction|useConvex|fetchQuery|fetchMutation|fetchAuthQuery|ConvexHttpClient|ConvexReactClient)\b|\bapi\.(?:club|referral|comparisonStep|auth|evidence)\b|\b(?:getBoard|getOrganization|listMembers|listPosts|listMyFeedback|getMyRole|lookupReferralContact|requireAdmin)\b/;

const DEMO_ENTRIES = ["apps/club/app/demo/page.tsx", "apps/club/app/demo/home/page.tsx"];

const CLIENT_ENTRIES = [
  "apps/club/app/demo/AdminDemo.tsx",
  "apps/club/app/demo/home/MemberHomePreview.tsx",
];

const SCORE_CALL =
  /\b(?:computeView|generateSeed|runClubPass|computeCapabilityVectors|computeAllReferralSignals|advance|cohortAverage|roundAverageOf)\s*\(/;

/** Client modules reachable from `/demo`, stopping at a server-action boundary. */
function clientDemoFiles(): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const queue = CLIENT_ENTRIES.map((rel) => join(root, rel));
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use server["']/.test(source)) continue;
    files.push(file);
    for (const item of importSpecs(source)) {
      if (item.typeOnly) continue;
      if (!item.spec.startsWith(".") && !item.spec.startsWith("@/")) continue;
      const next = resolveLocal(file, item.spec);
      if (!next) throw new Error(`unresolved ${item.spec} from ${file}`);
      if (!seen.has(next)) queue.push(next);
    }
  }
  return files;
}

function engineNumbers(view: ClubView) {
  return view.people.map((person) => ({
    id: person.id,
    v0Signal: person.v0Signal,
    v2Signal: person.v2Signal,
    strongest: person.strongest,
    referrals: person.referrals.map((row) => [row.referralId, row.strength, row.multiplier]),
    dimensions: person.dimensions.map((row) => [row.dimension, row.state, row.percentile]),
  }));
}

function demoImportGraph(): Map<string, string> {
  const reached = new Map<string, string>();
  const queue = DEMO_ENTRIES.map((rel) => join(root, rel));
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || reached.has(file)) continue;
    reached.set(file, stripComments(readFileSync(file, "utf8")));
    for (const item of importSpecs(reached.get(file) ?? "")) {
      if (item.typeOnly) continue;
      if (!item.spec.startsWith(".") && !item.spec.startsWith("@/")) continue;
      const next = resolveLocal(file, item.spec);
      if (!next) throw new Error(`unresolved ${item.spec} from ${file}`);
      if (!reached.has(next)) queue.push(next);
    }
  }
  return reached;
}

describe("public /demo admin preview", () => {
  test("example rows are a static fixture of fake names, ids, and phones", () => {
    expect(exampleName("  ")).toBe(UNKNOWN_VALUE);
    expect(exampleName("Ada Example")).toBe("Ada Example");
    const source = read("apps/club/fixtures/example-data.ts");
    expect(source).not.toContain("convex");
    expect(source).not.toContain("initialState");
    expect(source).not.toContain("generateSeed");
    const rows = exampleDirectory();
    const members = EXAMPLE_PEOPLE.filter((person) => person.status === "member");
    expect(rows.map((row) => row.id)).toEqual(
      [...members]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((person) => person.id),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.id.startsWith("example-")).toBe(true);
      expect(row.name).not.toBe(row.id);
      expect(row.name).toMatch(/Example|Fixture|Sample|Placeholder/);
      expect(row.email.endsWith("@example.test")).toBe(true);
      expect(row.email.includes("techatnyu.org")).toBe(false);
      expect(row.phone).toMatch(/^\+1-555-01\d\d$/);
      expect(row).not.toHaveProperty("weight");
      expect(row).not.toHaveProperty("referrer");
      if (row.linkedin) expect(row.linkedin.startsWith("https://example.test/")).toBe(true);
    }
    expect(rows.some((row) => row.linkedin === undefined)).toBe(true);
    const post = exampleForumPost();
    expect(post.authorName).toBe("Ada Example");
    expect(post.body).toContain(EXAMPLE_DATA_LABEL);
    expect(read("apps/club/lib/exampleDemo.ts")).not.toContain("initialState");
    expect(read("apps/club/app/demo/home/MemberHomePreview.tsx")).not.toContain("initialState");
    expect(read("apps/club/app/demo/AdminDemo.tsx")).not.toContain("exampleMembers");
  });

  test("/demo and everything it imports never imports or calls a Convex query", () => {
    const graph = demoImportGraph();
    const rels = [...graph.keys()].map((file) => file.slice(root.length + 1));
    expect(rels).toContain("apps/club/fixtures/example-data.ts");
    expect(rels).toContain("apps/club/components/referral/ReferralSignupForm.tsx");
    expect(rels).not.toContain("apps/club/components/referral/ReferralSignup.tsx");
    expect(rels.some((rel) => rel.startsWith("apps/club/convex/"))).toBe(false);

    for (const [file, source] of graph) {
      const rel = file.slice(root.length + 1);
      for (const item of importSpecs(source)) {
        expect(CONVEX_SPEC.test(item.spec), `${rel} imports ${item.spec}`).toBe(false);
      }
      expect(QUERY_CALL.test(source), `${rel} calls a Convex query`).toBe(false);
    }
  });

  test("demo numbers are the scoring engine's output for the fixture", () => {
    const fixture = stripComments(read("apps/club/fixtures/example-data.ts"));
    expect(fixture).not.toMatch(/\bweight\b/);
    expect(fixture).not.toMatch(/\bv2Signal\b/);
    expect(fixture).not.toMatch(/\bpercentile\b/);
    expect(fixture).not.toMatch(/\bscore\b/);
    const inputs = exampleInputs();
    expect(inputs.evaluations).toEqual([]);
    expect(inputs.outcomes).toEqual([]);
    expect(inputs.comparisons.every((row) => row.weight === undefined)).toBe(true);
    expect(inputs.people.every((person) => !("v2Signal" in person))).toBe(true);

    const engine = computeView(inputs);
    const shown = exampleBoard();
    expect(engineNumbers(shown.view)).toEqual(engineNumbers(engine));
    expect(shown.roundAverage).toBe(roundAverageOf(engine.people));
    expect(shown.view.people.some((person) => person.v2Signal !== null)).toBe(true);

    const page = read("apps/club/app/demo/page.tsx");
    expect(page).toContain("exampleBoard()");
    expect(read("apps/club/lib/exampleScore.ts")).toContain("computeView(state)");
    const clientFiles = clientDemoFiles().map((file) => file.slice(root.length + 1));
    expect(clientFiles).not.toContain("apps/club/lib/exampleScore.ts");
    expect(clientFiles).not.toContain("apps/club/lib/engine.ts");
    expect(clientFiles).not.toContain("apps/club/components/referral/previewLadder.ts");
    for (const rel of clientFiles) {
      if (rel === "apps/club/lib/format.ts") continue;
      expect(SCORE_CALL.test(stripComments(read(rel))), `${rel} scores in client code`).toBe(false);
    }
  });

  test("demo pages render every screen with the example-data label and no sign-in", async () => {
    const React = (await import(join(root, "apps/club/node_modules/react/index.js"))) as {
      createElement: (type: unknown) => unknown;
    };
    const { renderToStaticMarkup } = (await import(
      join(root, "apps/club/node_modules/react-dom/server.node.js")
    )) as { renderToStaticMarkup: (node: unknown) => string };
    const demoSpec = join(root, "apps/club/app/demo/page.tsx");
    const homeSpec = join(root, "apps/club/app/demo/home/page.tsx");
    const { default: DemoPage } = (await import(demoSpec)) as { default: () => unknown };
    const { default: HomePage } = (await import(homeSpec)) as { default: () => unknown };

    const demo = renderToStaticMarkup(React.createElement(DemoPage));
    const home = renderToStaticMarkup(React.createElement(HomePage));

    for (const html of [demo, home]) {
      const header = html.match(/<header class="signed-bar">[\s\S]*?<\/header>/)?.[0] ?? "";
      expect(header).toContain(EXAMPLE_DATA_LABEL);
      expect(header).toContain('role="note"');
      expect(html).toContain("Ada Example");
      expect(html).toContain("+1-555-0100");
      expect(html).toContain(UNKNOWN_VALUE);
      expect(html).not.toContain("Sign in");
      expect(html).not.toContain("Sign out");
      expect(html).not.toContain("Create account");
      for (const label of [
        "Forum",
        "Submit Referral",
        "Member List",
        "Evaluations",
        "Upcoming Events",
      ]) {
        expect(html).toContain(label);
      }
      expect(html).toContain("No feedback requests waiting.");
      expect(html).toContain("No upcoming events.");
      expect(html).toContain("Email or phone");
    }

    const board = exampleBoard();
    const cy = board.view.people.find((person) => person.id === "example-cy");
    expect(cy?.v2Signal).not.toBeNull();
    expect(demo).toContain("Council");
    expect(demo).toContain("Cy Sample");
    expect(demo).toContain(`>${cy?.v2Signal}<`);
    expect(demo).toContain(`the round average of ${board.roundAverage}`);
    expect(demo).toContain("Tech@NYU");
    expect(demo).toContain('aria-label="Admin"');
    expect(home).toContain('aria-label="Member"');
    expect(home).not.toContain(`>${cy?.v2Signal}<`);
  });

  test("server admin gates are unchanged", () => {
    const club = read("apps/club/convex/club.ts");
    expect(club).toContain('throw new Error("admin only")');
    expect(club).toContain("loadOrgForSession");
    expect(club).toContain("export const getBoard");
    expect(club).toContain("export const getOrganization");
    expect(club).toContain("return adminRead(role, org)");
    expect(club).toContain("export const listMembers");
    expect(club).toContain("export const listPosts");
    expect(club).toContain("export const listMyFeedback");
  });

  test("demo hashes stay on the admin panes", () => {
    expect(parseDemoHash("")).toEqual({ pane: "council", settings: false });
    expect(parseDemoHash("#members")).toEqual({ pane: "members", settings: false });
    expect(parseDemoHash("#settings")).toEqual({ pane: "council", settings: true });
    expect(parseDemoHash("#weights")).toEqual({ pane: "council", settings: false });
    expect(EXAMPLE_DATA_LABEL).toBe("Example data");
  });
});
