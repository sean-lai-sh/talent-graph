/**
 * Vendored SHA-256 (FIPS 180-4) — pure TypeScript, no runtime dependencies.
 *
 * The package advertises zero runtime deps and this module is imported from
 * environments that provide neither `Bun` nor `node:crypto`, and where the
 * call site is synchronous (so the async `crypto.subtle` digest is out).
 * Hence a small, self-contained implementation.
 */

/** Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const word = (a: Uint32Array, i: number): number => a[i] as number;

const byteAt = (a: Uint8Array, i: number): number => a[i] as number;

const hex8 = (n: number): string => n.toString(16).padStart(8, "0");

/** Scratch message schedule, reused across calls; this module is synchronous throughout. */
const w = new Uint32Array(64);

/** SHA-256 of raw bytes, lowercase hex. */
export function sha256HexBytes(bytes: Uint8Array): string {
  const byteLength = bytes.length;
  // One 0x80 byte, then zeros until 56 mod 64, then the 64-bit big-endian bit length.
  const zeros = (56 - ((byteLength + 1) % 64) + 64) % 64;
  const total = byteLength + 1 + zeros + 8;
  const message = new Uint8Array(total);
  message.set(bytes);
  message[byteLength] = 0x80;
  const bitLength = byteLength * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  message[total - 8] = (high >>> 24) & 0xff;
  message[total - 7] = (high >>> 16) & 0xff;
  message[total - 6] = (high >>> 8) & 0xff;
  message[total - 5] = high & 0xff;
  message[total - 4] = (low >>> 24) & 0xff;
  message[total - 3] = (low >>> 16) & 0xff;
  message[total - 2] = (low >>> 8) & 0xff;
  message[total - 1] = low & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const o = offset + i * 4;
      w[i] =
        (byteAt(message, o) << 24) |
        (byteAt(message, o + 1) << 16) |
        (byteAt(message, o + 2) << 8) |
        byteAt(message, o + 3);
    }
    for (let i = 16; i < 64; i++) {
      const x = word(w, i - 15);
      const y = word(w, i - 2);
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (word(w, i - 16) + s0 + word(w, i - 7) + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let hh = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + word(K, i) + word(w, i)) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + hh) >>> 0;
  }

  return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4) + hex8(h5) + hex8(h6) + hex8(h7);
}

/** SHA-256 of a string's UTF-8 bytes, lowercase hex. */
export function sha256Hex(text: string): string {
  return sha256HexBytes(new TextEncoder().encode(text));
}
