// POST /api/webhooks/paypal (E6; 02 sections 6.8, 9.4; 04 section 11): verify the raw text before parsing, store once,
// process in the request. fetch_failed -> 500 and nothing stored; non-JSON -> 400 and nothing stored; unverified -> 400
// with the row stored verified = false until the bucket below is spent; a processing throw -> 500 with processed_at still
// null so PayPal redelivers.
import { applyPaypalEvent } from "@/lib/deal";
import { DealError } from "@/lib/deal/errors";
import { getDeps } from "@/lib/deps";
import { json, readCapped, route } from "@/lib/http";
import { allow } from "@/lib/rate-limit";

const HEADERS = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"];
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const POST = route(async (req: Request) => {
  const deps = getDeps();
  const capped = await readCapped(req, 64 * 1024);
  if (!capped) throw new DealError("invalid_input", "Body too large.");
  const raw = await capped.text();
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
  // Anyone can post here. With the tick's 7-day purge this bounds bad-signature rows at about 1.3 GB of the 5 GB disk (64 KB a row).
  if (result === "unverified" && !allow("webhook-unverified", 20, 10 * 60_000)) throw new DealError("invalid_input", "Signature verification failed.");
  const { outcome } = await applyPaypalEvent(event, deps);
  if (outcome === "unverified") throw new DealError("invalid_input", "Signature verification failed.");
  return json({ ok: true, outcome });
});
