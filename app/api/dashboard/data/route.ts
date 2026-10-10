// GET /api/dashboard/data -> DashboardData for the caller's deals only (04 section 14). Composed from the
// module's public queries through the pure builders; no emails or names leave the server.
import { getDeal, getEvents, listDeals } from "@/lib/deal";
import { toDashboardData, type DashboardInput } from "@/lib/dashboard-rows";
import { getDeps } from "@/lib/deps";
import { json, requireSession, route } from "@/lib/http";

export const GET = route(async (req: Request) => {
  const actor = await requireSession(req);
  const deps = getDeps();
  const rows = await listDeals(actor, deps);
  // ponytail: 2N+1 queries; one SQL join only if a user ever has hundreds of deals (09 section 5.2).
  const items: DashboardInput[] = [];
  for (const row of rows) {
    const view = await getDeal(row.code, actor, deps);
    if (view.role === "preview") continue; // cannot happen for a party; keeps the type narrow
    items.push({ row, view, events: await getEvents(row.code, actor, deps) });
  }
  return json(toDashboardData(items, deps.clock.now().toISOString()));
});
