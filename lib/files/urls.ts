// Signed, expiring file URLs (B6; 02 section 9.3; 04 section 8.2): sig = base64url(HMAC-SHA256(FILE_URL_SECRET, "{id}.{exp}")).
import { createHmac, timingSafeEqual } from "node:crypto";

const secretFromEnv = () => {
  const s = process.env.FILE_URL_SECRET;
  if (!s) throw new Error("FILE_URL_SECRET must be set");
  return s;
};

const sign = (id: string, exp: string, secret: string) => createHmac("sha256", secret).update(`${id}.${exp}`).digest("base64url");

export function signFileUrl(id: string, ttlSec = 600, now: Date = new Date(), secret = secretFromEnv()): string {
  const exp = String(Math.floor(now.getTime() / 1000) + ttlSec);
  return `/api/files/${id}?exp=${exp}&sig=${sign(id, exp, secret)}`;
}

/** False on a missing or non-numeric exp, a past exp, or a sig of the wrong length or value. Never throws on bad input. */
export function verifyFileUrl(id: string, exp: string | null, sig: string | null, now: Date = new Date(), secret = secretFromEnv()): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(now.getTime() / 1000)) return false;
  const expected = Buffer.from(sign(id, exp, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
