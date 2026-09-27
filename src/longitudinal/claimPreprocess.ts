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

const NUM = String.raw`\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kK]?\+?`;
const NUMBER = String.raw`(?<![\w.])(${NUM})(?![\w])`;
const BETWEEN = String.raw`(?:\s+[A-Za-z][A-Za-z'-]*){0,2}`;
const TIME_UNIT = "milliseconds?|seconds?|minutes?|hours?|days?|secs?|mins?|hrs?|ms|sec|min|hr|s";
const QTY = String.raw`(?<![\w.])([+-])?\s*(${NUM})\s*(%|${TIME_UNIT})(?![A-Za-z])`;

const OUTPUT_VERB =
  /\b(?:led|owned|founded|built|developed|designed|contributed|assisted|helped|shipped|launched|created|worked\s+under)\b/i;

const CLAUSE_VERB = /\b(?:kept|cut|made|ran|wrote|did|spoke|[A-Za-z]+(?:ed|ing))\b/i;

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

function roleColonHalves(statement: string): readonly [string, string] | null {
  const match = /^(.+?\sat\s+[^:]+):\s+(\S[\s\S]*)$/.exec(statement);
  const title = match?.[1]?.trim() ?? "";
  const body = match?.[2]?.trim() ?? "";
  if (title.length === 0 || body.length === 0 || !hasClauseVerb(body)) return null;
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
  if (roleColonHalves(statement)) return [statement];
  const sentences = sentenceParts(statement);
  if (sentences) {
    const glued = glueOthers(statement, sentences);
    if (glued) return glued;
  }
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
      statement,
      facts: extractFacts(text),
    };
  });
}
