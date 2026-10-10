// POST /api/deals/{code}/payment/authorize { order_id } -> handle confirm_approval (04 section 7.2).
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Authorize } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const { order_id } = await parseBody(Authorize, req);
  return json(await handle((await params).code, actor, { type: "confirm_approval", order_id }, getDeps()));
});
