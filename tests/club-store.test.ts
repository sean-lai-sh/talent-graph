import { describe, expect, test } from "bun:test";
import type { Club } from "../apps/club/lib/clubStore.ts";
import { ensureClub, loadClub, loadState, saveState } from "../apps/club/lib/clubStore.ts";
import { decide, emptyState, initialState } from "../apps/club/lib/engine.ts";
import { reviveState } from "../apps/club/lib/serialize.ts";
import type { ClubState } from "../apps/club/lib/types.ts";

type Db = Parameters<typeof saveState>[0];
type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Write = { op: "insert" | "replace" | "delete" | "patch"; table: string };

/**
 * The Convex db subset the store uses, in memory: `withIndex` eq chains,
 * `order`, `first` / `collect` / `unique`, and the four writes. Rows come back
 * in `_creationTime` order, which is also index order once every indexed
 * field is pinned by `eq`.
 */
function fakeDb() {
  const tables = new Map<string, Row[]>();
  const writes: Write[] = [];
  let clock = 0;
  const rowsOf = (table: string) => {
    let rows = tables.get(table);
    if (!rows) {
      rows = [];
      tables.set(table, rows);
    }
    return rows;
  };
  const locate = (id: string) => {
    const table = id.split(":")[0] ?? "";
    const rows = rowsOf(table);
    const index = rows.findIndex((r) => r._id === id);
    if (index < 0) throw new Error(`no document ${id}`);
    return { table, rows, index };
  };

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    let dir: "asc" | "desc" = "asc";
    const results = () => {
      const rows = rowsOf(table).filter((r) => filters.every(([f, v]) => r[f] === v));
      rows.sort((a, b) => a._creationTime - b._creationTime);
      return dir === "asc" ? rows : rows.reverse();
    };
    const builder = {
      withIndex(_name: string, range: (q: unknown) => unknown) {
        const q = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return q;
          },
        };
        range(q);
        return builder;
      },
      order(d: "asc" | "desc") {
        dir = d;
        return builder;
      },
      first: async () => structuredClone(results()[0] ?? null),
      collect: async () => structuredClone(results()),
      unique: async () => {
        const rows = results();
        if (rows.length > 1) throw new Error(`unique: ${rows.length} rows in ${table}`);
        return structuredClone(rows[0] ?? null);
      },
    };
    return builder;
  };

  const db = {
    query,
    get: async (id: string) => {
      const { rows, index } = locate(id);
      return structuredClone(rows[index]);
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      writes.push({ op: "insert", table });
      clock += 1;
      const _id = `${table}:${clock}`;
      rowsOf(table).push({ ...structuredClone(value), _id, _creationTime: clock });
      return _id;
    },
    replace: async (id: string, value: Record<string, unknown>) => {
      const { table, rows, index } = locate(id);
      writes.push({ op: "replace", table });
      const old = rows[index] as Row;
      rows[index] = { ...structuredClone(value), _id: old._id, _creationTime: old._creationTime };
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const { table, rows, index } = locate(id);
      writes.push({ op: "patch", table });
      rows[index] = { ...(rows[index] as Row), ...structuredClone(value) };
    },
    delete: async (id: string) => {
      const { table, rows, index } = locate(id);
      writes.push({ op: "delete", table });
      rows.splice(index, 1);
    },
  };
  return { db: db as unknown as Db, writes, raw: db };
}

/** The empty state a freshly created club stands for. */
function stateOf(club: Club): ClubState {
  return { ...emptyState(club.now), config: club.config };
}

async function reload(db: Db, club: Club): Promise<Club> {
  const fresh = await db.get(club._id);
  if (!fresh) throw new Error("club vanished");
  return fresh;
}

