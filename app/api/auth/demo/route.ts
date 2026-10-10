// POST /api/auth/demo { persona } -> sets hs_session for the persona; 400 unless DEMO_LOGIN=true (04 section 4.3).
import { z } from "zod";
import { signInDemoPersona } from "@/lib/auth/demo";
import { getMe } from "@/lib/auth/me";
import { sessionCookie, signSession } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";
import { parseBody, route } from "@/lib/http";

const Body = z.object({ persona: z.enum(["buyer", "seller"]) });

export const POST = route(async (req: Request) => {
  const { persona } = await parseBody(Body, req);
  const { db } = getDeps();
  const userId = await signInDemoPersona(persona, db);
  const user = await getMe(userId, db);
  return Response.json({ ok: true, user }, { headers: { "set-cookie": sessionCookie(await signSession(userId)) } });
});
