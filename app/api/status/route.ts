// GET /api/status: public, no secrets. When the background job last ran and whether PayPal's webhooks are arriving verified.
import { getDeps } from "@/lib/deps";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const { db, clock } = getDeps();
  const now = clock.now();
  const [tick, verified, unverified, last] = await Promise.all([
    db.jobRun.findUnique({ where: { name: "tick" } }),
    db.webhookEvent.count({ where: { verified: true } }),
    db.webhookEvent.count({ where: { verified: false } }),
    db.webhookEvent.findFirst({ where: { verified: true }, orderBy: { created_at: "desc" }, select: { created_at: true, event_type: true } }),
  ]);
  return json({
    now,
    tick: tick ? { last_run_at: tick.last_run_at, minutes_ago: Math.round((now.getTime() - tick.last_run_at.getTime()) / 60_000), errors_last_run: tick.errors } : null,
    webhooks: { verified, unverified, last_verified_at: last?.created_at ?? null, last_verified_type: last?.event_type ?? null },
  });
});
