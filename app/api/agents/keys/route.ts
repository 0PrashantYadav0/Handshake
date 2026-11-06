// GET /api/agents/keys -> the caller's agent keys; POST { label, max_usd, totp } -> a new key, its token shown once (docs/agents.md).
import { z } from "zod";
import { isDeskLabel, issueAgentKey, listAgentKeys } from "@/lib/agents/keys";
import { requireStepUp } from "@/lib/auth/mfa";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";

const Body = z.object({ label: z.string().max(60).refine((l) => !isDeskLabel(l), "That name is reserved for the live desk."), max_usd: z.number().positive().max(1000), totp: z.string().max(12) });

export const GET = route(async (req: Request) => json(await listAgentKeys((await requireSession(req)).user_id, getDeps().db)));

export const POST = route(async (req: Request) => {
  const { user_id } = await requireSession(req);
  const { label, max_usd, totp } = await parseBody(Body, req);
  const { db, clock } = getDeps();
  await requireStepUp(user_id, totp, db, clock.now());
  const { token, key } = await issueAgentKey(user_id, { label, max_amount_minor: Math.round(max_usd * 100) }, db);
  return json({ id: key.id, token }, 201);
});
