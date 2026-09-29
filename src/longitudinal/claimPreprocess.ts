import {
  COMPANY_SEED,
  type CompanySeed,
  mentionedInvestors,
  type SeedInvestor,
} from "./companySeed.ts";

export type OwnershipTier = "led" | "built" | "contributed";

export type CountUnit = "users" | "students" | "events" | "usd" | "requests" | "requests_per_day";

export interface CountRatio {
  kind: "ratio";
  selected: number;
  pool: number;
  rate: number;
  poolLowerBound: boolean;
}

export type SelectionRatio = CountRatio | { kind: "top_percent"; rate: number };

export interface MetricChange {
  metric: string;
  unit: "percent" | "duration";
  before: number;
  after: number;
  relative_change: number | null;
}

export type PercentFact = { kind: "level"; value: number } | { kind: "delta"; value: number };

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
  id: string;
  parentId: string;
  text: string;
  statement: string;
  facts: ClaimFacts;
}

export interface DatedClaim extends AtomicClaim {
  claimClass: "selection" | "output";
  /**
   * `YYYY-MM-DD`. A stated month or year is the first day of that period.
   * Null when that date is not stated.
   */
  startedAt: string | null;
  endedAt: string | null;
  observedAt: string | null;
  publishedAt: string | null;
  title: string;
  org: string;
  founder: boolean;
  noWorkDescribed?: true;
}

export type SplitClaim = AtomicClaim | DatedClaim;

export interface JobDateFields {
  startedAt: string | null;
  endedAt: string | null;
  publishedAt: string | null;
}

export interface JobClaimLine {
  id: string;
  statement: string;
  publishedAt?: string | null;
}

export interface JobSplitOptions {
  version: "1.2.0";
  seed?: CompanySeed;
}

const DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const SCALE_WORD = String.raw`\s?(?:thousand|million|billion)\b`;
// A bare letter scale sticks to the digits ("3M") so "5 ms" stays a duration; a
// currency amount may space it ("$1.2 M").
const USD = String.raw`\$${DIGITS}(?:\s?[kKmMbB]\b|${SCALE_WORD})?`;
const NUM = String.raw`(?:${USD}|${DIGITS}(?:[kKmMbB]\b|${SCALE_WORD})?)\+?`;
const NUMBER = String.raw`(?<![\w.])(${NUM})(?![\w])`;
const BETWEEN = String.raw`(?:\s+[A-Za-z][A-Za-z'-]*){0,2}`;
const TIME_UNIT = "milliseconds?|seconds?|minutes?|hours?|days?|secs?|mins?|hrs?|ms|sec|min|hr|s";
const QTY = String.raw`(?<![\w.])([+-])?\s*(${NUM})\s*(%|${TIME_UNIT})(?![A-Za-z])`;

const OUTPUT_VERB =
  /\b(?:led|owned|founded|built|developed|designed|contributed|assisted|helped|shipped|launched|created|worked\s+under)\b/i;

const CLAUSE_VERB = /\b(?:kept|cut|made|ran|wrote|did|spoke|[A-Za-z]+(?:ed|ing))\b/i;

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  billion: 1e9,
};

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

