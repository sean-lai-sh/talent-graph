/**
 * Deterministic preprocessing for one source statement, before the Jev claim step.
 *
 * A statement becomes two or more atomic claims only when the clauses are a
 * role or output claim and a selection claim. Numbers are read off the wording
 * into `ClaimFacts`. Same input, same output. No model and no network.
 */

export type OwnershipTier = "led" | "built" | "contributed";

export type CountUnit = "users" | "students" | "events" | "usd" | "requests" | "requests_per_day";

/**
 * A selection ratio.
 *
 * `rate` is a fraction. `1 of 400` is `0.0025`. `top 5%` is `0.05` with
 * `selected` and `pool` null, because the wording has no counts.
 * `poolLowerBound` is true when the pool was written with a trailing `+`.
 * The stored pool is the number that was written.
 */
export interface SelectionRatio {
  selected: number | null;
  pool: number | null;
  rate: number;
  poolLowerBound: boolean;
}

/**
 * A before/after metric. Time quantities are seconds. Percents stay the
 * numbers that were written (`60` and `99.5`). `relative_change` is
 * `(after - before) / |before|`, or null when `before` is 0.
 */
export interface MetricChange {
  metric: string;
  before: number;
  after: number;
  relative_change: number | null;
}

/** A percent that is not already part of a selection or a before/after pair. */
export interface PercentFact {
  value: number;
  /** True for a change (`+10%`, `improving latency 10%`). False for a level (`12%`). */
  delta: boolean;
}

export interface CountFact {
  value: number;
  unit: CountUnit;
}

export interface ClaimFacts {
  selections: SelectionRatio[];
  changes: MetricChange[];
  percentages: PercentFact[];
  counts: CountFact[];
  teamSize: number | null;
  ownership: OwnershipTier | null;
}

export interface AtomicClaim {
  /** `parentId` when the statement is one claim, otherwise `parentId#0`, `#1`, … */
  id: string;
  parentId: string;
  /** Verbatim clause. The full statement when it was not split. */
  text: string;
  /** The full source statement, copied onto every child. */
  source: string;
  facts: ClaimFacts;
}

const NUM = String.raw`\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kK]?\+?`;
const NUMBER = String.raw`(?<![\w.])(${NUM})(?![\w])`;
const TIME_UNIT = "milliseconds?|seconds?|minutes?|hours?|days?|secs?|mins?|hrs?|ms|sec|min|hr|s";
const QTY = String.raw`(?<![\w.])(${NUM})\s*(%|${TIME_UNIT})(?![A-Za-z])`;

const ROLE =
  /\b(?:led|owned|founded|built|developed|designed|contributed|assisted|helped|shipped|launched|created|worked\s+under)\b/i;
const SELECTION =
  /\b(?:won|wins|winner|winning|awarded|award|prize|prizes|finalist|admitted|competition|champion|champions)\b/i;

const SECONDS: Readonly<Record<string, number>> = {
  ms: 0.001,
  msec: 0.001,
  millisecond: 0.001,
  milliseconds: 0.001,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  day: 86400,
  days: 86400,
};

const LEAD_IN = new Set([
  "raised",
  "raise",
  "raising",
  "cut",
  "cutting",
  "improved",
  "improve",
  "improving",
  "reduced",
  "reduce",
  "reducing",
  "increased",
  "increase",
  "increasing",
  "dropped",
  "drop",
  "dropping",
  "grew",
  "grow",
  "growing",
  "lowered",
  "lower",
  "lowering",
  "moved",
  "move",
  "moving",
  "went",
  "changed",
  "change",
  "changing",
  "took",
  "take",
  "taking",
  "boosted",
  "boost",
  "boosting",
  "shrunk",
  "shrink",
  "shrinking",
]);

const METRIC_SKIP = new Set(["the", "a", "an", "of", "by", "for", "to", "in", "on", "at", "from"]);

const DELTA_CUE =
  /\b(?:improving|improved|improvement|reducing|reduced|reduction|increasing|increased|increase|decreasing|decreased|decrease)\b/i;

interface ParsedNumber {
  value: number;
  lowerBound: boolean;
  currency: boolean;
}

interface Span {
  start: number;
  end: number;
}

