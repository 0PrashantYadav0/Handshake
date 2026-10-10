// POST /api/deals { text } -> 201 DealView & { rejected }; GET /api/deals -> LedgerRow[] (04 sections 6.1, 6.2).
import { createDeal, listDeals } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { CreateDeal } from "@/lib/http-schemas";

export const POST = route(async (req: Request) => {
  const actor = await requireSession(req);
  const body = await parseBody(CreateDeal, req);
  return json(await createDeal(actor, body, getDeps()), 201);
});

export const GET = route(async (req: Request) => json(await listDeals(await requireSession(req), getDeps())));
