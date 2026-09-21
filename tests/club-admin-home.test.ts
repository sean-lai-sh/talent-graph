import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("member home + admin board", () => {
  test("member home is the sidebar forum from the wireframe", () => {
    const home = read("apps/club/app/members/MemberHome.tsx");
    const chrome = read("apps/club/components/shell/MemberChrome.tsx");
    const shell = read("apps/club/components/shell/SignedInShell.tsx");
    const forum = read("apps/club/components/forum/Forum.tsx");
    const schema = read("apps/club/convex/schema.ts");
    const club = read("apps/club/convex/club.ts");
    expect(chrome).toContain('label: "Forum"');
    expect(chrome).toContain('label: "Submit Referral"');
    expect(chrome).toContain('label: "Evaluations"');
    expect(chrome).toContain('label: "Upcoming Events"');
    expect(chrome).toContain("<Forum");
    expect(chrome).not.toContain('label: "Review"');
    expect(home).toContain("<MemberChrome");
    expect(home).toContain("api.club.listPosts");
    expect(home).toContain("api.club.addPost");
    expect(home).not.toContain("Signed in as");
    expect(forum).toContain("Write something");
    expect(forum).toContain("Post");
    expect(shell).toContain("Sign out");
    expect(shell).not.toContain("Signed in as");
    expect(schema).toContain("const clubPost");
    expect(schema).toContain("posts: v.optional");
    expect(club).toContain("export const listPosts");
    expect(club).toContain("export const addPost");
    expect(club).not.toContain("computeView(posts");
  });

  test("member door matches the wireframe and has no identity banner", () => {
    const page = read("apps/club/app/members/page.tsx");
    const shell = read("apps/club/app/members/MemberShell.tsx");
    const home = read("apps/club/app/members/MemberHome.tsx");
    expect(page).toContain('redirect(clubLoginHref("/members"))');
    expect(page).toContain("hasClubSession");
    expect(page).not.toContain("ClubBoard");
    expect(page).not.toContain("loadClub()");
    expect(shell).toContain("MemberSignInRedirect");
    expect(shell).toContain('clubLoginHref("/members")');
    expect(shell).toContain("SIGN_OUT_HREF");
    expect(shell).toContain("authClient.signOut");
    expect(shell).not.toContain("Signed in as");
    expect(home).toContain("<MemberChrome");
    expect(home).not.toContain("Signed in as");
  });

  test("hidden /demo/home previews the member chrome without auth", () => {
    const page = read("apps/club/app/demo/home/page.tsx");
    const demo = read("apps/club/app/demo/page.tsx");
    expect(page).toContain("MemberHomePreview");
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).not.toContain("auth-server");
    expect(page).not.toContain("hasClubSession");
    expect(demo).toContain("loadClub()");
    expect(demo).not.toContain("MemberHome");
  });
});
