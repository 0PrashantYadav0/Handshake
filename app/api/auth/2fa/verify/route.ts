// POST /api/auth/2fa/verify { code } | { recovery_code } -> upgrades a partial session to a full one (trust spec §4).
import { z } from "zod";
import { checkTotp, useRecoveryCode } from "@/lib/auth/mfa";
import { issueSession } from "@/lib/auth/session-version";
import { getDeps } from "@/lib/deps";
import { parseBody, requireAnySession, route } from "@/lib/http";

const Body = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, "6 digits") }),
  z.object({ recovery_code: z.string().min(10).max(16) }),
]);

export const POST = route(async (req: Request) => {
  const { user_id } = await requireAnySession(req);
  const body = await parseBody(Body, req);
  const { db, clock } = getDeps();
  let recovery_codes_left: number | null = null;
  if ("code" in body) await checkTotp(user_id, body.code, db, clock.now());
  else recovery_codes_left = await useRecoveryCode(user_id, body.recovery_code, db, clock.now());
  return Response.json({ ok: true, recovery_codes_left }, { headers: { "set-cookie": await issueSession(user_id, true, getDeps().db) } });
});
