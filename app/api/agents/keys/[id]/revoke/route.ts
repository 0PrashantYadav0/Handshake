// POST /api/agents/keys/{id}/revoke -> the agent's token and signing key stop working at once (docs/agents.md).
import { revokeAgentKey } from "@/lib/agents/keys";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { user_id } = await requireSession(req);
  const { db, clock } = getDeps();
  await revokeAgentKey(user_id, (await params).id, db, clock.now());
  return json({ ok: true });
});
