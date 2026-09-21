/**
 * Provenance hashing — runtime-agnostic and synchronous.
 *
 * Every id in the system (ModelRun ids, snapshot ids) is a fingerprint of the
 * raw inputs, so this must produce byte-identical digests everywhere it runs:
 * Bun, Next.js, and Convex query handlers. The call sites are synchronous, so
 * the async `crypto.subtle` digest is out and `node:crypto` is unavailable;
 * the SHA-256 is vendored in `./sha256.ts` instead of reaching for
 * `Bun.CryptoHasher`.
 *
 * This module imports nothing from `models/`, `scoring/`, `inference/` or
 * `judges/` — a caller that wants a hash should not drag in the model graph.
 */

import { sha256Hex } from "./sha256.ts";

/** Deterministic JSON: object keys sorted, Dates as ISO strings, Maps as entries. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return { __map: [...value.entries()].sort().map(([k, v]) => [k, normalise(v)]) };
  }
  if (value instanceof Set) return { __set: [...value].map(normalise).sort() };
  if (Array.isArray(value)) return value.map(normalise);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = normalise(obj[key]);
  return out;
}

/** SHA-256 hex of the stable JSON form. */
export function hashInputs(inputs: unknown): string {
  return sha256Hex(stableStringify(inputs));
}
