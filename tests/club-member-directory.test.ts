import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialState } from "../apps/club/lib/engine.ts";
import { contactHref, toDirectoryMembers } from "../apps/club/lib/memberDirectory.ts";

const root = join(import.meta.dir, "..");

describe("member directory", () => {
  test("only admitted members and their contacts, never scores", () => {
    const rows = toDirectoryMembers([
      {
        id: "p-ada",
        name: "Ada Cole",
        status: "member",
        affiliation: "Tech@NYU",
        phone: "347-555-0100",
        linkedin: "linkedin.com/in/adacole",
      },
      {
        id: "p-cleo",
        name: "Cleo Marsh",
        status: "candidate",
        phone: "347-555-0199",
        linkedin: "https://www.linkedin.com/in/cleomarsh",
      },
      { id: "p-bea", name: "Bea Shah", status: "archived" },
    ]);
    expect(rows).toEqual([
      {
        id: "p-ada",
        name: "Ada Cole",
        affiliation: "Tech@NYU",
        phone: "347-555-0100",
        linkedin: "linkedin.com/in/adacole",
      },
    ]);
    expect(contactHref("linkedin.com/in/adacole")).toBe("https://linkedin.com/in/adacole");
    expect(contactHref("https://www.linkedin.com/in/adacole")).toBe(
      "https://www.linkedin.com/in/adacole",
    );

    const seed = toDirectoryMembers(initialState().people);
    expect(seed.length).toBeGreaterThan(0);
    expect(seed.some((row) => row.name === "Cleo Marsh")).toBe(false);
    expect(seed.every((row) => row.name.length > 0)).toBe(true);
    expect(seed.some((row) => Boolean(row.linkedin))).toBe(true);
  });

  test("member chrome and persist expose the directory, not engine math", () => {
    const chrome = readFileSync(join(root, "apps/club/components/shell/MemberChrome.tsx"), "utf8");
    const list = readFileSync(join(root, "apps/club/components/members/MemberList.tsx"), "utf8");
    const club = readFileSync(join(root, "apps/club/convex/club.ts"), "utf8");
    const preview = readFileSync(
      join(root, "apps/club/app/demo/home/MemberHomePreview.tsx"),
      "utf8",
    );
    expect(chrome).toContain('label: "Member List"');
    expect(list).toContain("LinkedIn");
    expect(list).toContain("No contact on file.");
    expect(list).not.toContain("v2Signal");
    expect(list).not.toContain("computeView");
    expect(club).toContain("export const listMembers");
    expect(club).toContain("toDirectoryMembers");
    expect(club).not.toContain("computeView(people");
    expect(preview).toContain("toDirectoryMembers");
    expect(preview).toContain("initialState()");
  });
});
