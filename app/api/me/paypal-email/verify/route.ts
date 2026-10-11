// POST /api/me/paypal-email/verify { code } -> marks the payout address verified (trust spec §8).
import { z } from "zod";
import { getMe } from "@/lib/auth/me";
import { verifyPayoutEmail } from "@/lib/auth/payout-email";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";

const Body = z.object({ code: z.string().max(12) });

export const POST = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  const { code } = await parseBody(Body, req);
  const deps = getDeps();
  await verifyPayoutEmail(user_id, code.replace(/\s/g, ""), deps);
  return json({ user: await getMe(user_id, deps.db) });
});
