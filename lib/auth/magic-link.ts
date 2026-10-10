// Magic-link token (purpose "login", 15 min) and the link the email carries (F2; 02 section 9.1; 04 section 4.1).
import { LOGIN_TTL_SEC, readToken, signToken } from "./session";

/** 04 section 4.1: relative paths only; `//evil` and `/\evil` fall back to /ledger. */
export function safeNext(next: string | null | undefined): string {
  return next && next.length <= 200 && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : "/ledger";
}

export const createMagicToken = (email: string): Promise<string> =>
  signToken(email.trim().toLowerCase(), "login", LOGIN_TTL_SEC);

/** The lower-cased email, or null when the token is invalid, expired or not a login token. */
export const verifyMagicToken = (token: string): Promise<string | null> => readToken(token, "login");

export function buildMagicLink(token: string, next?: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/auth/callback?${new URLSearchParams({ token, next: safeNext(next) })}`;
}
