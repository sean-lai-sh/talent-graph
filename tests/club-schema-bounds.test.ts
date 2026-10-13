import { describe, expect, test } from "bun:test";
import schema from "../apps/club/convex/schema.ts";

type Node = { kind: string; fields?: Record<string, Node>; element?: Node; members?: Node[] };

/** Every path in a table's validator that holds a list. */
function arrayPaths(node: Node, path: string): string[] {
  if (node.kind === "array" && node.element) {
    return [path, ...arrayPaths(node.element, `${path}[]`)];
  }
  if (node.kind === "object" && node.fields) {
    return Object.entries(node.fields).flatMap(([key, child]) =>
      arrayPaths(child, `${path}.${key}`),
    );
  }
  if (node.kind === "union" && node.members) {
    return node.members.flatMap((member) => arrayPaths(member, path));
  }
  return [];
}

/**
 * A list inside a document grows that document, and Convex caps a document at
 * 1 MiB. Records that grow with the club (applicants, evaluations, Jev
 * judgments) get a table of their own, one row each. Only lists with a small
 * fixed ceiling may live inside a document.
 */
const BOUNDED_LISTS: Record<string, string> = {
  "clubs.config.requiredDimensions": "one entry per dimension, at most 7",
  "clubSnapshots.modelRunIds": "one run id per model in a pass",
  "clubSnapshots.signalWithout": "one entry per referrer of the decided candidate, a handful",
  "clubSnapshots.unresolvedDecider.adminReferrers":
    "a subset of the decided candidate's referrers, a handful",
};

describe("club schema holds no growing lists", () => {
  test("every list field in every table is a known bounded one", () => {
    const tables = (schema as unknown as { tables: Record<string, { validator: Node }> }).tables;
    const found = Object.entries(tables).flatMap(([name, table]) =>
      arrayPaths(table.validator, name),
    );
    expect(found.sort()).toEqual(Object.keys(BOUNDED_LISTS).sort());
  });
});
