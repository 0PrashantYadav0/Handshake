// POST /api/auth/demo { persona } -> a partial hs_session for the persona; the client goes on to /signin/2fa (trust spec §4).
// 400 unless DEMO_LOGIN=true (04 section 4.3).
import { z } from "zod";
import { signInDemoPersona } from "@/lib/auth/demo";
import { getMe } from "@/lib/auth/me";
import { issueSession } from "@/lib/auth/session-version";
import { getDeps } from "@/lib/deps";
import { parseBody, route } from "@/lib/http";

const Body = z.object({ persona: z.enum(["buyer", "seller"]) });

export const POST = route(async (req: Request) => {
  const { persona } = await parseBody(Body, req);
  const { db } = getDeps();
  const userId = await signInDemoPersona(persona, db, getDeps().clock.now());
  const user = await getMe(userId, db);
  return Response.json({ ok: true, user, mfa: "required" }, { headers: { "set-cookie": await issueSession(userId, false, getDeps().db) } });
});