describe("one club per deployment", () => {
  test("the club is the oldest clubs row, whoever created the others", async () => {
    const { db, raw } = fakeDb();
    await raw.insert("clubs", { name: "Tech@NYU", createdByUserId: "user-ada" });
    await raw.insert("clubs", { name: "Bea's board", createdByUserId: "user-bea" });
    await raw.insert("clubs", { name: "Cy's board", createdByUserId: "user-cy" });
    expect((await loadClub(db))?.name).toBe("Tech@NYU");
  });

  test("no club until an admin creates one", async () => {
    expect(await loadClub(fakeDb().db)).toBeNull();
  });

  test("ensureClub creates the club once and returns it after", async () => {
    const { db, writes } = fakeDb();
    const first = await ensureClub(db, "user-ada", "  Tech@NYU  ");
    const second = await ensureClub(db, "user-bea", "Bea's board");
    expect(first.name).toBe("Tech@NYU");
    expect(first.createdByUserId).toBe("user-ada");
    expect(first.config).toEqual(emptyState().config);
    expect(second).toEqual(first);
    expect(writes.filter((w) => w.table === "clubs")).toHaveLength(1);
  });

  test("a blank name falls back to Club", async () => {
    const { db } = fakeDb();
    expect((await ensureClub(db, "user-ada", "   ")).name).toBe("Club");
  });
});

describe("club state round trip", () => {
  test("save then load returns the same state, snapshots newest first", async () => {
    const { db } = fakeDb();
    let club = await ensureClub(db, "user-ada");
    const seed = initialState();
    await saveState(db, club, stateOf(club), seed);
    club = await reload(db, club);
    expect(await loadState(db, club)).toEqual(reviveState(seed));

    let state = await loadState(db, club);
    for (const personId of ["p-bram", "p-cleo"]) {
      const next = decide(state, personId, "admit");
      expect(next.error).toBeUndefined();
      await saveState(db, club, state, next.state);
      club = await reload(db, club);
      state = next.state;
    }
    const loaded = await loadState(db, club);
    expect(loaded.snapshots).toHaveLength(2);
    expect(loaded.snapshots.map((s) => s.personId)).toEqual(["p-cleo", "p-bram"]);
    expect(loaded).toEqual(reviveState(state));
  });

  test("several snapshots saved in one call load newest first", async () => {
    let decided = initialState();
    for (const personId of ["p-bram", "p-cleo"]) {
      const next = decide(decided, personId, "admit");
      expect(next.error).toBeUndefined();
      decided = next.state;
    }
    const { db } = fakeDb();
    let club = await ensureClub(db, "user-ada");
    await saveState(db, club, stateOf(club), decided);
    club = await reload(db, club);
    const loaded = await loadState(db, club);
    expect(loaded.snapshots.map((s) => s.personId)).toEqual(["p-cleo", "p-bram"]);
    expect(loaded).toEqual(reviveState(decided));
  });

  test("a decision writes one replaced person and one inserted snapshot", async () => {
    const { db, writes } = fakeDb();
    let club = await ensureClub(db, "user-ada");
    await saveState(db, club, stateOf(club), initialState());
    club = await reload(db, club);
    const before = await loadState(db, club);
    const after = decide(before, "p-bram", "admit");
    expect(after.error).toBeUndefined();

    writes.length = 0;
    await saveState(db, club, before, after.state);
    expect(writes).toEqual([
      { op: "replace", table: "clubPeople" },
      { op: "insert", table: "clubSnapshots" },
    ]);
  });

  test("rows of another club are never loaded", async () => {
    const { db, raw } = fakeDb();
    let club = await ensureClub(db, "user-ada");
    await saveState(db, club, stateOf(club), initialState());
    club = await reload(db, club);
    const [someone] = initialState().people;
    await raw.insert("clubPeople", { ...someone, id: "p-stranger", clubId: "clubs:999" });
    const loaded = await loadState(db, club);
    expect(loaded.people.map((p) => p.id)).not.toContain("p-stranger");
    expect(loaded.people).toHaveLength(initialState().people.length);
  });

  test("replacing a row that is not stored is an error naming the table and id", async () => {
    const { db } = fakeDb();
    const club = await ensureClub(db, "user-ada");
    const before = { ...stateOf(club), people: initialState().people.slice(0, 1) };
    const after = { ...before, people: [{ ...before.people[0]!, name: "Renamed" }] };
    await expect(saveState(db, club, before, after)).rejects.toThrow(/clubPeople.*p-alice/);
  });
});
