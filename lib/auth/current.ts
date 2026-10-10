// Server components only: the session user from the hs_session cookie (08 section 4.2 first paint).
import { cookies } from "next/headers";
import { getMe, type Me } from "@/lib/auth/me";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? readSession(token) : null;
}

/** null when signed out or the cookie names a deleted user. */
export async function currentUser(): Promise<Me | null> {
  const id = await currentUserId();
  return id ? getMe(id, getDeps().db).catch(() => null) : null;
}
