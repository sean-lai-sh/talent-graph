import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc } from "../convex/_generated/dataModel";

/**
 * One deployment is one club: the oldest `clubOrgs` document. Documents
 * created after it (one per admin, from before SEA-55) are ignored, not
 * merged or deleted.
 */
export async function loadClub(
  db: GenericDatabaseReader<DataModel>,
): Promise<Doc<"clubOrgs"> | null> {
  return await db.query("clubOrgs").order("asc").first();
}
