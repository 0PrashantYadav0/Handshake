// TOTP second factor (trust spec §4): RFC 6238 with HMAC-SHA1, 6 digits, 30 s steps, one step of drift either way.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SEC = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP. */
export function hotp(key: Uint8Array, counter: number, digits = 6, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SEC);
export const totpAt = (secretB32: string, nowMs: number) => hotp(base32Decode(secretB32), stepAt(nowMs));

/** The matched step (now - 1 .. now + 1), or null. Steps <= lastStep are refused so a code works once. */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** 160-bit secret, base32 (the RFC 4226 recommended length). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function otpauthUri(secretB32: string, account: string, issuer = "Handshake"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?${new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: "6", period: String(STEP_SEC) })}`;
}

// Recovery codes: 10 random base32 characters (50 bits) shown as XXXXX-XXXXX; stored as SHA-256 of the normalised code.
export const normaliseRecovery = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();
export const hashRecovery = (code: string) => createHash("sha256").update(normaliseRecovery(code)).digest("hex");
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const c = base32Encode(randomBytes(7)).slice(0, 10);
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}
