/**
 * The Sec-MS-GEC v2 token: `<16 hex>-<64 hex>`, a CS64 digest and a SHA-256
 * that is not quite SHA-256 (another initial state, one patched round
 * constant, and a start at round 14 from a 7-byte prefix of the data).
 *
 * A port of `src/edge_tts/drm.py` in rany2/edge-tts, at bd44c1d (edge_tts
 * 7.3.x). The service checks it, so every constant here is upstream's, byte for
 * byte; only the shape differs. Python's unbounded integers become plain
 * 32-bit math: `>>> 0` where Python masks, `Math.imul` where it multiplies
 * (the low 32 bits of a product are all that is ever kept). Upstream unrolls
 * the rounds eight at a time and rotates by multiplying with 2**32 + 1; both
 * are speed-ups, and the loop below is the ordinary round it equals.
 */

import { TRUSTED_CLIENT_TOKEN } from "./constants";

/** Seconds from the Windows file-time epoch (1601) to the Unix one. Upstream: `WIN_EPOCH`. */
const WIN_EPOCH = 11_644_473_600;

// Upstream: `_SHA256_INITIAL`.
const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
/** The state the first 14 rounds are taken to have left. Upstream: `_SHA256_STATE`. */
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
/** Schedule words 16..29 of the first block, before the data is added. Upstream: `_SHA256_SCHEDULE`. */
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
// Upstream: `_SHA256_ROUND_CONSTANTS`, FIPS 180-4.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
/** Replaces round constant 14 in the first block. Upstream: `_SHA256_ADJUSTMENT`. */
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_K_FIRST = SHA256_K.with(14, SHA256_ADJUSTMENT);
/** XORed into sigma0 of word 14 (at index 29) and sigma1 of word 14 (at index 16). */
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

/** Upstream: `_CS64_COEFFICIENTS`, as (coefficient, offset) pairs. */
const CS64_COEFFICIENTS: readonly (readonly [number, number])[] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
/** Upstream: `_rol16`. */
const rol16 = (x: number) => ((x << 16) | (x >>> 16)) >>> 0;
/** The low 32 bits of a product. */
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
const hex = (word: number) => word.toString(16).padStart(8, "0").toUpperCase();

