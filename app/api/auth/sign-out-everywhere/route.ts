// POST /api/auth/sign-out-everywhere -> every session of this account stops working, this one included (review note).
import { clearSessionCookie } from "@/lib/auth/session";
import { signOutEverywhere } from "@/lib/auth/session-version";
import { getDeps } from "@/lib/deps";
import { requireAnySession, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const { user_id } = await requireAnySession(req);
  await signOutEverywhere(user_id, getDeps().db);
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
});