const POOL_NOUN =
  /^(?:\s+\S+){0,4}\s+(?:applicants?|applications?|entr(?:y|ies)|candidates?|teams?|participants?|submissions?|finalists?|nominees?|contestants?|fellows?|people)\b/i;

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
  const scale = /\s?(k|m|b|thousand|million|billion)$/i.exec(body);
  if (scale?.[1] !== undefined) {
    const found = SCALE[scale[1].toLowerCase()];
    if (found === undefined) return null;
    multiplier = found;
    body = body.slice(0, scale.index);
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

function ratio(selectedRaw: string, poolRaw: string): CountRatio | null {
  const selected = parseNumber(selectedRaw);
  const pool = parseNumber(poolRaw);
  if (selected === null || pool === null) return null;
  if (selected.currency || pool.currency) return null;
  if (!(selected.value > 0) || !(pool.value > 0)) return null;
  if (selected.value > pool.value) return null;
  return {
    kind: "ratio",
    selected: selected.value,
    pool: pool.value,
    rate: selected.value / pool.value,
    poolLowerBound: pool.lowerBound,
  };
}

function hasSelectionWording(text: string): boolean {
  return (
    /\b(?:was|were|been|got)\s+selected\b/i.test(text) ||
    /\bselected\s+(?:for|as|into|among|from)\b/i.test(text) ||
    /\b(?:was|were|been|got)\s+chosen\b/i.test(text) ||
    /\bchosen\s+(?:for|as|among|from)\b/i.test(text) ||
    /\bplaced\s+(?:first|second|third|fourth|\d+(?:st|nd|rd|th))\b/i.test(text) ||
    /\b(?:first|second|third|\d+(?:st|nd|rd|th))\s+place\b/i.test(text) ||
    /\bearn(?:ed)?\s+(?:the\s+|an?\s+)?(?:award|fellowship|prize|scholarship|grant|medal)\b/i.test(
      text,
    ) ||
    /\b(?:was|were|been)\s+admitted\b/i.test(text) ||
    /\badmitted\s+(?:to|into)\b/i.test(text) ||
    /\b(?:was|were|been)\s+awarded\b/i.test(text) ||
    /\bawarded\s+(?:the|a|an)\b/i.test(text) ||
    /\b(?:win(?!-)|won|wins)\b/i.test(text)
  );
}

function hasAwardCue(text: string): boolean {
  return (
    /\bwinners?\b/i.test(text) ||
    /\bfinalists?\b/i.test(text) ||
    /\bcompetitions?\b/i.test(text) ||
    /\bawards?\b(?!-)/i.test(text) ||
    /\bplaced\b(?!\s+(?:the|a|an)\b)/i.test(text)
  );
}

function hasSelectionContext(text: string, end: number): boolean {
  return POOL_NOUN.test(text.slice(end)) || hasSelectionWording(text) || hasAwardCue(text);
}

function isYearToken(raw: string): boolean {
  const body = raw.replaceAll(",", "");
  if (!/^\d{4}$/.test(body)) return false;
  const year = Number(body);
  return year >= 1900 && year <= 2100;
}

function extractSelections(text: string): { values: SelectionRatio[]; consumed: Span[] } {
  const hits: Hit<SelectionRatio>[] = [];
  const blocked: Span[] = [];

  for (const match of text.matchAll(new RegExp(String.raw`\btop\s+(${NUM})\s*%`, "gi"))) {
    const raw = match[1];
    if (raw === undefined || match.index === undefined) continue;
    const parsed = parseNumber(raw);
    if (parsed === null || parsed.currency || !(parsed.value > 0)) continue;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: { kind: "top_percent", rate: parsed.value / 100 },
    });
  }

  const paired: { pattern: RegExp; slash: boolean }[] = [
    {
      pattern: new RegExp(String.raw`${NUMBER}${BETWEEN}\s+out\s+of\s+(?:the\s+)?${NUMBER}`, "gi"),
      slash: false,
    },
    {
      pattern: new RegExp(String.raw`${NUMBER}${BETWEEN}\s+of\s+(?:the\s+)?${NUMBER}`, "gi"),
      slash: false,
    },
    {
      pattern: new RegExp(
        String.raw`(?<![\w:/.)])(${NUM})(?![\w.])\s*\/\s*(${NUM})(?![\w/])`,
        "gi",
      ),
      slash: true,
    },
  ];

  for (const entry of paired) {
    for (const match of text.matchAll(entry.pattern)) {
      const left = match[1];
      const right = match[2];
      if (left === undefined || right === undefined || match.index === undefined) continue;
      const value = ratio(left, right);
      const span = { start: match.index, end: match.index + match[0].length };
      if (value === null) {
        if (entry.slash) blocked.push(span);
        continue;
      }
      if (entry.slash && (value.pool < 10 || value.rate > 0.5 || isYearToken(right))) {
        blocked.push(span);
        continue;
      }
      if (!hasSelectionContext(text, span.end)) {
        blocked.push(span);
        continue;
      }
      hits.push({ ...span, value });
    }
  }

  return absorb(hits, blocked);
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

