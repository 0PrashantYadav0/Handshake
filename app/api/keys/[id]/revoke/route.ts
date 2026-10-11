// POST /api/keys/{id}/revoke { totp } -> the key can no longer sign (trust spec §6). Step-up required.
import { z } from "zod";
import { revokeKey, listKeys } from "@/lib/auth/keys";
import { requireStepUp } from "@/lib/auth/mfa";
import { DealError } from "@/lib/deal/errors";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";

const Body = z.object({ totp: z.string().max(12) });

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user_id } = await requireSession(req);
  const { totp } = await parseBody(Body, req);
  const { id } = await params;
  const { db, clock } = getDeps();
  if (!z.uuid().safeParse(id).success) throw new DealError("invalid_input", "Bad key id.");
  await requireStepUp(user_id, totp, db, clock.now());
  await revokeKey(user_id, id, db, clock.now());
  return json({ keys: await listKeys(user_id, db) });
});
