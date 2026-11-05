// POST /api/jobs/tick (04 section 12; J2): Authorization: Bearer CRON_SECRET compared with timingSafeEqual; 200 TickReport.
import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/deal";
import { DealError } from "@/lib/deal/errors";
import { getDeps } from "@/lib/deps";
import { json, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const given = Buffer.from(/^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "");
  const want = Buffer.from(process.env.CRON_SECRET ?? "");
  if (want.length === 0 || given.length !== want.length || !timingSafeEqual(given, want)) throw new DealError("not_signed_in");
  const deps = getDeps();
  const now = deps.clock.now();
  const report = await tick(now, deps);
  const run = { last_run_at: now, errors: report.errors.length };
  await deps.db.jobRun.upsert({ where: { name: "tick" }, create: { name: "tick", ...run }, update: run }); // GET /api/status
  return json(report);
});