function signedQuantity(
  sign: string | undefined,
  raw: string,
  unit: string,
): { value: number; family: "percent" | "duration" } | null {
  const parsed = normalizeQuantity(raw, unit);
  if (parsed === null) return null;
  if (sign === "-" && parsed.family !== "percent") return null;
  return { value: sign === "-" ? -parsed.value : parsed.value, family: parsed.family };
}

function changeFrom(text: string, match: RegExpMatchArray): Hit<MetricChange> | null {
  if (match.index === undefined) return null;
  const before = signedQuantity(match[1], match[2] ?? "", match[3] ?? "");
  const after = signedQuantity(match[4], match[5] ?? "", match[6] ?? "");
  if (before === null || after === null || before.family !== after.family) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    value: {
      metric: metricName(text, match.index, before.family),
      unit: before.family,
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
  return /\bby\s*$/i.test(text.slice(0, index));
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
    const sign = match[1];
    const magnitude = sign === "-" ? -parsed.value : parsed.value;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: {
        kind: percentIsDelta(text, match.index, sign) ? "delta" : "level",
        value: magnitude,
      },
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
      pattern: new RegExp(String.raw`(?<![\w.])(${USD}\+?)(?![\w])`, "gi"),
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

// shipped, launched, and created split a role clause and leave ownership null.
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

export function extractFacts(text: string): ClaimFacts {
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

// A ratio in selection context counts even when the clause uses none of these verbs.
function isSelectionClause(clause: string): boolean {
  if (extractFacts(clause).selections.length > 0) return true;
  return hasSelectionWording(clause);
}

function hasClauseVerb(clause: string): boolean {
  return OUTPUT_VERB.test(clause) || hasSelectionWording(clause) || CLAUSE_VERB.test(clause);
}

function isRoleAtColon(statement: string): boolean {
  return /^.+?\sat\s+[^:]+:\s+\S/.test(statement);
}

function carriesSelectionFact(text: string): boolean {
  return extractFacts(text).selections.length > 0 || hasAwardCue(text);
}

function roleColonHalves(statement: string): readonly [string, string] | null {
  const match = /^(.+?\sat\s+[^:]+):\s+(\S[\s\S]*)$/.exec(statement);
  const title = match?.[1]?.trim() ?? "";
  const body = match?.[2]?.trim() ?? "";
  if (title.length === 0 || body.length === 0 || !hasClauseVerb(body)) return null;
  if (carriesSelectionFact(body) && !carriesSelectionFact(title)) return null;
  return [title, body];
}

function clauseClass(clause: string): ClauseKind {
  const role = OUTPUT_VERB.test(clause);
  const selection = isSelectionClause(clause);
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

const TITLE_ABBREV = new Set(["dr", "mr", "mrs", "ms", "prof", "jr", "sr", "st", "vs", "etc"]);

function sentenceParts(statement: string): string[] | null {
  const cuts: Span[] = [];
  for (const match of statement.matchAll(/\s*;\s*/g)) {
    if (match.index === undefined) continue;
    cuts.push({ start: match.index, end: match.index + match[0].length });
  }
  for (const match of statement.matchAll(/([A-Za-z]+|\d+)\.(\s+)(?=[A-Z])/g)) {
    const word = match[1];
    const spaces = match[2];
    if (word === undefined || spaces === undefined || match.index === undefined) continue;
    if (/[A-Za-z]/.test(word) && (word.length <= 2 || TITLE_ABBREV.has(word.toLowerCase()))) {
      continue;
    }
    const spaceStart = match.index + word.length + 1;
    cuts.push({ start: spaceStart, end: spaceStart + spaces.length });
  }
  if (cuts.length === 0) return null;
  cuts.sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: string[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start < cursor) continue;
    const left = statement.slice(cursor, cut.start).trim();
    if (left.length > 0) parts.push(left);
    cursor = cut.end;
  }
  const tail = statement.slice(cursor).trim();
  if (tail.length > 0) parts.push(tail);
  return parts.length >= 2 ? parts : null;
}

function locateParts(
  statement: string,
  parts: readonly string[],
): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (const part of parts) {
    const start = statement.indexOf(part, from);
    if (start < 0) return null;
    spans.push({ start, end: start + part.length });
    from = start + part.length;
  }
  return spans;
}

function glueOthers(statement: string, parts: readonly string[]): string[] | null {
  const spans = locateParts(statement, parts);
  if (spans === null) return null;
  const kinds = parts.map(clauseClass);
  if (kinds.some((kind) => kind === "both")) return null;
  if (!kinds.includes("role") || !kinds.includes("selection")) return null;

  type Group = { start: number; end: number; kind: ClauseKind };
  const groups: Group[] = [];
  let leading: { start: number; end: number } | null = null;
  for (let index = 0; index < parts.length; index++) {
    const span = spans[index];
    const kind = kinds[index];
    if (span === undefined || kind === undefined) continue;
    if (kind === "other") {
      if (groups.length === 0)
        leading = leading === null ? span : { start: leading.start, end: span.end };
      else {
        const prev = groups[groups.length - 1];
        if (prev) prev.end = span.end;
      }
      continue;
    }
    groups.push({ start: leading === null ? span.start : leading.start, end: span.end, kind });
    leading = null;
  }

  const merged: Group[] = [];
  for (const group of groups) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === group.kind && (group.kind === "role" || group.kind === "selection")) {
      prev.end = group.end;
      continue;
    }
    merged.push({ ...group });
  }
  if (merged.length < 2) return null;
  const texts = merged.map((group) => statement.slice(group.start, group.end).trim());
  if (!canSplit(texts)) return null;
  return texts;
}