interface Hit<T> {
  start: number;
  end: number;
  value: T;
}

type ClauseKind = "role" | "selection" | "both" | "other";

function parseNumber(raw: string): ParsedNumber | null {
  const currency = raw.startsWith("$");
  const lowerBound = raw.endsWith("+");
  let body = raw;
  if (currency) body = body.slice(1);
  if (lowerBound) body = body.slice(0, -1);
  let multiplier = 1;
  if (/[kK]$/.test(body)) {
    multiplier = 1000;
    body = body.slice(0, -1);
  }
  body = body.replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(body)) return null;
  const value = Number(body) * multiplier;
  if (!Number.isFinite(value)) return null;
  return { value, lowerBound, currency };
}

function overlaps(spans: readonly Span[], start: number, end: number): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function absorb<T>(hits: readonly Hit<T>[], consumed: Span[]): { values: T[]; consumed: Span[] } {
  const ordered = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  const next = [...consumed];
  const values: T[] = [];
  for (const hit of ordered) {
    if (overlaps(next, hit.start, hit.end)) continue;
    next.push({ start: hit.start, end: hit.end });
    values.push(hit.value);
  }
  return { values, consumed: next };
}

function ratio(selectedRaw: string, poolRaw: string): SelectionRatio | null {
  const selected = parseNumber(selectedRaw);
  const pool = parseNumber(poolRaw);
  if (selected === null || pool === null) return null;
  if (selected.currency || pool.currency) return null;
  if (!(selected.value > 0) || !(pool.value > 0)) return null;
  if (selected.value > pool.value) return null;
  return {
    selected: selected.value,
    pool: pool.value,
    rate: selected.value / pool.value,
    poolLowerBound: pool.lowerBound,
  };
}

function extractSelections(text: string): { values: SelectionRatio[]; consumed: Span[] } {
  const hits: Hit<SelectionRatio>[] = [];

  for (const match of text.matchAll(new RegExp(String.raw`\btop\s+(${NUM})\s*%`, "gi"))) {
    const raw = match[1];
    if (raw === undefined || match.index === undefined) continue;
    const parsed = parseNumber(raw);
    if (parsed === null || parsed.currency || !(parsed.value > 0)) continue;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: {
        selected: null,
        pool: null,
        rate: parsed.value / 100,
        poolLowerBound: false,
      },
    });
  }

  const paired: { pattern: RegExp; slash: boolean }[] = [
    {
      pattern: new RegExp(String.raw`${NUMBER}\s+out\s+of\s+(?:the\s+)?${NUMBER}`, "gi"),
      slash: false,
    },
    {
      pattern: new RegExp(String.raw`${NUMBER}\s+of\s+(?:the\s+)?${NUMBER}`, "gi"),
      slash: false,
    },
    {
      pattern: new RegExp(String.raw`(?<![\w:/])(${NUM})(?![\w.])\s*\/\s*(${NUM})(?![\w/])`, "gi"),
      slash: true,
    },
  ];

  for (const entry of paired) {
    for (const match of text.matchAll(entry.pattern)) {
      const left = match[1];
      const right = match[2];
      if (left === undefined || right === undefined || match.index === undefined) continue;
      const value = ratio(left, right);
      if (value === null || value.pool === null) continue;
      if (entry.slash && (value.pool < 10 || (value.pool >= 1900 && value.pool <= 2100))) continue;
      hits.push({ start: match.index, end: match.index + match[0].length, value });
    }
  }

  return absorb(hits, []);
}

function metricName(text: string, index: number, family: "percent" | "duration"): string {
  const before = text.slice(0, index);
  const words = before.match(/[A-Za-z][A-Za-z-]*/g) ?? [];
  const kept: string[] = [];
  for (let cursor = words.length - 1; cursor >= 0 && kept.length < 2; cursor--) {
    const word = words[cursor];
    if (word === undefined) continue;
    const lower = word.toLowerCase();
    if (LEAD_IN.has(lower)) break;
    if (METRIC_SKIP.has(lower)) continue;
    kept.unshift(lower);
  }
  if (kept.length > 0) return kept.join(" ");
  return family === "percent" ? "percent" : "duration";
}

