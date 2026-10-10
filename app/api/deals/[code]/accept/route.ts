// POST /api/deals/{code}/accept { terms_version } -> handle accept (04 section 6.6).
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Accept } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const { terms_version } = await parseBody(Accept, req);
  return json(await handle((await params).code, actor, { type: "accept", terms_version }, getDeps()));
});
