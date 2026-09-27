import type { ClubState } from "./types.ts";

/**
 * Each `ClubState` list and the Convex table that stores its rows. The order
 * here is the order `saveState` applies writes in.
 */
export const CLUB_TABLES = {
  people: "clubPeople",
  referrals: "clubReferrals",
  comparisons: "clubComparisons",
  evaluations: "clubEvaluations",
  outcomes: "clubOutcomes",
  opportunities: "clubOpportunities",
  snapshots: "clubSnapshots",
  feedbackRequests: "clubFeedbackRequests",
} as const;

export type Collection = keyof typeof CLUB_TABLES;

export const COLLECTIONS = Object.keys(CLUB_TABLES) as Collection[];

export type ClubRecord<C extends Collection> = ClubState[C][number];

/** One row change, addressed by the engine's domain `id`. */
export type RowWrite<C extends Collection> =
  | { kind: "insert"; row: ClubRecord<C> }
  | { kind: "replace"; id: string; row: ClubRecord<C> }
  | { kind: "delete"; id: string };

/**
 * Everything a transition changed, per collection, plus the club row's own
 * fields when they moved. A transition that changed nothing plans nothing.
 */
export type ClubWritePlan = {
  rows: { [C in Collection]: RowWrite<C>[] };
  club: Partial<Pick<ClubState, "now" | "config">>;
};

/**
 * Diff two states by domain `id` within each collection. Position is ignored:
 * reordering a list is not a write. A row is replaced when any field differs
 * (deep equality). Throws when either state holds two rows with the same id
 * in one collection, since the store could not tell them apart.
 */
export function planWrites(before: ClubState, after: ClubState): ClubWritePlan {
  const rows = Object.fromEntries(
    COLLECTIONS.map((c) => [c, diffRows(c, before[c], after[c])]),
  ) as ClubWritePlan["rows"];
  const club: ClubWritePlan["club"] = {};
  if (before.now !== after.now) club.now = after.now;
  // Order-sensitive: the required dimensions are stored as a list.
  if (!deepEqual(before.config, after.config)) club.config = after.config;
  return { rows, club };
}

function diffRows<C extends Collection>(
  collection: C,
  before: readonly ClubRecord<C>[],
  after: readonly ClubRecord<C>[],
): RowWrite<C>[] {
  const beforeById = indexById(collection, before);
  const afterById = indexById(collection, after);
  const writes: RowWrite<C>[] = [];
  for (const row of after) {
    const prior = beforeById.get(row.id);
    if (prior === undefined) writes.push({ kind: "insert", row });
    else if (!deepEqual(prior, row)) writes.push({ kind: "replace", id: row.id, row });
  }
  for (const row of before) {
    if (!afterById.has(row.id)) writes.push({ kind: "delete", id: row.id });
  }
  return writes;
}

function indexById<C extends Collection>(
  collection: C,
  rows: readonly ClubRecord<C>[],
): Map<string, ClubRecord<C>> {
  const byId = new Map<string, ClubRecord<C>>();
  for (const row of rows) {
    if (byId.has(row.id)) throw new Error(`planWrites: duplicate id "${row.id}" in ${collection}`);
    byId.set(row.id, row);
  }
  return byId;
}

/** Structural equality over JSON-like values; an `undefined` field counts as absent. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const key of Object.keys(ra)) if (!deepEqual(ra[key], rb[key])) return false;
  for (const key of Object.keys(rb))
    if (ra[key] === undefined && rb[key] !== undefined) return false;
  return true;
}
