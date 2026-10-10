// POST /api/deals/{code}/join -> handle join (04 section 6.5). Empty body.
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  return json(await handle((await params).code, actor, { type: "join" }, getDeps()));
});