function normalizeQuantity(
  raw: string,
  unit: string,
): { value: number; family: "percent" | "duration" } | null {
  const parsed = parseNumber(raw);
  if (parsed === null || parsed.currency) return null;
  if (unit === "%") return { value: parsed.value, family: "percent" };
  const seconds = SECONDS[unit.toLowerCase()];
  if (seconds === undefined) return null;
  return { value: parsed.value * seconds, family: "duration" };
}

function changeFrom(text: string, match: RegExpMatchArray): Hit<MetricChange> | null {
  if (match.index === undefined) return null;
  const beforeRaw = match[1];
  const beforeUnit = match[2];
  const afterRaw = match[3];
  const afterUnit = match[4];
  if (
    beforeRaw === undefined ||
    beforeUnit === undefined ||
    afterRaw === undefined ||
    afterUnit === undefined
  ) {
    return null;
  }
  const before = normalizeQuantity(beforeRaw, beforeUnit);
  const after = normalizeQuantity(afterRaw, afterUnit);
  if (before === null || after === null || before.family !== after.family) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    value: {
      metric: metricName(text, match.index, before.family),
      before: before.value,
      after: after.value,
      relative_change:
        before.value === 0 ? null : (after.value - before.value) / Math.abs(before.value),
    },
  };
}

function extractChanges(
  text: string,
  consumed: Span[],
): { values: MetricChange[]; consumed: Span[] } {
  const hits: Hit<MetricChange>[] = [];
  const patterns = [
    new RegExp(String.raw`\bfrom\s+${QTY}\s+to\s+${QTY}`, "gi"),
    new RegExp(String.raw`${QTY}\s+to\s+${QTY}`, "gi"),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const hit = changeFrom(text, match);
      if (hit !== null) hits.push(hit);
    }
  }
  return absorb(hits, consumed);
}

function extractTeamSize(
  text: string,
  consumed: Span[],
): { teamSize: number | null; consumed: Span[] } {
  const pattern = new RegExp(String.raw`\b(?:in\s+(?:a\s+)?)?team\s+of\s+${NUMBER}`, "gi");
  const hits: Hit<number>[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (raw === undefined || match.index === undefined) continue;
    const parsed = parseNumber(raw);
    if (parsed === null || parsed.currency || !(parsed.value > 0)) continue;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: parsed.value,
    });
  }
  const taken = absorb(hits, consumed);
  return { teamSize: taken.values[0] ?? null, consumed: taken.consumed };
}

function percentIsDelta(text: string, index: number, sign: string | undefined): boolean {
  if (sign === "+" || sign === "-") return true;
  const window = text.slice(Math.max(0, index - 48), index);
  if (/\bby\s*$/i.test(window)) return true;
  return DELTA_CUE.test(window);
}

function extractPercents(
  text: string,
  consumed: Span[],
): { values: PercentFact[]; consumed: Span[] } {
  const pattern = new RegExp(String.raw`(?<![\w.])([+-])?\s*${NUMBER}\s*%`, "gi");
  const hits: Hit<PercentFact>[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[2];
    if (raw === undefined || match.index === undefined) continue;
    const parsed = parseNumber(raw);
    if (parsed === null || parsed.currency) continue;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: { value: parsed.value, delta: percentIsDelta(text, match.index, match[1]) },
    });
  }
  return absorb(hits, consumed);
}

