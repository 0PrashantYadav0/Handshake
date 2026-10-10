// GET /api/deals/{code}/events -> DealEvent[] ascending by id (04 section 10.1).
import { getEvents } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const GET = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  return json(await getEvents((await params).code, actor, getDeps()));
});
