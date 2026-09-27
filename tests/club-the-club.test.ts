import { describe, expect, test } from "bun:test";
import type { Doc } from "../apps/club/convex/_generated/dataModel";
import { loadClub } from "../apps/club/lib/theClub.ts";

type ClubDb = Parameters<typeof loadClub>[0];
type Org = Pick<Doc<"clubOrgs">, "_creationTime" | "name" | "ownerUserId">;

/** Only the `clubOrgs` table, ordered by `_creationTime` like Convex's default index. */
function fakeDb(orgs: Org[]): ClubDb {
  const byCreation = (dir: "asc" | "desc") =>
    [...orgs].sort((a, b) =>
      dir === "asc" ? a._creationTime - b._creationTime : b._creationTime - a._creationTime,
    );
  const query = (table: string) => {
    if (table !== "clubOrgs") throw new Error(`unexpected table ${table}`);
    return {
      first: async () => byCreation("asc")[0] ?? null,
      order: (dir: "asc" | "desc") => ({ first: async () => byCreation(dir)[0] ?? null }),
    };
  };
  return { query } as unknown as ClubDb;
}

describe("every admin shares one club", () => {
  test("the club is the oldest clubOrgs document, whoever created the others", async () => {
    const db = fakeDb([
      { _creationTime: 300, name: "Bea's board", ownerUserId: "user-bea" },
      { _creationTime: 100, name: "Tech@NYU", ownerUserId: "user-ada" },
      { _creationTime: 200, name: "Cy's board", ownerUserId: "user-cy" },
    ]);
    expect((await loadClub(db))?.name).toBe("Tech@NYU");
  });

  test("a document without a creator still loads as the club", async () => {
    const db = fakeDb([
      { _creationTime: 50, name: "Club" },
      { _creationTime: 60, name: "Later", ownerUserId: "user-ada" },
    ]);
    expect((await loadClub(db))?.name).toBe("Club");
  });

  test("no club until an admin creates one", async () => {
    expect(await loadClub(fakeDb([]))).toBeNull();
  });
});
