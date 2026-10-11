// GET /api/auth/callback?token=&next= -> upserts the user, sets a partial hs_session, 302 to the second factor (trust spec §4):
// /signin/2fa when 2FA is on, /security/setup when it is not. Bad token -> 302 /signin?error=invalid_link (04 section 4.2).
import { safeNext, verifyMagicToken } from "@/lib/auth/magic-link";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";
import { route } from "@/lib/http";

const redirect = (location: string, cookie?: string) =>
  new Response(null, { status: 302, headers: cookie ? { location, "set-cookie": cookie } : { location } });

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const email = await verifyMagicToken(url.searchParams.get("token") ?? "");
  if (!email) return redirect("/signin?error=invalid_link");
  const user = await getDeps().db.user.upsert({ where: { email }, create: { email }, update: {}, select: { id: true, totp_enabled_at: true } });
  const next = encodeURIComponent(safeNext(url.searchParams.get("next")));
  const to = user.totp_enabled_at ? `/signin/2fa?next=${next}` : `/security/setup?next=${next}`;
  return redirect(to, sessionCookie(await signSession(user.id, false), false));
});
