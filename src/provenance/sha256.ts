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

const hex8 = (n: number): string => n.toString(16).padStart(8, "0");

/**
 * Scratch state, reused across calls to keep hashing allocation-free on the hot
 * path. Safe because every function here is synchronous and never yields: one
 * `sha256HexBytes` call runs to completion before another can start, so no two
 * hashes ever share these buffers.
 */
const w = new Uint32Array(64);
const h = new Uint32Array(8);
/** Room for the final partial block plus, when it does not fit, one more. */
const tail = new Uint8Array(128);
const tailView = new DataView(tail.buffer);
const encoder = new TextEncoder();

/** One 64-byte block into `h`. */
function compress(view: DataView, offset: number): void {
  for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
  for (let i = 16; i < 64; i++) {
    const x = word(w, i - 15);
    const y = word(w, i - 2);
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (word(w, i - 16) + s0 + word(w, i - 7) + s1) >>> 0;
  }

  let a = word(h, 0);
  let b = word(h, 1);
  let c = word(h, 2);
  let d = word(h, 3);
  let e = word(h, 4);
  let f = word(h, 5);
  let g = word(h, 6);
  let hh = word(h, 7);

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

  h[0] = (word(h, 0) + a) >>> 0;
  h[1] = (word(h, 1) + b) >>> 0;
  h[2] = (word(h, 2) + c) >>> 0;
  h[3] = (word(h, 3) + d) >>> 0;
  h[4] = (word(h, 4) + e) >>> 0;
  h[5] = (word(h, 5) + f) >>> 0;
  h[6] = (word(h, 6) + g) >>> 0;
  h[7] = (word(h, 7) + hh) >>> 0;
}

/** SHA-256 of raw bytes, lowercase hex. */
export function sha256HexBytes(bytes: Uint8Array): string {
  h[0] = 0x6a09e667;
  h[1] = 0xbb67ae85;
  h[2] = 0x3c6ef372;
  h[3] = 0xa54ff53a;
  h[4] = 0x510e527f;
  h[5] = 0x9b05688c;
  h[6] = 0x1f83d9ab;
  h[7] = 0x5be0cd19;

  const byteLength = bytes.length;
  const whole = byteLength - (byteLength % 64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < whole; offset += 64) compress(view, offset);

  // The remainder, then one 0x80 byte, zeros, and the 64-bit big-endian bit
  // length; that needs a second block when the remainder reaches 56 bytes.
  const rest = byteLength - whole;
  const total = rest < 56 ? 64 : 128;
  tail.fill(0, 0, total);
  tail.set(bytes.subarray(whole), 0);
  tail[rest] = 0x80;
  const bitLength = byteLength * 8;
  tailView.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  tailView.setUint32(total - 4, bitLength >>> 0);
  for (let offset = 0; offset < total; offset += 64) compress(tailView, offset);

  return (
    hex8(word(h, 0)) +
    hex8(word(h, 1)) +
    hex8(word(h, 2)) +
    hex8(word(h, 3)) +
    hex8(word(h, 4)) +
    hex8(word(h, 5)) +
    hex8(word(h, 6)) +
    hex8(word(h, 7))
  );
}

/** SHA-256 of a string's UTF-8 bytes, lowercase hex. */
export function sha256Hex(text: string): string {
  return sha256HexBytes(encoder.encode(text));
}
