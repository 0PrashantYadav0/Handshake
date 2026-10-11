// GET /api/deals/{code} -> DealView for a party, DealPreview for a signed-in non-party on a joinable draft (04 section 6.3).
import { getDeal } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";
import { DealError } from "@/lib/deal/errors";
import { allow } from "@/lib/rate-limit";

export const GET = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  if (!allow(`read:${actor.user_id}`, 120, 10 * 60_000)) throw new DealError("rate_limited", "Too many requests; try again in a few minutes.");
  return json(await getDeal((await params).code, actor, getDeps()));
});
