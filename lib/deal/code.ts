// public_code (decisions I4): HS- + 4 characters from a 31-letter alphabet (no 0, O, 1, I, L). 923,521 codes exist;
// createDeal retries on a unique violation (T-08), so a collision is handled, not prevented.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_RE = /^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/** A number in [0, 1) from crypto.getRandomValues. */
export function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

/** random is injectable so a test can force a repeated code. */
export function newPublicCode(random: () => number = secureRandom): string {
  let s = "HS-";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}