function conjunctionParts(statement: string): string[] | null {
  const pattern = /\s+and\s+|\s+to\s+(?=win\b|place\b|earn\b)/gi;
  const roleColon = isRoleAtColon(statement);
  const matches = [...statement.matchAll(pattern)];
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    if (match?.index === undefined) continue;
    const boundary = match[0];
    if (roleColon && /^\s+to\s+/i.test(boundary)) continue;
    const left = statement.slice(0, match.index).trim();
    const right = statement.slice(match.index + boundary.length).trim();
    if (left.length === 0 || right.length === 0) continue;
    if (roleColon && /\sto\s+(?:win|place|earn)\b/i.test(right)) continue;
    if (canSplit([left, right])) return [left, right];
  }
  return null;
}

export function selectionOutputHalves(statement: string): readonly [string, string] | null {
  const colon = roleColonHalves(statement);
  if (colon) return colon;
  const pattern = /\s+and\s+|\s+to\s+(?=win\b|place\b|earn\b)|\s+(?:for|by|after)\s+/gi;
  const matches = [...statement.matchAll(pattern)];
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    if (match?.index === undefined) continue;
    const left = statement.slice(0, match.index).trim();
    const right = statement.slice(match.index + match[0].length).trim();
    if (left.length === 0 || right.length === 0) continue;
    if (splitStatement(left).length > 1 || splitStatement(right).length > 1) continue;
    const leftSelection = clauseClass(left) === "selection" || clauseClass(left) === "both";
    const rightSelection = clauseClass(right) === "selection" || clauseClass(right) === "both";
    if (leftSelection === rightSelection) continue;
    const selection = leftSelection ? left : right;
    const output = leftSelection ? right : left;
    if (!hasClauseVerb(output)) continue;
    return [selection, output];
  }
  return null;
}

function splitStatement(statement: string): string[] {
  const sentences = sentenceParts(statement);
  if (sentences) {
    const glued = glueOthers(statement, sentences);
    if (glued) return glued;
  }
  const cut = conjunctionParts(statement);
  if (cut) return cut;
  return [statement];
}

