// jose HS256 tokens: the hs_session cookie (30 days) and the magic-link token (15 min), told apart by `purpose` (F1, F2).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "hs_session";
export const SESSION_TTL_SEC = 30 * 24 * 3600;
export const LOGIN_TTL_SEC = 15 * 60;

type Purpose = "session" | "login";

const key = (secret: string) => new TextEncoder().encode(secret);
const secretFromEnv = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (>= 32 chars)");
  return s;
};

export async function signToken(sub: string, purpose: Purpose, ttlSec: number, secret = secretFromEnv()): Promise<string> {
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .sign(key(secret));
}

/** Returns the subject, or null when the token is invalid, expired, or for another purpose. */
export async function readToken(token: string, purpose: Purpose, secret = secretFromEnv()): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload.purpose === purpose && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const signSession = (userId: string, secret?: string) => signToken(userId, "session", SESSION_TTL_SEC, secret);
export const readSession = (token: string, secret?: string) => readToken(token, "session", secret);

export function sessionCookie(token: string): string {
  return cookie(token, SESSION_TTL_SEC);
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
