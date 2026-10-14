import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_DATA_LABEL, UNKNOWN_VALUE } from "../apps/club/lib/copy.ts";
import { initialState } from "../apps/club/lib/engine.ts";
import {
  exampleEmail,
  exampleMembers,
  exampleName,
  parseDemoHash,
} from "../apps/club/lib/exampleDemo.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const DEMO_SOURCES = [
  "apps/club/app/demo/page.tsx",
  "apps/club/app/demo/AdminDemo.tsx",
  "apps/club/app/demo/home/page.tsx",
  "apps/club/app/demo/home/MemberHomePreview.tsx",
  "apps/club/lib/exampleDemo.ts",
  "apps/club/components/shell/ExampleNote.tsx",
];

describe("public /demo admin preview", () => {
  test("demo pages stay public and do not call admin Convex queries", () => {
    const demo = read("apps/club/app/demo/page.tsx");
    const admin = read("apps/club/app/demo/AdminDemo.tsx");
    expect(demo).toContain("loadClub()");
    expect(demo).toContain("AdminDemo");
    expect(demo).not.toContain("MemberHome");
    expect(admin).toContain('clubRole="admin"');
    expect(admin).toContain("ExampleNote");
    expect(admin).toContain("ClubBoard");
    for (const rel of DEMO_SOURCES) {
      const source = read(rel);
      expect(source).not.toContain("getBoard");
      expect(source).not.toContain("getOrganization");
      expect(source).not.toContain("useQuery");
      expect(source).not.toContain("PersistedClub");
      expect(source).not.toContain("convex/react");
      expect(source).not.toContain("auth-server");
    }
  });

  test("server admin gates are unchanged", () => {
    const club = read("apps/club/convex/club.ts");
    expect(club).toContain('throw new Error("admin only")');
    expect(club).toContain("loadOrgForSession");
    expect(club).toContain("export const getBoard");
    expect(club).toContain("export const getOrganization");
    expect(club).toContain("return adminRead(role, org)");
  });

  test("directory rows are names at example.test, with no phone, weight, or referrer", () => {
    expect(exampleName("  ")).toBe(UNKNOWN_VALUE);
    expect(exampleName("Ada Quill")).toBe("Ada Quill");
    expect(exampleEmail("Ada Quill")).toBe("ada.quill@example.test");
    const rows = exampleMembers(initialState().people);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.name).not.toBe(row.id);
      expect(row.email.endsWith("@example.test")).toBe(true);
      expect(row.email.includes("techatnyu.org")).toBe(false);
      expect(row).not.toHaveProperty("phone");
      expect(row).not.toHaveProperty("weight");
      expect(row).not.toHaveProperty("referrer");
      if (row.linkedin) expect(row.linkedin.startsWith("https://example.test/")).toBe(true);
    }
  });

  test("demo hashes stay on the admin panes", () => {
    expect(parseDemoHash("")).toEqual({ pane: "council", settings: false });
    expect(parseDemoHash("#members")).toEqual({ pane: "members", settings: false });
    expect(parseDemoHash("#settings")).toEqual({ pane: "council", settings: true });
    expect(parseDemoHash("#weights")).toEqual({ pane: "council", settings: false });
    expect(EXAMPLE_DATA_LABEL).toBe("Example data");
  });
});
