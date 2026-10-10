// GET /api/me -> { user: Me }; PATCH /api/me { display_name?, paypal_email? } -> { user: Me } (04 section 5).
import { z } from "zod";
import { getMe } from "@/lib/auth/me";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";

const Patch = z
  .object({ display_name: z.string().min(1).max(60).optional(), paypal_email: z.email({ pattern: z.regexes.html5Email }).optional() })
  .refine((b) => b.display_name !== undefined || b.paypal_email !== undefined, "Send display_name or paypal_email.");

export const GET = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  return json({ user: await getMe(user_id, getDeps().db) });
});

export const PATCH = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  const data = await parseBody(Patch, req);
  const { db } = getDeps();
  await db.user.update({ where: { id: user_id }, data });
  return json({ user: await getMe(user_id, db) });
});
