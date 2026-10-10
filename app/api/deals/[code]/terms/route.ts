// PATCH /api/deals/{code}/terms -> handle edit_terms (04 section 6.4). Fields left out keep their current value.
import { getDeal, handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Terms } from "@/lib/http-schemas";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const body = await parseBody(Terms, req);
  const { code } = await params;
  const deps = getDeps();
  const cur = await getDeal(code, actor, deps);
  const view = await handle(code, actor, {
    type: "edit_terms",
    item_title: body.item_title ?? cur.item_title,
    amount_minor: body.amount_minor ?? cur.amount_minor,
    deadline_days: body.deadline_days ?? cur.deadline_days,
    conditions: body.conditions ?? cur.conditions.filter((c) => !c.system).map(({ text, evidence_type }) => ({ text, evidence_type })),
  }, deps);
  return json(view);
});
