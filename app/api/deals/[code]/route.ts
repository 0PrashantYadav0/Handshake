// GET /api/deals/{code} -> DealView for a party, DealPreview for a signed-in non-party on a joinable draft (04 section 6.3).
import { getDeal } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const GET = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  return json(await getDeal((await params).code, actor, getDeps()));
});