export function preprocessClaims(statement: string, parentId: string): AtomicClaim[];
export function preprocessClaims(
  statement: string,
  parentId: string,
  options: JobSplitOptions & { publishedAt?: string | null },
  modelClaimClass?: unknown,
): SplitClaim[];
export function preprocessClaims(
  statement: string,
  parentId: string,
  options?: JobSplitOptions & { publishedAt?: string | null },
  modelClaimClass?: unknown,
): SplitClaim[] {
  if (options?.version === "1.2.0") {
    return preprocessJobClaims(
      [{ id: parentId, statement, publishedAt: options.publishedAt ?? null }],
      options,
      modelClaimClass,
    );
  }
  const parts = splitStatement(statement);
  const split = parts.length > 1;
  return parts.map((part, index) => {
    const text = split ? part : statement;
    return {
      id: split ? `${parentId}#${index}` : parentId,
      parentId,
      text,
      statement,
      facts: extractFacts(text),
    };
  });
}

export function preprocessJobClaims(
  lines: readonly JobClaimLine[],
  options: JobSplitOptions,
  modelClaimClass?: unknown,
): SplitClaim[] {
  const version: string = options.version;
  if (version !== "1.2.0") {
    throw new Error('preprocessJobClaims requires version "1.2.0"');
  }
  void modelClaimClass;
  return emitJobs(groupJobs(lines), options.seed ?? COMPANY_SEED);
}

export function observedAtForJobClaim(
  claimClass: "selection" | "output",
  dates: JobDateFields,
): string | null {
  if (claimClass === "selection") return dates.startedAt;
  return dates.endedAt ?? isoDateOnly(dates.publishedAt);
}

export function countsTowardSubstance(claim: SplitClaim): boolean {
  return !("noWorkDescribed" in claim && claim.noWorkDescribed === true);
}

const MONTHS: Readonly<Record<string, string>> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

interface PhysicalLine {
  id: string;
  text: string;
  publishedAt: string | null;
  statement: string;
  sole: boolean;
}

interface JobBullet {
  id: string;
  text: string;
  publishedAt: string | null;
  statement: string;
}

interface OpenJob {
  key: string;
  anchorId: string;
  title: string;
  org: string;
  dateText: string | null;
  startedAt: string | null;
  endedAt: string | null;
  founder: boolean;
  publishedAt: string | null;
  bullets: JobBullet[];
}

type JobEvent = { kind: "free"; line: PhysicalLine } | { kind: "job"; job: OpenJob };

interface ParsedHeader {
  title: string;
  org: string;
  dateText: string | null;
  startedAt: string | null;
  endedAt: string | null;
  body: string | null;
}

