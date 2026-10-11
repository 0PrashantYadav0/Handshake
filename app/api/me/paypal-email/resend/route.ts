// POST /api/me/paypal-email/resend -> a fresh code to the unverified payout address; 3 per 10 minutes (trust spec §8).
import { resendPayoutCode } from "@/lib/auth/payout-email";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  await resendPayoutCode(user_id, getDeps());
  return json({ ok: true });
});
