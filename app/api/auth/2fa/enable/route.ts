// POST /api/auth/2fa/enable { code } -> turns 2FA on, upgrades the session, returns the recovery codes once (trust spec §4).
import { z } from "zod";
import { enableTotp } from "@/lib/auth/mfa";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";
import { parseBody, requireAnySession, route } from "@/lib/http";

const Body = z.object({ code: z.string().regex(/^\d{6}$/, "6 digits") });

export const POST = route(async (req: Request) => {
  const { user_id } = await requireAnySession(req);
  const { code } = await parseBody(Body, req);
  const { db, clock } = getDeps();
  const recovery_codes = await enableTotp(user_id, code, db, clock.now());
  return Response.json({ ok: true, recovery_codes }, { headers: { "set-cookie": sessionCookie(await signSession(user_id, true)), "cache-control": "no-store" } });
});
