// POST /api/agents/run { scenario, step: "negotiate" | "deliver", code? } -> NDJSON stream of DeskEvent (docs/agents.md).
// Demo buyer only: the desk spends model tokens, so it is limited per account and overall.
import { z } from "zod";
import { personaOf } from "@/lib/auth/demo";
import { requireScenario, runDelivery, runToGate, type DeskEvent } from "@/lib/agents/desk";
import { DealError } from "@/lib/deal/errors";
import { getDeps } from "@/lib/deps";
import { parseBody, requireSession, route } from "@/lib/http";
import { allow } from "@/lib/rate-limit";

const Body = z.object({ scenario: z.string(), step: z.enum(["negotiate", "deliver"]), code: z.string().optional() });

export const POST = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  const body = await parseBody(Body, req);
  const scenario = requireScenario(body.scenario);
  const deps = getDeps();
  const me = await deps.db.user.findUnique({ where: { id: user_id }, select: { email: true } });
  if (process.env.DEMO_LOGIN !== "true" || personaOf(me?.email ?? "") !== "buyer") throw new DealError("invalid_input", "The agent desk runs as the Demo Buyer. Switch persona to try it.");
  if (body.step === "negotiate" && (!allow(`desk:${user_id}`, 12, 10 * 60_000) || !allow("desk:all", 60, 60 * 60_000))) throw new DealError("rate_limited", "The agents are busy; try again in a few minutes.");
  const baseUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: DeskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        if (body.step === "negotiate") await runToGate(scenario, user_id, deps, baseUrl, emit);
        else {
          if (!body.code) throw new DealError("invalid_input", "Send the deal code.");
          await runDelivery(scenario, body.code, user_id, deps, baseUrl, emit);
        }
      } catch (e) {
        if (!(e instanceof DealError)) console.error("[agent desk]", e);
        emit({ t: "error", message: e instanceof DealError ? e.message : "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store, no-transform" } });
});
