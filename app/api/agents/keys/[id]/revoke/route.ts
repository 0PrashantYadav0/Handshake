// POST /api/agents/keys/{id}/revoke -> the agent's token stops working at once, so it can't sign anything new (docs/agents.md).
import { z } from "zod";
import { revokeAgentKey } from "@/lib/agents/keys";
import { DealError } from "@/lib/deal/errors";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user_id } = await requireSession(req);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new DealError("invalid_input", "Bad key id.");
  const { db, clock } = getDeps();
  await revokeAgentKey(user_id, id, db, clock.now());
  return json({ ok: true });
});
