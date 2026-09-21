/**
 * Provenance hashing: the vendored SHA-256 must agree with `Bun.CryptoHasher`
 * byte for byte (a divergence would silently change every run id), and must
 * keep working where no `Bun` global exists (Next.js, Convex).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { hashInputs, stableStringify } from "../src/provenance/hash.ts";
import { sha256Hex, sha256HexBytes } from "../src/provenance/sha256.ts";
import { generateSeed } from "../src/seed/generate.ts";

const ROOT = join(import.meta.dir, "..");
const data = generateSeed();
const COLLECTIONS: Array<[string, unknown]> = Object.entries(data);

/** What the module replaced: the reference digest this refactor must reproduce. */
function bunDigest(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

describe("vendored SHA-256 against published test vectors", () => {
  test("FIPS 180-4 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  test("block boundaries: 55, 56, 63, 64 and 65 bytes", () => {
    for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121]) {
      const s = "a".repeat(n);
      expect(sha256Hex(s), `length ${n}`).toBe(bunDigest(s));
    }
  });

  test("non-ASCII input hashes its UTF-8 bytes", () => {
    const s = "héllo → 漢字 🎉 ünïcode";
    expect(sha256Hex(s)).toBe(bunDigest(s));
    expect(sha256HexBytes(new TextEncoder().encode(s))).toBe(bunDigest(s));
  });

  test("multi-block input over 1 MB", () => {
    const s = "seed-observation-".repeat(70_000); // ~1.2 MB
    expect(s.length).toBeGreaterThan(1_000_000);
    expect(sha256Hex(s)).toBe(bunDigest(s));
  });
});

describe("(a) hashInputs equals Bun.CryptoHasher over stableStringify", () => {
  for (const [name, collection] of COLLECTIONS) {
    test(`seed collection: ${name}`, () => {
      expect(hashInputs(collection)).toBe(bunDigest(stableStringify(collection)));
    });
  }

  test("the whole seed dataset", () => {
    expect(hashInputs(data)).toBe(bunDigest(stableStringify(data)));
  });

  test("a Date / Map / Set fixture", () => {
    const fixture = {
      at: new Date("2024-03-01T12:00:00.000Z"),
      tags: new Set(["b", "a", "c"]),
      weights: new Map<string, unknown>([
        ["z", 1],
        ["a", { when: new Date("2020-01-02T03:04:05.678Z"), of: new Set([2, 1]) }],
      ]),
      nested: { b: 2, a: [1, null, "ünïcode"] },
    };
    expect(hashInputs(fixture)).toBe(bunDigest(stableStringify(fixture)));
  });
});

describe("(b) frozen golden", () => {
  const fixture = {
    at: new Date("2024-03-01T12:00:00.000Z"),
    tags: new Set(["b", "a"]),
    m: new Map([
      ["z", 1],
      ["a", 2],
    ]),
    nested: { b: 2, a: [1, null, "x"] },
  };

  test("stableStringify shape is frozen", () => {
    expect(stableStringify(fixture)).toBe(
      '{"at":"2024-03-01T12:00:00.000Z","m":{"__map":[["a",2],["z",1]]},' +
        '"nested":{"a":[1,null,"x"],"b":2},"tags":{"__set":["a","b"]}}',
    );
  });

  test("hashInputs of that fixture is a frozen literal", () => {
    expect(hashInputs(fixture)).toBe(
      "c144aa4a289bb70fa3496deded1c483843646fe2d1c77457708df5b586962718",
    );
  });
});

describe("(c) no Bun global required", () => {
  test("the module hashes in a realm where globalThis.Bun does not exist", async () => {
    // `Bun` is a non-configurable global under Bun, so it cannot be deleted in
    // place; a fresh vm realm is the same thing from the module's point of view,
    // and is what Next.js / Convex actually look like.
    const built = await Bun.build({
      entrypoints: [join(ROOT, "src/provenance/hash.ts")],
      format: "cjs",
      target: "node",
    });
    const code = await (built.outputs[0] as { text(): Promise<string> }).text();
    const module_: { exports: Record<string, unknown> } = { exports: {} };
    // Host constructors, so that `x instanceof Date` still holds for host values;
    // in production the module and its inputs share one realm.
    const sandbox = { TextEncoder, Date, Map, Set, module: module_, exports: module_.exports };
    createContext(sandbox);
    runInContext(code, sandbox);

    expect(runInContext("typeof Bun", sandbox)).toBe("undefined");
    const hashThere = module_.exports.hashInputs as (input: unknown) => string;
    const stringifyThere = module_.exports.stableStringify as (input: unknown) => string;
    expect(stringifyThere(data.referrals)).toBe(stableStringify(data.referrals));
    expect(hashThere(data.referrals)).toBe(bunDigest(stableStringify(data.referrals)));
    expect(hashThere("")).toBe(bunDigest('""'));
  });

  test("src/provenance names no Bun global and imports no node: module", () => {
    for (const file of ["src/provenance/hash.ts", "src/provenance/sha256.ts"]) {
      const source = readFileSync(join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(/\bBun\b/.test(source), `${file} references Bun`).toBe(false);
      expect(/from\s+["']node:/.test(source), `${file} imports node:`).toBe(false);
    }
  });
});

describe("(e) hashing stays fast enough for a synchronous call site", () => {
  /** Warm average; a single cold call is dominated by JIT warm-up, not by the hash. */
  function averageMs(input: unknown, runs: number): number {
    for (let i = 0; i < 20; i++) hashInputs(input);
    const started = performance.now();
    for (let i = 0; i < runs; i++) hashInputs(input);
    return (performance.now() - started) / runs;
  }

  for (const [name, collection] of COLLECTIONS) {
    test(`hashInputs over all seed ${name} stays under 1 ms`, () => {
      expect(averageMs(collection, 50)).toBeLessThan(1);
    });
  }

  test("hashing every seed collection at once stays well under a frame", () => {
    expect(averageMs(Object.values(data), 50)).toBeLessThan(5);
  });
});
