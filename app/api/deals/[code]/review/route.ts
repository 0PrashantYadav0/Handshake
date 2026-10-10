// POST /api/deals/{code}/review { decision, note? } -> handle review (04 section 9.2).
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Review } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const { decision, note } = await parseBody(Review, req);
  return json(await handle((await params).code, actor, { type: "review", decision, note: note ?? null }, getDeps()));
});