function isoDateOnly(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

function parseDatePoint(raw: string): string | null {
  const text = raw.trim().replace(/\.+$/, "");
  if (!text || /^(?:present|current)$/i.test(text)) return null;
  const month = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(text);
  if (month?.[1] && month[2]) {
    const mm = MONTHS[month[1].toLowerCase()];
    if (!mm) return null;
    return `${month[2]}-${mm}-01`;
  }
  const year = /^(\d{4})$/.exec(text);
  if (year?.[1]) {
    const value = Number(year[1]);
    if (value < 1900 || value > 2100) return null;
    return `${year[1]}-01-01`;
  }
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash?.[1] && slash[2]) {
    const mm = Number(slash[1]);
    if (mm < 1 || mm > 12) return null;
    return `${slash[2]}-${String(mm).padStart(2, "0")}-01`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function parseDateRange(raw: string): { startedAt: string | null; endedAt: string | null } | null {
  const text = raw.trim();
  if (!text) return null;
  const ranged = /^(.+?)\s*(?:\u2013|\u2014|-|\bto\b)\s*(.+)$/i.exec(text);
  if (ranged?.[1] && ranged[2]) {
    const startedAt = parseDatePoint(ranged[1]);
    const endText = ranged[2].trim();
    if (startedAt !== null && /^(?:present|current)$/i.test(endText)) {
      return { startedAt, endedAt: null };
    }
    const endedAt = startedAt === null ? null : parseDatePoint(endText);
    if (startedAt !== null && endedAt !== null) return { startedAt, endedAt };
  }
  const startedAt = parseDatePoint(text);
  if (startedAt !== null) return { startedAt, endedAt: null };
  if (/^(?:present|current)$/i.test(text)) return { startedAt: null, endedAt: null };
  return null;
}

function dateInText(text: string): string | null {
  const month =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{4})\b/i.exec(
      text,
    );
  if (month?.[1] && month[2]) return parseDatePoint(`${month[1]} ${month[2]}`);
  const year = /\b((?:19|20)\d{2})\b/.exec(text);
  if (year?.[1]) return `${year[1]}-01-01`;
  return null;
}

function isFounderTitle(title: string): boolean {
  return /\b(?:co-founder|cofounder|co founder|founder)\b/i.test(title);
}

function jobKey(title: string, org: string, startedAt: string | null): string {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return `${norm(title)}\u0000${norm(org)}\u0000${startedAt ?? ""}`;
}

function headerFrom(
  title: string | undefined,
  org: string | undefined,
  dateText: string | null,
  dates: { startedAt: string | null; endedAt: string | null },
  body: string | undefined,
): ParsedHeader | null {
  const cleanTitle = title?.trim() ?? "";
  const cleanOrg = org?.trim() ?? "";
  if (!cleanTitle || !cleanOrg) return null;
  if (clauseClass(cleanTitle) !== "other") return null;
  const trimmedBody = body?.trim() ?? "";
  return {
    title: cleanTitle,
    org: cleanOrg,
    dateText: dateText?.trim() ?? null,
    startedAt: dates.startedAt,
    endedAt: dates.endedAt,
    body: trimmedBody.length > 0 ? trimmedBody : null,
  };
}

function parseHeader(line: string): ParsedHeader | null {
  const text = line.trim();
  if (!text || /^\s*[-*•]/.test(text)) return null;
  const paren = /^(.+?)\s+at\s+(.+?)\s*\(([^)]*)\)\s*(?::\s*([\s\S]*))?$/.exec(text);
  if (paren) {
    const dates = parseDateRange(paren[3] ?? "");
    if (dates) return headerFrom(paren[1], paren[2], paren[3] ?? null, dates, paren[4]);
  }
  const comma = /^(.+?)\s+at\s+(.+?),\s*([^:]+?)(?:\s*:\s*([\s\S]*))?$/.exec(text);
  if (comma) {
    const dates = parseDateRange(comma[3] ?? "");
    if (dates) return headerFrom(comma[1], comma[2], comma[3] ?? null, dates, comma[4]);
  }
  const colon = /^(.+?)\s+at\s+([^:]+?)\s*:\s*([\s\S]*)$/.exec(text);
  if (colon && clauseClass(colon[1]?.trim() ?? "") === "other") {
    return headerFrom(colon[1], colon[2], null, { startedAt: null, endedAt: null }, colon[3]);
  }
  const bare = /^(.+?)\s+at\s+(.+)$/.exec(text);
  if (bare && !text.includes(":") && clauseClass(text) === "other") {
    return headerFrom(bare[1], bare[2], null, { startedAt: null, endedAt: null }, undefined);
  }
  return null;
}

function isBullet(text: string): boolean {
  return /^\s*[-*•]\s+\S/.test(text);
}

function stripBullet(text: string): string {
  return text.replace(/^\s*[-*•]\s+/, "").trim();
}

