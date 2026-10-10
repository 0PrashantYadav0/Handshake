// POST /api/studio/agent (04 section 15; 09 section 6.3): session -> per-user limiter -> Zod -> one Claude turn.
// The only endpoint that answers rate_limited 429 (H2). The cookie is read from the request, so it runs under Vitest.
export const runtime = "nodejs";
import { claude } from "@/lib/ai/client";
import { DealError } from "@/lib/deal/errors";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { AgentBody, allowTurn, runAgentTurn } from "@/lib/studio-agent";

export const POST = route(async (req: Request) => {
  const actor = await requireSession(req);
  if (!allowTurn(actor.user_id)) throw new DealError("rate_limited", "Too many questions in a row. Wait a few minutes and ask again.");
  const body = await parseBody(AgentBody, req);
  // claude() is called inside the turn: with no ANTHROPIC_API_KEY the SDK throws and the panel shows "failed".
  return json(await runAgentTurn(claude, body, req.signal));
});
