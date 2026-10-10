// GET /api/auth/callback?token=&next= -> upserts the user, sets hs_session, 302 to next; bad token -> 302 /?error=invalid_link (04 section 4.2).
import { safeNext, verifyMagicToken } from "@/lib/auth/magic-link";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";
import { route } from "@/lib/http";

const redirect = (location: string, cookie?: string) =>
  new Response(null, { status: 302, headers: cookie ? { location, "set-cookie": cookie } : { location } });

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const email = await verifyMagicToken(url.searchParams.get("token") ?? "");
  if (!email) return redirect("/?error=invalid_link");
  const user = await getDeps().db.user.upsert({ where: { email }, create: { email }, update: {}, select: { id: true } });
  return redirect(safeNext(url.searchParams.get("next")), sessionCookie(await signSession(user.id)));
});
