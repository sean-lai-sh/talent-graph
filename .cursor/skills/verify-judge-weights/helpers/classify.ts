/**
 * Each public query is member-facing or admin-only.
 * A query the checker cannot place fails the run under its own name.
 */

import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { ADMIN_ONLY_QUERIES } from "./admin-only-queries.ts";
import {
  type DiscoveredQuery,
  type DiscoverOptions,
  discoverQueries,
  exportInitializer,
  generatedApiExists,
  objectLiteralArg,
  propertyNameText,
} from "./discover.ts";
import { isWeightKey } from "./scan.ts";

const WEIGHT_CALLEES = new Set(["computeView", "judgeWeight"]);
const ADMIN_CALLEES = new Set(["loadOrgForSession", "requireAdmin", "adminRead"]);

export type Audience = "member" | "admin" | "internal" | "unclassified";

export type GatedQuery = DiscoveredQuery & { audience: Audience };

export type QueryGate = {
  rows: GatedQuery[];
  failures: string[];
};

export type GateOptions = DiscoverOptions & {
  allowlist?: readonly string[];
};

export function gateQueries(convexDir: string, options?: GateOptions): QueryGate {
  const allowlist = options?.allowlist ?? ADMIN_ONLY_QUERIES;
  const queries = discoverQueries(convexDir, options);
  const rows: GatedQuery[] = [];
  const failures: string[] = [];
  if (!generatedApiExists(convexDir)) {
    failures.push(
      `generated API missing at ${convexDir}/_generated/api.d.ts (run convex codegen; queries found on disk are still classified)`,
    );
  }
  const publicRefs = new Set(
    queries.filter((query) => query.visibility === "public").map((query) => query.ref),
  );
  for (const ref of allowlist) {
    if (!publicRefs.has(ref))
      failures.push(`admin-only allowlist entry ${ref} is not a public query`);
  }
  for (const query of queries) {
    const placed = placeQuery(query, new Set(allowlist));
    rows.push(placed.row);
    if (placed.failure) failures.push(placed.failure);
  }
  rows.sort((a, b) => a.ref.localeCompare(b.ref));
  return { rows, failures };
}

export function formatDiscovered(rows: readonly GatedQuery[]): string[] {
  const member = rows.filter((row) => row.audience === "member").length;
  const admin = rows.filter((row) => row.audience === "admin").length;
  const internal = rows.filter((row) => row.audience === "internal").length;
  const unclassified = rows.filter((row) => row.audience === "unclassified").length;
  const lines = [
    `queries discovered ${rows.length} (member ${member}, admin ${admin}, internal ${internal}, unclassified ${unclassified})`,
  ];
  for (const row of rows) lines.push(`  ${row.audience} ${row.ref}`);
  return lines;
}

function placeQuery(
  query: DiscoveredQuery,
  allowlist: ReadonlySet<string>,
): { row: GatedQuery; failure?: string } {
  if (query.visibility === "internal") {
    return { row: { ...query, audience: "internal" } };
  }
  if (query.visibility !== "public") {
    return fail(query, "visibility is not public or internal");
  }
  const source = readSource(query.file);
  const annotation = source ? annotationOf(source, query.name) : null;
  const signals = source
    ? handlerSignals(source, query.name)
    : { weight: false, admin: false, seen: false };
  const listed = allowlist.has(query.ref);
  if (annotation === "conflict") return fail(query, "annotation is both admin-only and member");
  if (listed || annotation === "admin") {
    if (annotation === "member") {
      return fail(query, "member annotation conflicts with the admin-only allowlist");
    }
    return { row: { ...query, audience: "admin" } };
  }
  if (annotation === "member") {
    if (signals.weight || signals.admin) {
      return fail(query, "member annotation on a query that returns weights or is admin-gated");
    }
    return { row: { ...query, audience: "member" } };
  }
  if (!signals.seen) return fail(query, "no handler");
  if (signals.weight && signals.admin) {
    return fail(query, "returns weights and is admin-gated");
  }
  if (signals.weight) return fail(query, "returns weights");
  if (signals.admin) return fail(query, "admin-gated");
  return { row: { ...query, audience: "member" } };
}

function fail(query: DiscoveredQuery, reason: string): { row: GatedQuery; failure: string } {
  return {
    row: { ...query, audience: "unclassified" },
    failure: `unclassifiable query ${query.ref} (${reason})`,
  };
}

function readSource(file: string): ts.SourceFile | undefined {
  if (file === "") return undefined;
  try {
    const text = readFileSync(file, "utf8");
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch {
    return undefined;
  }
}

type Note = "admin" | "member" | "conflict";

function annotationOf(source: ts.SourceFile, name: string): Note | null {
  const stmt = statementOf(source, name);
  if (!stmt) return null;
  const text = source.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, stmt.getFullStart()) ?? [];
  let admin = false;
  let member = false;
  for (const range of ranges) {
    const comment = text.slice(range.pos, range.end);
    if (comment.includes("verify-judge-weights: admin-only")) admin = true;
    if (comment.includes("verify-judge-weights: member")) member = true;
  }
  if (admin && member) return "conflict";
  if (admin) return "admin";
  if (member) return "member";
  return null;
}

function statementOf(source: ts.SourceFile, name: string): ts.Statement | undefined {
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) return stmt;
    }
  }
  return undefined;
}

function handlerSignals(
  source: ts.SourceFile,
  name: string,
): { weight: boolean; admin: boolean; seen: boolean } {
  const initializer = exportInitializer(source, name);
  const obj = objectLiteralArg(initializer);
  if (!obj) return { weight: false, admin: false, seen: false };
  let handler: ts.Expression | undefined;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propertyNameText(prop.name) !== "handler") continue;
    handler = prop.initializer;
  }
  if (!handler) return { weight: false, admin: false, seen: false };
  const body = resolveHandler(source, handler);
  if (!body) return { weight: false, admin: false, seen: false };
  return { ...signalsOf(body), seen: true };
}

function resolveHandler(source: ts.SourceFile, expr: ts.Expression): ts.Node | undefined {
  if (ts.isIdentifier(expr)) {
    const decl = exportInitializer(source, expr.text);
    if (!decl) {
      for (const stmt of source.statements) {
        if (!ts.isFunctionDeclaration(stmt) || stmt.name?.text !== expr.text) continue;
        return stmt.body;
      }
      return undefined;
    }
    return decl;
  }
  return expr;
}

function signalsOf(node: ts.Node): { weight: boolean; admin: boolean } {
  let weight = false;
  let admin = false;
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current)) {
      const callee = calleeName(current.expression);
      if (callee && WEIGHT_CALLEES.has(callee)) weight = true;
      if (callee && ADMIN_CALLEES.has(callee)) admin = true;
    }
    if (ts.isPropertyAccessExpression(current)) {
      const name = current.name.text;
      if (isWeightKey(name) || WEIGHT_CALLEES.has(name)) weight = true;
    }
    if (
      ts.isPropertyAssignment(current) ||
      ts.isShorthandPropertyAssignment(current) ||
      ts.isMethodDeclaration(current)
    ) {
      const name = propertyNameText(current.name);
      if (name && isWeightKey(name)) weight = true;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return { weight, admin };
}

function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}
