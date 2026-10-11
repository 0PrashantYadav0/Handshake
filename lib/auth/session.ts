// jose HS256 tokens: the hs_session cookie and the magic-link token (15 min), told apart by `purpose` (F1, F2).
// A session carries `mfa`: true after the second factor (30 days), false before it (15 min, trust spec §4).
import "server-only";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "hs_session";
export const SESSION_TTL_SEC = 30 * 24 * 3600;
export const LOGIN_TTL_SEC = 15 * 60;
export const PARTIAL_TTL_SEC = 15 * 60;

type Purpose = "session" | "login";

const key = (secret: string) => new TextEncoder().encode(secret);
const secretFromEnv = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (>= 32 chars)");
  return s;
};

export async function signToken(sub: string, purpose: Purpose, ttlSec: number, secret = secretFromEnv(), claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ ...claims, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomUUID())
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .sign(key(secret));
}

/** Returns the subject, or null when the token is invalid, expired, or for another purpose. */
export async function readToken(token: string, purpose: Purpose, secret = secretFromEnv()): Promise<string | null> {
  return (await readClaims(token, purpose, secret))?.sub ?? null;
}

export type Claims = { sub: string; jti: string | null; exp: number; mfa: boolean };
/** Subject, token id, expiry and the mfa flag. */
export async function readClaims(token: string, purpose: Purpose, secret = secretFromEnv()): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose || typeof payload.sub !== "string") return null;
    return { sub: payload.sub, jti: payload.jti ?? null, exp: payload.exp ?? 0, mfa: payload.mfa === true };
  } catch {
    return null;
  }
}

/** mfa false = partial session: it can only reach the second-factor screens (trust spec §4). */
export const signSession = (userId: string, mfa: boolean, secret?: string) =>
  signToken(userId, "session", mfa ? SESSION_TTL_SEC : PARTIAL_TTL_SEC, secret, { mfa });
/** The user id of a full (second-factor) session; null for a partial or invalid one. */
export async function readSession(token: string, secret?: string): Promise<string | null> {
  const c = await readClaims(token, "session", secret);
  return c?.mfa ? c.sub : null;
}
/** Full or partial. */
export const readSessionClaims = (token: string, secret?: string) => readClaims(token, "session", secret);

export function sessionCookie(token: string, mfa = true): string {
  return cookie(token, mfa ? SESSION_TTL_SEC : PARTIAL_TTL_SEC);
}
export function clearSessionCookie(): string {
  return cookie("", 0);
}
function cookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
