// Server components only: the session user from the hs_session cookie (08 section 4.2 first paint; trust spec §4).
import { cookies } from "next/headers";
import { getMe, type Me } from "@/lib/auth/me";
import { readSessionClaims, SESSION_COOKIE, type Claims } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";
import { liveClaims } from "./session-version";

/** Full or partial session claims, or null. */
export async function sessionClaims(): Promise<Claims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return liveClaims(token ? await readSessionClaims(token) : null, getDeps().db);
}

/** The user id of a full (second-factor) session only. */
export async function currentUserId(): Promise<string | null> {
  const c = await sessionClaims();
  return c?.mfa ? c.sub : null;
}

/** null when signed out, half signed in, or the cookie names a deleted user. */
export async function currentUser(): Promise<Me | null> {
  const id = await currentUserId();
  return id ? getMe(id, getDeps().db).catch(() => null) : null;
}
