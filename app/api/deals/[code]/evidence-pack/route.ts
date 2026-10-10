// GET /api/deals/{code}/evidence-pack -> EvidencePack as a JSON attachment (04 section 10.2).
import { getEvidencePack } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { requireSession, route } from "@/lib/http";

export const GET = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const pack = await getEvidencePack((await params).code, actor, getDeps());
  return Response.json(pack, { headers: { "content-disposition": `attachment; filename="handshake-${pack.deal.code}-evidence-pack.json"` } });
});
