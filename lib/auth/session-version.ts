// Session revocation (review note): a session is valid only while its sv claim equals the user's session_version.
import type { PrismaClient } from "@/generated/prisma/client";
import { sessionCookie, signSession, type Claims } from "./session";

/** null when the user is gone or the session predates a "sign out everywhere". */
export async function liveClaims(c: Claims | null, db: PrismaClient): Promise<Claims | null> {
  if (!c) return null;
  const u = await db.user.findUnique({ where: { id: c.sub }, select: { session_version: true } });
  return u && u.session_version === c.sv ? c : null;
}

/** A Set-Cookie value for a new session at the user's current version. */
export async function issueSession(userId: string, mfa: boolean, db: PrismaClient): Promise<string> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { session_version: true } });
  return sessionCookie(await signSession(userId, mfa, undefined, u.session_version), mfa);
}

/** Ends every session of this user, including the caller's. */
export async function signOutEverywhere(userId: string, db: PrismaClient): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { session_version: { increment: 1 } } });
}
