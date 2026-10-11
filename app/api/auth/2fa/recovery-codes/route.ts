// POST /api/auth/2fa/recovery-codes { totp } -> a new set of recovery codes under step-up; the old ones stop working (trust spec §4).
import { z } from "zod";
import { regenerateRecoveryCodes, requireStepUp } from "@/lib/auth/mfa";
import { getDeps } from "@/lib/deps";
import { parseBody, requireSession, route } from "@/lib/http";

const Body = z.object({ totp: z.string() });

export const POST = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  const { totp } = await parseBody(Body, req);
  const { db, clock } = getDeps();
  await requireStepUp(user_id, totp, db, clock.now());
  return Response.json({ ok: true, recovery_codes: await regenerateRecoveryCodes(user_id, db) }, { headers: { "cache-control": "no-store" } });
});