function extractCounts(text: string, consumed: Span[]): CountFact[] {
  const patterns: { unit: CountUnit; pattern: RegExp }[] = [
    {
      unit: "requests_per_day",
      pattern: new RegExp(String.raw`${NUMBER}\s+daily\s+requests?\b`, "gi"),
    },
    {
      unit: "requests_per_day",
      pattern: new RegExp(String.raw`${NUMBER}\s+requests?\s+(?:per|a)\s+day\b`, "gi"),
    },
    {
      unit: "requests_per_day",
      pattern: new RegExp(String.raw`${NUMBER}\s+requests?\/day\b`, "gi"),
    },
    { unit: "users", pattern: new RegExp(String.raw`${NUMBER}\s+users?\b`, "gi") },
    { unit: "students", pattern: new RegExp(String.raw`${NUMBER}\s+students?\b`, "gi") },
    { unit: "events", pattern: new RegExp(String.raw`${NUMBER}\s+events?\b`, "gi") },
    { unit: "requests", pattern: new RegExp(String.raw`${NUMBER}\s+requests?\b`, "gi") },
    {
      unit: "usd",
      pattern: /(?<![\w.])(\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kK]?\+?)(?![\w])/gi,
    },
    { unit: "usd", pattern: new RegExp(String.raw`${NUMBER}\s+dollars?\b`, "gi") },
  ];
  const hits: Hit<CountFact>[] = [];
  for (const entry of patterns) {
    for (const match of text.matchAll(entry.pattern)) {
      const raw = match[1];
      if (raw === undefined || match.index === undefined) continue;
      const parsed = parseNumber(raw);
      if (parsed === null || !(parsed.value >= 0)) continue;
      if (entry.unit !== "usd" && parsed.currency) continue;
      hits.push({
        start: match.index,
        end: match.index + match[0].length,
        value: { value: parsed.value, unit: entry.unit },
      });
    }
  }
  return absorb(hits, consumed).values;
}

function extractOwnership(text: string): OwnershipTier | null {
  const patterns: { tier: OwnershipTier; pattern: RegExp }[] = [
    { tier: "led", pattern: /\b(?:led|owned|founded)\b/gi },
    { tier: "built", pattern: /\b(?:built|developed|designed)\b/gi },
    { tier: "contributed", pattern: /\b(?:contributed|assisted|helped|worked\s+under)\b/gi },
  ];
  let best: { index: number; tier: OwnershipTier } | null = null;
  for (const entry of patterns) {
    for (const match of text.matchAll(entry.pattern)) {
      if (match.index === undefined) continue;
      if (best === null || match.index < best.index)
        best = { index: match.index, tier: entry.tier };
    }
  }
  return best?.tier ?? null;
}

function extractFacts(text: string): ClaimFacts {
  const selections = extractSelections(text);
  const changes = extractChanges(text, selections.consumed);
  const team = extractTeamSize(text, changes.consumed);
  const percents = extractPercents(text, team.consumed);
  return {
    selections: selections.values,
    changes: changes.values,
    percentages: percents.values,
    counts: extractCounts(text, percents.consumed),
    teamSize: team.teamSize,
    ownership: extractOwnership(text),
  };
}

function clauseClass(clause: string): ClauseKind {
  const role = ROLE.test(clause);
  const selection = SELECTION.test(clause) || extractFacts(clause).selections.length > 0;
  if (role && selection) return "both";
  if (role) return "role";
  if (selection) return "selection";
  return "other";
}

function canSplit(parts: readonly string[]): boolean {
  if (parts.length < 2) return false;
  const classes = parts.map(clauseClass);
  if (classes.some((kind) => kind === "other" || kind === "both")) return false;
  return classes.includes("role") && classes.includes("selection");
}

function sentenceParts(statement: string): string[] | null {
  const parts = statement
    .split(/\s*;\s*|(?<=[A-Za-z]{3,}[.!?])\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length >= 2 ? parts : null;
}

function conjunctionParts(statement: string): string[] | null {
  const pattern = /\s+and\s+|\s+to\s+(?=win\b|place\b|earn\b)/gi;
  const matches = [...statement.matchAll(pattern)];
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    if (match?.index === undefined) continue;
    const left = statement.slice(0, match.index).trim();
    const right = statement.slice(match.index + match[0].length).trim();
    if (left.length === 0 || right.length === 0) continue;
    if (canSplit([left, right])) return [left, right];
  }
  return null;
}

function splitStatement(statement: string): string[] {
  const sentences = sentenceParts(statement);
  if (sentences && canSplit(sentences)) return sentences;
  const cut = conjunctionParts(statement);
  if (cut) return cut;
  return [statement];
}

export function preprocessClaims(statement: string, parentId: string): AtomicClaim[] {
  const parts = splitStatement(statement);
  const split = parts.length > 1;
  return parts.map((part, index) => {
    const text = split ? part : statement;
    return {
      id: split ? `${parentId}#${index}` : parentId,
      parentId,
      text,
      source: statement,
      facts: extractFacts(text),
    };
  });
}