/** Upstream: `_sha256_rounds`, with the working registers moved one place per round. */
function rounds(state: number[], words: Uint32Array, firstRound: number): number[] {
  const k = firstRound === 14 ? SHA256_K_FIRST : SHA256_K;
  let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = state;
  for (let i = firstRound; i < 64; i++) {
    const t1 =
      (h +
        (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
        (g ^ (e & (f ^ g))) +
        (k[i] ?? 0) +
        (words[i] ?? 0)) >>>
      0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
    [a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

/** Upstream: `_expand_sha256_schedule`: words `first..63`, from the earlier ones. */
function expand(words: Uint32Array, first = 16): void {
  for (let i = first; i < 64; i++) {
    const x = words[i - 2] ?? 0;
    const y = words[i - 15] ?? 0;
    const sigma1 = rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);
    const sigma0 = rotr(y, 7) ^ rotr(y, 18) ^ (y >>> 3);
    words[i] = (sigma1 >>> 0) + (words[i - 7] ?? 0) + (sigma0 >>> 0) + (words[i - 16] ?? 0);
  }
}

const sigma0 = (x: number) => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
const sigma1 = (x: number) => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;

/** Words 16..29 of the first block: fixed values plus the few terms that are not zero. Upstream: `_sha256_init`. */
function fillSchedule(words: Uint32Array): void {
  const at = (j: number) => words[j] ?? 0;
  for (let i = 16; i < 30; i++) {
    // Words 0..13 are zero, so a term only counts from word 14 up, and two
    // sigma terms carry an adjustment.
    const fromSigma1 = i - 2 >= 14 ? sigma1(at(i - 2)) : 0;
    const fromSigma0 = i - 15 >= 14 ? sigma0(at(i - 15)) : 0;
    words[i] =
      (SHA256_SCHEDULE[i - 16] ?? 0) +
      (i === 16 ? (fromSigma1 ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : fromSigma1) +
      (i - 7 >= 14 ? at(i - 7) : 0) +
      (i === 29 ? (fromSigma0 ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0 : fromSigma0);
  }
}

/** Upstream: `_sha256_init`: the state after round 14, from the first 7 bytes of the data. */
function shaInit(prefix: Uint8Array): number[] {
  const p = (i: number) => prefix[i] ?? 0;
  const words = new Uint32Array(64);
  words[14] = (p(0) << 16) | (p(1) << 8) | p(2);
  words[15] = ((p(3) << 24) | (p(4) << 16) | (p(5) << 8) | p(6)) >>> 0;
  fillSchedule(words);
  words[30] =
    sigma1(words[28] ?? 0) +
    (words[23] ?? 0) +
    sigma0(words[15] ?? 0) +
    (words[14] ?? 0) +
    SHA256_ADJUSTMENT -
    (SHA256_K[14] ?? 0);
  expand(words, 31);
  const working = rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, i) => (x + (working[i] ?? 0)) >>> 0);
}

/** Upstream: `_sha256_digest`. The first 7 bytes seed the state; the rest is hashed as if 57 bytes preceded it. */
function shaDigest(data: Uint8Array): Uint8Array {
  if (data.length < 7) throw new Error("Token salt must contain at least seven bytes");
  const length = 57 + data.length;
  const rest = data.subarray(7);
  const zeros = (((55 - length) % 64) + 64) % 64;
  const padded = new Uint8Array(rest.length + 1 + zeros + 8);
  padded.set(rest);
  padded[rest.length] = 0x80;
  new DataView(padded.buffer).setBigUint64(padded.length - 8, BigInt(length) * 8n);
  let state = shaInit(data.subarray(0, 7));
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    expand(words);
    const working = rounds(state, words, 0);
    state = state.map((x, i) => (x + (working[i] ?? 0)) >>> 0);
  }
  const out = new DataView(new ArrayBuffer(32));
  state.forEach((x, i) => {
    out.setUint32(i * 4, x);
  });
  return new Uint8Array(out.buffer);
}

/** Upstream: `_words_le4_even`: little-endian 32-bit words, zero-padded to an even count. */
function wordsLe(data: Uint8Array): number[] {
  const count = Math.ceil(data.length / 4);
  const padded = new Uint8Array((count + (count % 2)) * 4);
  padded.set(data);
  const view = new DataView(padded.buffer);
  return Array.from({ length: padded.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}

/** Upstream: `_cs64_digest`: two words, keyed from the first 8 bytes of the SHA-256. */
function cs64(data: Uint8Array, digest: Uint8Array): [number, number] {
  const keys = new DataView(digest.buffer, digest.byteOffset);
  const keyA = (keys.getUint32(0, true) | 1) >>> 0;
  const keyB = (keys.getUint32(4, true) | 1) >>> 0;
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)] as const;
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => mul(coefficient, factors[i % 2] ?? 0));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  const input = new Uint8Array(data.length + 1);
  input.set(data, 1);
  wordsLe(input).forEach((word, i) => {
    const even = i % 2 === 0;
    let term = mul(word, even ? keyA : keyB);
    let offset = mul(rol16(word), even ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = (term + mul(CS64_ADJUSTMENT0, factors[0])) >>> 0;
      offset = (offset + CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i] ?? 0;
    const y = terms[i + 1] ?? 0;
    let t = rol16(((offsets[i] ?? 0) + x) >>> 0);
    let q = mul(t, 0x76f50f34);
    swapAcc = (swapAcc + ((mul(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;
    t = rol16(((offsets[i + 1] ?? 0) + y) >>> 0);
    q = mul(t, 0x1881ce3c);
    swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (mul(state, keyA) + x) >>> 0;
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = (acc + state) >>> 0;
    t = (mul(state, keyB) + y) >>> 0;
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

/** Upstream: `_token_hash`: the CS64 and SHA-256 hex parts of the token, uppercase. */
export function tokenHash(data: Uint8Array): [cs64: string, sha256: string] {
  const digest = shaDigest(data);
  const [first, second] = cs64(data, digest);
  // `struct.pack("<II")`: each word as little-endian bytes, so the hex is byte-swapped.
  const le = (word: number) => hex(word).match(/../g)?.reverse().join("") ?? "";
  const sha = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [le(first) + le(second), sha.toUpperCase()];
}

/** The Sec-MS-GEC v2 token for a time: Windows file time in 5-minute steps, plus the client token. Upstream: `generate_sec_ms_gec_v2`. */
export function secMsGec(nowMs: number): string {
  let seconds = Math.floor(nowMs / 1000) + WIN_EPOCH;
  seconds -= seconds % 300;
  const ticks = BigInt(seconds) * 10_000_000n;
  const [cs, sha] = tokenHash(new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`));
  return `${cs}-${sha}`;
}
