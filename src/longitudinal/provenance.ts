/**
 * Content fingerprints for the longitudinal pipeline.
 *
 * The serializer is the shared one in `src/provenance/hash.ts`: one repository,
 * one stable JSON form. The private serializer that used to live here did not
 * handle `Date`, `Map` or `Set` — every `Date` collapsed to `{}`, so two
 * different dates produced the same fingerprint, and claim ids are derived from
 * this function.
 *
 * The digest stays the portable 16-hex non-cryptographic one rather than the
 * SHA-256 of `hashInputs`: it runs in the Next/edge runtime, and every claim id
 * and snapshot `contentHash` already recorded is derived from it.
 * `tests/longitudinal.fingerprints.test.ts` pins those digests.
 */

import { stableStringify } from "../provenance/hash.ts";

/** Stable non-security fingerprint used for idempotency and change detection. */
export function contentFingerprint(value: unknown): string {
  const text = stableStringify(value);
  if (typeof text !== "string") {
    throw new TypeError(
      `contentFingerprint: value does not serialise to JSON (got ${typeof value}); ` +
        "a content fingerprint must fingerprint real content",
    );
  }
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + i), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}