function expandLines(lines: readonly JobClaimLine[]): PhysicalLine[] {
  const out: PhysicalLine[] = [];
  for (const line of lines) {
    const publishedAt = line.publishedAt ?? null;
    const parts = line.statement.split(/\r?\n/);
    if (parts.length === 1) {
      out.push({
        id: line.id,
        text: line.statement,
        publishedAt,
        statement: line.statement,
        sole: true,
      });
      continue;
    }
    for (let index = 0; index < parts.length; index++) {
      out.push({
        id: index === 0 ? line.id : `${line.id}#${index}`,
        text: parts[index] ?? "",
        publishedAt,
        statement: line.statement,
        sole: false,
      });
    }
  }
  return out;
}

function groupJobs(lines: readonly JobClaimLine[]): JobEvent[] {
  const events: JobEvent[] = [];
  const jobs = new Map<string, OpenJob>();
  let open: OpenJob | null = null;
  for (const line of expandLines(lines)) {
    if (line.text.trim().length === 0) {
      open = null;
      continue;
    }
    if (open && isBullet(line.text)) {
      open.bullets.push({
        id: line.id,
        text: stripBullet(line.text),
        publishedAt: line.publishedAt,
        statement: stripBullet(line.text),
      });
      continue;
    }
    const header = parseHeader(line.text);
    if (header) {
      const key = jobKey(header.title, header.org, header.startedAt);
      const existing = jobs.get(key);
      if (existing) {
        open = existing;
        if (header.body) {
          existing.bullets.push({
            id: line.id,
            text: header.body,
            publishedAt: line.publishedAt,
            statement: header.body,
          });
        }
        continue;
      }
      const job: OpenJob = {
        key,
        anchorId: line.id,
        title: header.title,
        org: header.org,
        dateText: header.dateText,
        startedAt: header.startedAt,
        endedAt: header.endedAt,
        founder: isFounderTitle(header.title),
        publishedAt: line.publishedAt,
        bullets: [],
      };
      if (header.body) {
        job.bullets.push({
          id: line.id,
          text: header.body,
          publishedAt: line.publishedAt,
          statement: header.body,
        });
      }
      jobs.set(key, job);
      events.push({ kind: "job", job });
      open = job;
      continue;
    }
    open = null;
    events.push({ kind: "free", line });
  }
  return events;
}

function isFundingSentence(sentence: string, seed: CompanySeed): boolean {
  if (
    /\bY Combinator\b/i.test(sentence) &&
    /\b(?:accepted|acceptance|joined|backed|funded|funding|raised)\b/i.test(sentence)
  ) {
    return true;
  }
  if (/\bYC\s+[WSF]\d{2}\b/.test(sentence)) return true;
  if (/\baccepted\s+(?:into|to)\s+YC\b/i.test(sentence)) return true;
  const investors = mentionedInvestors(sentence, seed);
  if (investors.length === 0) return false;
  if (/\braised\b/i.test(sentence) && /\b(?:from|by)\b/i.test(sentence)) return true;
  if (/\b(?:backed|funded)\s+by\b/i.test(sentence)) return true;
  return investors.some((investor) => fundLed(sentence, investor));
}

