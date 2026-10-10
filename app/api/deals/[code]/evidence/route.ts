// POST /api/deals/{code}/evidence { file_ids, tracking_number?, note? } -> handle submit_evidence; 200 with the final state (04 section 9.1).
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Evidence } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const body = await parseBody(Evidence, req);
  const command = { type: "submit_evidence" as const, file_ids: body.file_ids, tracking_number: body.tracking_number ?? null, note: body.note ?? null };
  return json(await handle((await params).code, actor, command, getDeps()));
});
