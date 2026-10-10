// POST /api/deals/{code}/payment -> handle start_payment; answers { order_id } (04 section 7.1).
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const view = await handle((await params).code, actor, { type: "start_payment" }, getDeps());
  return json({ order_id: view.payment!.paypal_order_id });
});