function fundLed(sentence: string, investor: SeedInvestor): boolean {
  for (const name of [investor.name, ...investor.aliases]) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b\\s+led\\b`, "i").test(sentence)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameSentence(left: string, right: string): boolean {
  const norm = (value: string) =>
    value
      .trim()
      .replace(/[.!;]+$/, "")
      .replace(/\s+/g, " ");
  return norm(left) === norm(right);
}

function fundingIn(
  text: string,
  seed: CompanySeed,
): { sentence: string; observedAt: string | null } | null {
  const sentences = text.split(/(?<=[.!;])\s+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed || !isFundingSentence(trimmed, seed)) continue;
    return { sentence: trimmed, observedAt: dateInText(trimmed) };
  }
  return null;
}

function headerLabel(job: OpenJob): string {
  if (job.dateText) return `${job.title} at ${job.org} (${job.dateText.trim()})`;
  return `${job.title} at ${job.org}`;
}

function datedClaim(input: {
  id: string;
  parentId: string;
  text: string;
  statement: string;
  claimClass: "selection" | "output";
  startedAt: string | null;
  endedAt: string | null;
  publishedAt: string | null;
  title: string;
  org: string;
  founder: boolean;
  noWorkDescribed?: true;
}): DatedClaim {
  const observedAt = observedAtForJobClaim(input.claimClass, {
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    publishedAt: input.publishedAt,
  });
  const claim: DatedClaim = {
    id: input.id,
    parentId: input.parentId,
    text: input.text,
    statement: input.statement,
    facts: extractFacts(input.text),
    claimClass: input.claimClass,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    observedAt,
    publishedAt: input.publishedAt,
    title: input.title,
    org: input.org,
    founder: input.founder,
  };
  if (input.noWorkDescribed) claim.noWorkDescribed = true;
  return claim;
}

function withBulletDates(
  claim: AtomicClaim,
  range: { startedAt: string | null; endedAt: string | null },
  publishedAt: string | null,
  title: string,
  org: string,
  founder: boolean,
): DatedClaim {
  const claimClass = clauseClass(claim.text) === "selection" ? "selection" : "output";
  return {
    ...claim,
    claimClass,
    startedAt: range.startedAt,
    endedAt: range.endedAt,
    observedAt: observedAtForJobClaim(claimClass, { ...range, publishedAt }),
    publishedAt,
    title,
    org,
    founder,
  };
}

function emitJob(job: OpenJob, seed: CompanySeed): DatedClaim[] {
  const range = { startedAt: job.startedAt, endedAt: job.endedAt };
  const label = headerLabel(job);
  const claims: DatedClaim[] = [];
  const funding = job.founder
    ? job.bullets
        .map((bullet) => ({ bullet, funding: fundingIn(bullet.text, seed) }))
        .find((entry) => entry.funding !== null)
    : undefined;
  if (!job.founder) {
    claims.push(
      datedClaim({
        id: `${job.anchorId}#hire`,
        parentId: job.anchorId,
        text: label,
        statement: label,
        claimClass: "selection",
        startedAt: range.startedAt,
        endedAt: range.endedAt,
        publishedAt: job.publishedAt,
        title: job.title,
        org: job.org,
        founder: false,
      }),
    );
  } else if (funding?.funding) {
    claims.push(
      datedClaim({
        id: `${job.anchorId}#funding`,
        parentId: job.anchorId,
        text: funding.funding.sentence,
        statement: funding.bullet.text,
        claimClass: "selection",
        startedAt: funding.funding.observedAt,
        endedAt: null,
        publishedAt: funding.bullet.publishedAt,
        title: job.title,
        org: job.org,
        founder: true,
      }),
    );
  }
  const consumed =
    funding?.funding && sameSentence(funding.bullet.text, funding.funding.sentence)
      ? funding.bullet.id
      : undefined;
  const outputs: DatedClaim[] = [];
  for (const bullet of job.bullets) {
    if (bullet.id === consumed) continue;
    for (const part of preprocessClaims(bullet.text, bullet.id)) {
      outputs.push(
        withBulletDates(part, range, bullet.publishedAt, job.title, job.org, job.founder),
      );
    }
  }
  if (outputs.length === 0) {
    outputs.push(
      datedClaim({
        id: `${job.anchorId}#no-work`,
        parentId: job.anchorId,
        text: label,
        statement: label,
        claimClass: "output",
        startedAt: range.startedAt,
        endedAt: range.endedAt,
        publishedAt: job.publishedAt,
        title: job.title,
        org: job.org,
        founder: job.founder,
        noWorkDescribed: true,
      }),
    );
  }
  claims.push(...outputs);
  return claims;
}

function emitJobs(events: readonly JobEvent[], seed: CompanySeed): SplitClaim[] {
  const claims: SplitClaim[] = [];
  for (const event of events) {
    if (event.kind === "free") {
      const statement = event.line.sole ? event.line.statement : event.line.text.trim();
      claims.push(...preprocessClaims(statement, event.line.id));
      continue;
    }
    claims.push(...emitJob(event.job, seed));
  }
  return claims;
}
