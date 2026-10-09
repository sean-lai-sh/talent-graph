/**
 * Recursive key scan for judge-weight leaks.
 * Walks objects and arrays to any depth. Matches keys, not prose.
 * `w` is exact. Longer names match case-insensitively.
 */

export const WEIGHT_KEYS = [
  "w",
  "omega",
  "ω",
  "weight",
  "judgeWeight",
  "admissionCredit",
  "accuracyCredit",
  "movementCredit",
  "credit",
  "recognition",
  "recognitionAnswer",
] as const;

export type WeightKey = (typeof WEIGHT_KEYS)[number];

const MULTI = new Set<string>([
  "omega",
  "ω",
  "weight",
  "judgeweight",
  "admissioncredit",
  "accuracycredit",
  "movementcredit",
  "credit",
  "recognition",
  "recognitionanswer",
]);

export type WeightHit = { path: string; key: string };

export function isWeightKey(key: string): boolean {
  if (key === "w" || key === "ω") return true;
  return MULTI.has(key.toLowerCase());
}

export function scanWeightKeys(value: unknown): WeightHit[] {
  const hits: WeightHit[] = [];
  const seen = new Set<object>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${path}[${i}]`);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const here = path === "" ? key : `${path}.${key}`;
      if (isWeightKey(key)) hits.push({ path: here, key });
      walk(child, here);
    }
  };

  walk(value, "");
  return hits;
}

type NextDepth = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Compile-time: a weight key anywhere in T, through objects and arrays. */
export type ForbiddenWeightKeys<T, D extends number = 0> = D extends 8
  ? never
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer Item)[]
      ? ForbiddenWeightKeys<Item, NextDepth[D]>
      : T extends object
        ? {
            [K in keyof T]-?: K extends WeightKey ? K : ForbiddenWeightKeys<T[K], NextDepth[D]>;
          }[keyof T]
        : never;

export type AssertNoWeightKeys<T> = [ForbiddenWeightKeys<T>] extends [never] ? true : never;

const JSON_KEY =
  /"(w|omega|ω|weight|judgeWeight|admissionCredit|accuracyCredit|movementCredit|credit|recognition|recognitionAnswer)"\s*:/i;

export function scanJsonText(text: string): WeightHit[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  try {
    return scanWeightKeys(JSON.parse(trimmed) as unknown);
  } catch {
    const hits: WeightHit[] = [];
    const flags = JSON_KEY.flags.includes("g") ? JSON_KEY.flags : `${JSON_KEY.flags}g`;
    const re = new RegExp(JSON_KEY.source, flags);
    for (const match of trimmed.matchAll(re)) {
      const key = match[1] ?? "";
      if (key !== "" && isWeightKey(key)) hits.push({ path: key, key });
    }
    return hits;
  }
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text.replace(/"password"\s*:\s*"[^"]*"/g, '"password":"[redacted]"');
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}
