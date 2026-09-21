import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("admin landing + member shell", () => {
  test("admin home is a sidebar forum; review still mounts the board", () => {
    const admin = read("apps/club/app/club/AdminHome.tsx");
    const landing = read("apps/club/components/shell/AdminChrome.tsx");
    const forum = read("apps/club/components/forum/Forum.tsx");
    const chrome = read("apps/club/components/shell/SignedInShell.tsx");
    const schema = read("apps/club/convex/schema.ts");
    const club = read("apps/club/convex/club.ts");
    expect(landing).toContain('label: "Forum"');
    expect(landing).toContain('label: "Review"');
    expect(landing).toContain('label: "Evaluations"');
    expect(landing).toContain('label: "Events"');
    expect(landing).toContain("<Forum");
    expect(admin).toContain("<PersistedClub");
    expect(admin).toContain("<AdminChrome");
    expect(admin).toContain("api.club.listPosts");
    expect(admin).toContain("api.club.addPost");
    expect(admin).not.toContain("Signed in as");
    expect(forum).toContain("Write something");
    expect(forum).toContain("Post");
    expect(chrome).toContain("Sign out");
    expect(chrome).not.toContain("Signed in as");
    expect(schema).toContain("const clubPost");
    expect(schema).toContain("posts: v.optional");
    expect(club).toContain("export const listPosts");
    expect(club).toContain("export const addPost");
    expect(club).not.toContain("computeView(posts");
  });

  test("member home matches the wireframe and has no signed-in banner", () => {
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
    expect(home).toContain("Submit Referral");
    expect(home).toContain("Evaluations");
    expect(home).toContain("Upcoming Events");
    expect(home).not.toContain("Signed in as");
  });

  test("hidden /demo/home previews the admin chrome without auth", () => {
    const page = read("apps/club/app/demo/home/page.tsx");
    const demo = read("apps/club/app/demo/page.tsx");
    expect(page).toContain("AdminHomePreview");
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).not.toContain("auth-server");
    expect(page).not.toContain("hasClubSession");
    expect(demo).toContain("loadClub()");
    expect(demo).not.toContain("AdminHome");
  });
});
