// Magic-link token (purpose "login", 15 min) and the link the email carries (F2; 02 section 9.1; 04 section 4.1).
import type { PrismaClient } from "@/generated/prisma/client";
import { LOGIN_TTL_SEC, readClaims, signToken } from "./session";

/** 04 section 4.1: relative paths only; `//evil` and `/\evil` fall back to /dashboard (trust spec §10: home after sign-in). */
export function safeNext(next: string | null | undefined): string {
  return next && next.length <= 200 && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : "/dashboard";
}

export const createMagicToken = (email: string): Promise<string> =>
  signToken(email.trim().toLowerCase(), "login", LOGIN_TTL_SEC);

/**
 * The lower-cased email, or null when the token is invalid, expired, not a login token, or already used.
 * H-1: the jti is recorded in Postgres, so a link works once even across restarts and instances; the insert is the claim.
 */
export async function verifyMagicToken(token: string, db: Pick<PrismaClient, "usedLoginToken">, now = new Date()): Promise<string | null> {
  const claims = await readClaims(token, "login");
  if (!claims || !claims.jti) return null;
  await db.usedLoginToken.deleteMany({ where: { expires_at: { lt: now } } });
  const { count } = await db.usedLoginToken.createMany({ data: [{ jti: claims.jti, expires_at: new Date(claims.exp * 1000) }], skipDuplicates: true });
  return count === 1 ? claims.sub : null;
}

export function buildMagicLink(token: string, next?: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/auth/callback?${new URLSearchParams({ token, next: safeNext(next) })}`;
}
