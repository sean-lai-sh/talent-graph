import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel, Doc, Id } from "../convex/_generated/dataModel";
import {
  CLUB_TABLES,
  type ClubRecord,
  COLLECTIONS,
  type Collection,
  planWrites,
} from "./clubWrites.ts";
import { emptyState } from "./engine.ts";
import { reviveState } from "./serialize.ts";
import type { ClubState } from "./types.ts";

type Reader = GenericDatabaseReader<DataModel>;
type Writer = GenericDatabaseWriter<DataModel>;

export type Club = Doc<"clubs">;

/**
 * The only module that knows how a club is stored. Convex functions go
 * through these; nothing else reads the `club*` record tables whole.
 */

/** One club per deployment: the oldest `clubs` row, or null before the first admin creates it. */
export async function loadClub(db: Reader): Promise<Club | null> {
  return await db.query("clubs").order("asc").first();
}

/**
 * The club, creating it when there is none. `name` applies only on create;
 * the new club starts from `emptyState()` (its `now` and `config`).
 */
export async function ensureClub(
  db: Writer,
  createdByUserId: string,
  name?: string,
): Promise<Club> {
  const existing = await loadClub(db);
  if (existing) return existing;
  const { now, config } = emptyState();
  const id = await db.insert("clubs", {
    name: name?.trim() || "Club",
    now,
    config,
    createdByUserId,
  });
  const created = await db.get(id);
  if (!created) throw new Error("ensureClub: the club just inserted is missing");
  return created;
}

/**
 * Every record table has the same shape (`clubId`, the engine's domain `id`,
 * `by_club` and `by_club_and_domain_id`), but TypeScript cannot query a union
 * of table names. The helpers type every table as `clubPeople`; the
 * collection passed in decides what the rows really are.
 */
type RecordTable = "clubPeople";

function tableOf(collection: Collection): RecordTable {
  return CLUB_TABLES[collection] as RecordTable;
}

async function readRows<C extends Collection>(
  db: Reader,
  clubId: Id<"clubs">,
  collection: C,
): Promise<ClubRecord<C>[]> {
  const docs = await db
    .query(tableOf(collection))
    .withIndex("by_club", (q) => q.eq("clubId", clubId))
    .collect();
  return docs.map(({ _id, _creationTime, clubId: _club, ...row }) => row as ClubRecord<C>);
}

async function findRow(
  db: Writer,
  clubId: Id<"clubs">,
  collection: Collection,
  id: string,
): Promise<Id<RecordTable>> {
  const doc = await db
    .query(tableOf(collection))
    .withIndex("by_club_and_domain_id", (q) => q.eq("clubId", clubId).eq("id", id))
    .unique();
  if (!doc) throw new Error(`saveState: no ${CLUB_TABLES[collection]} row with id ${id}`);
  return doc._id;
}

/**
 * Rebuild the `ClubState` the engine takes. Each list comes back in the order
 * the engine built it: oldest row first, except `snapshots`, newest first
 * (the engine prepends them). Rows are stripped of `_id`, `_creationTime`,
 * and `clubId`, then passed through `reviveState`.
 */
export async function loadState(db: Reader, club: Club): Promise<ClubState> {
  const [
    people,
    referrals,
    comparisons,
    evaluations,
    outcomes,
    opportunities,
    snapshots,
    feedbackRequests,
  ] = await Promise.all([
    readRows(db, club._id, "people"),
    readRows(db, club._id, "referrals"),
    readRows(db, club._id, "comparisons"),
    readRows(db, club._id, "evaluations"),
    readRows(db, club._id, "outcomes"),
    readRows(db, club._id, "opportunities"),
    readRows(db, club._id, "snapshots"),
    readRows(db, club._id, "feedbackRequests"),
  ]);
  return reviveState({
    people,
    referrals,
    comparisons,
    evaluations,
    outcomes,
    opportunities,
    snapshots: snapshots.reverse(),
    feedbackRequests,
    config: club.config,
    now: club.now,
  });
}

/**
 * Persist `after` given the `before` it was derived from: apply
 * `planWrites(before, after)` (insert / replace / delete rows by domain id)
 * and patch the club row's `now` / `config` when they changed.
 */
export async function saveState(
  db: Writer,
  club: Club,
  before: ClubState,
  after: ClubState,
): Promise<void> {
  const plan = planWrites(before, after);
  const clubId = club._id;
  for (const collection of COLLECTIONS) {
    for (const write of plan.rows[collection]) {
      if (write.kind === "insert") {
        const row = write.row as ClubRecord<"people">;
        await db.insert(tableOf(collection), { clubId, ...row });
      } else if (write.kind === "replace") {
        const row = write.row as ClubRecord<"people">;
        await db.replace(await findRow(db, clubId, collection, write.id), { clubId, ...row });
      } else {
        await db.delete(await findRow(db, clubId, collection, write.id));
      }
    }
  }
  if (Object.keys(plan.club).length > 0) await db.patch(clubId, plan.club);
}
