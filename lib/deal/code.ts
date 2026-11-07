// public_code (decisions I4): HS- + 4 characters from a 30-letter alphabet (no 0, O, 1, I, L, 5). 810,000 codes exist;
// createDeal retries on a unique violation (T-08), so a collision is handled, not prevented.
// No 5: the demo kit's handwriting font draws it like a small s, and Claude rightly called HS-FAS5 unclear. CODE_RE still takes 5 for deals made before.
export const CODE_ALPHABET = "2346789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_RE = /^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/** A number in [0, 1) from crypto.getRandomValues, drawn 64 at a time. */
const pool = new Uint32Array(64);
let used = pool.length;
export function secureRandom(): number {
  if (used === pool.length) {
    crypto.getRandomValues(pool);
    used = 0;
  }
  return pool[used++] / 2 ** 32;
}

/** random is injectable so a test can force a repeated code. */
export function newPublicCode(random: () => number = secureRandom): string {
  let s = "HS-";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}
