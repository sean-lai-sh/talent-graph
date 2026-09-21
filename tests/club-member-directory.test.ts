import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialState } from "../apps/club/lib/engine.ts";
import {
  contactHref,
  directoryEmail,
  toDirectoryMembers,
} from "../apps/club/lib/memberDirectory.ts";

const root = join(import.meta.dir, "..");

describe("member directory", () => {
  test("table rows are name, LinkedIn, email; candidates stay out", () => {
    const rows = toDirectoryMembers([
      {
        id: "p-ada",
        name: "Ada Cole",
        status: "member",
        email: "ada@club.edu",
        linkedin: "linkedin.com/in/adacole",
      },
      {
        id: "p-cleo",
        name: "Cleo Marsh",
        status: "candidate",
        email: "cleo@club.edu",
        linkedin: "https://www.linkedin.com/in/cleomarsh",
      },
      { id: "p-bea", name: "Bea Shah", status: "archived" },
    ]);
    expect(rows).toEqual([
      {
        id: "p-ada",
        name: "Ada Cole",
        email: "ada@club.edu",
        linkedin: "linkedin.com/in/adacole",
      },
    ]);
    expect(directoryEmail("Ada Cole")).toBe("ada.cole@techatnyu.org");
    expect(directoryEmail("Ada Cole", " ADA@Club.EDU ")).toBe("ada@club.edu");
    expect(contactHref("linkedin.com/in/adacole")).toBe("https://linkedin.com/in/adacole");

    const seed = toDirectoryMembers(initialState().people);
    expect(seed.length).toBeGreaterThan(0);
    expect(seed.some((row) => row.name === "Cleo Marsh")).toBe(false);
    expect(seed.every((row) => row.email.includes("@"))).toBe(true);
    expect(seed.some((row) => Boolean(row.linkedin))).toBe(true);
  });

  test("member chrome is a table, not cards; compose box has a floor", () => {
    const chrome = readFileSync(join(root, "apps/club/components/shell/MemberChrome.tsx"), "utf8");
    const list = readFileSync(join(root, "apps/club/components/members/MemberList.tsx"), "utf8");
    const css = readFileSync(join(root, "apps/club/app/globals.css"), "utf8");
    const club = readFileSync(join(root, "apps/club/convex/club.ts"), "utf8");
    const preview = readFileSync(
      join(root, "apps/club/app/demo/home/MemberHomePreview.tsx"),
      "utf8",
    );
    expect(chrome).toContain('label: "Member List"');
    expect(list).toContain("<table");
    expect(list).toContain("Name");
    expect(list).toContain("LinkedIn");
    expect(list).toContain("Email");
    expect(list).not.toContain("member-card");
    expect(list).not.toContain("No contact on file.");
    expect(list).not.toContain("v2Signal");
    expect(css).toContain(".member-table");
    expect(css).toContain(".forum-compose textarea");
    expect(css).toContain("min-height: 7.5rem");
    expect(club).toContain("export const listMembers");
    expect(preview).toContain("toDirectoryMembers");
  });
});
