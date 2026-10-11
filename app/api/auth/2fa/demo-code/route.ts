// GET /api/auth/2fa/demo-code -> the demo persona's current code; only with DEMO_LOGIN=true and only for the two personas (trust spec §4).
import { demoCode } from "@/lib/auth/demo";
import { getDeps } from "@/lib/deps";
import { json, requireAnySession, route } from "@/lib/http";

export const GET = route(async (req: Request) => {
  const { user_id } = await requireAnySession(req);
  const { db, clock } = getDeps();
  return json(await demoCode(user_id, db, clock.now()));
});
