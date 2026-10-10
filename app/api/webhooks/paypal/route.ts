// POST /api/webhooks/paypal (E6; 02 sections 6.8, 9.4; 04 section 11): verify the raw text before parsing, store once,
// process in the request. fetch_failed -> 500 and nothing stored; non-JSON -> 400 and nothing stored; unverified -> 400
// with the row stored verified = false; a processing throw -> 500 with processed_at still null so PayPal redelivers.
import { applyPaypalEvent } from "@/lib/deal";
import { DealError } from "@/lib/deal/errors";
import { getDeps } from "@/lib/deps";
import { json, route } from "@/lib/http";

const HEADERS = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"];
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const POST = route(async (req: Request) => {
  const deps = getDeps();
  if (Number(req.headers.get("content-length")) > 64 * 1024) throw new DealError("invalid_input", "Body too large.");
  const raw = await req.text();
  const headers = Object.fromEntries(HEADERS.map((h) => [h, req.headers.get(h)]));
  const { result } = await deps.paypal.verifyWebhook(raw, headers);
  if (result === "fetch_failed") throw new DealError("internal_error", "Certificate fetch failed.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new DealError("invalid_input", "Body must be JSON.");
  }
  const b = obj(body);
  if (!str(b.id) || !str(b.event_type)) throw new DealError("invalid_input", "Body must be a PayPal event.");

  const event = {
    id: b.id, event_type: b.event_type, create_time: str(b.create_time) ? b.create_time : "", resource_type: str(b.resource_type) ? b.resource_type : "",
    resource: obj(b.resource), verified: result === "verified", body,
  };
  const { outcome } = await applyPaypalEvent(event, deps);
  if (outcome === "unverified") throw new DealError("invalid_input", "Signature verification failed.");
  return json({ ok: true, outcome });
});
