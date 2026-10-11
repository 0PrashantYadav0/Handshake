// POST /api/deals/{code}/accept { terms_version, contract_hash, signature, public_key, totp } -> handle accept (04 section 6.6).
// Trust spec §6: accepting is signing; the authenticator code (step-up) is checked first and used once.
import { requireStepUp } from "@/lib/auth/mfa";
import { handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Accept } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const { totp, ...sig } = await parseBody(Accept, req);
  const deps = getDeps();
  await requireStepUp(actor.user_id, totp, deps.db, deps.clock.now());
  const label = req.headers.get("user-agent")?.slice(0, 120) ?? null;
  return json(await handle((await params).code, actor, { type: "accept", ...sig, key_label: label }, deps));
});
