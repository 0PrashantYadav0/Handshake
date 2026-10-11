// POST /api/deals/{code}/accept { terms_version, contract_hash, signature, public_key, totp } -> handle accept (04 section 6.6).
// Trust spec §6: accepting is signing; the authenticator code (step-up) is checked first and used once.
import { requireStepUp } from "@/lib/auth/mfa";
import { DealError, getDeal, handle } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { json, parseBody, requireSession, route } from "@/lib/http";
import { Accept } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const { totp, ...sig } = await parseBody(Accept, req);
  const deps = getDeps();
  const code = (await params).code;
  // Cheap checks before the step-up code is spent (review note): a stale page should not cost the user a code.
  const view = await getDeal(code, actor, deps);
  if (view.role === "preview") throw new DealError("not_a_party");
  if (view.terms_version !== sig.terms_version) throw new DealError("terms_version_mismatch", `The terms changed; reload to see version ${view.terms_version}.`);
  if (view.contract && view.contract.hash !== sig.contract_hash) throw new DealError("signature_invalid", "The contract changed while you were signing. Reload and sign the current version.");
  await requireStepUp(actor.user_id, totp, deps.db, deps.clock.now());
  const label = req.headers.get("user-agent")?.slice(0, 120) ?? null;
  return json(await handle(code, actor, { type: "accept", ...sig, key_label: label }, deps));
});
