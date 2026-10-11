// Magic-link token (purpose "login", 15 min) and the link the email carries (F2; 02 section 9.1; 04 section 4.1).
import { LOGIN_TTL_SEC, readClaims, signToken } from "./session";

/** 04 section 4.1: relative paths only; `//evil` and `/\evil` fall back to /ledger. */
export function safeNext(next: string | null | undefined): string {
  return next && next.length <= 200 && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : "/ledger";
}

export const createMagicToken = (email: string): Promise<string> =>
  signToken(email.trim().toLowerCase(), "login", LOGIN_TTL_SEC);

// ponytail: in-memory single-use set, so one instance only; a used_tokens table if we ever scale out.
const used = new Map<string, number>(); // jti -> exp (seconds)
/** The lower-cased email, or null when the token is invalid, expired, not a login token, or already used. */
export async function verifyMagicToken(token: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string | null> {
  const claims = await readClaims(token, "login");
  if (!claims || !claims.jti) return null;
  for (const [id, exp] of used) if (exp <= nowSec) used.delete(id);
  if (used.has(claims.jti)) return null;
  used.set(claims.jti, claims.exp);
  return claims.sub;
}

export function buildMagicLink(token: string, next?: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/auth/callback?${new URLSearchParams({ token, next: safeNext(next) })}`;
}
