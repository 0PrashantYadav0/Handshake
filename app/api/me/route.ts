// GET /api/me -> { user: Me }; PATCH /api/me { display_name?, paypal_email?, totp? } -> { user: Me } (04 section 5).
// A new paypal_email needs step-up (totp) and is unverified until the emailed code comes back (trust spec §8).
import { z } from "zod";
import { getMe } from "@/lib/auth/me";
import { setPayoutEmail } from "@/lib/auth/payout-email";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";

const Patch = z
  .object({
    display_name: z.string().min(1).max(60).optional(),
    paypal_email: z.email({ pattern: z.regexes.html5Email }).max(254).optional(),
    totp: z.string().max(12).optional(),
  })
  .refine((b) => b.display_name !== undefined || b.paypal_email !== undefined, "Send display_name or paypal_email.");

export const GET = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  return json({ user: await getMe(user_id, getDeps().db) });
});

export const PATCH = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  const { display_name, paypal_email, totp } = await parseBody(Patch, req);
  const deps = getDeps();
  if (paypal_email !== undefined) await setPayoutEmail(user_id, paypal_email, totp, deps);
  if (display_name !== undefined) await deps.db.user.update({ where: { id: user_id }, data: { display_name } });
  return json({ user: await getMe(user_id, deps.db) });
});
