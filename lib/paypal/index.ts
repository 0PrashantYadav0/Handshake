// Real PayPal adapter (E1; 02 section 3.4). SDK for Orders and Payments, raw fetch for Payouts (the SDK has neither
// Payouts nor webhook verification, dependencies.md trap 18), lib/paypal/verify.ts for webhooks. Every write sends
// the given key as PayPal-Request-Id. Responses are parsed from the wire JSON (SDK `body` is the raw text) by the pure
// helpers below so the fixtures in tests/fixtures/paypal are what the adapter actually reads.
import {
  ApiError, CheckoutPaymentIntent, Client, Environment, OrdersController, PaymentsController,
  PaypalExperienceUserAction, PaypalWalletContextShippingPreference,
} from "@paypal/paypal-server-sdk";
import { toPaypalValue } from "@/lib/money";
import { getToken } from "./token";
import { verifyWebhook } from "./verify";
import { PayPalError, type AuthorizationStatus, type CaptureStatus, type PayPal, type PayoutBatchStatus } from "./types";

export * from "./types";

// Wire shapes (snake_case), only the fields we read.
type Link = { rel?: string; href?: string };
type ErrorBody = { name?: string; debug_id?: string; message?: string; details?: Array<{ issue?: string }>; links?: Link[] } | null;
type AuthorizationBody = { id?: string; status?: AuthorizationStatus; status_details?: { reason?: string }; expiration_time?: string };
type OrderAuthorizeBody = { purchase_units?: Array<{ payments?: { authorizations?: AuthorizationBody[] } }> };
type CaptureBody = { id?: string; status?: CaptureStatus; status_details?: { reason?: string } };
type PayoutBody = { batch_header?: { payout_batch_id?: string; batch_status?: PayoutBatchStatus } };

export function parseJson<T>(text: unknown): T | null {
  if (typeof text !== "string") return (text ?? null) as T | null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export function parseAuthorization(body: OrderAuthorizeBody) {
  const a = body.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!a?.id || !a.status || !a.expiration_time) throw new PayPalError(200, "NO_AUTHORIZATION", null, body);
  return { authorization_id: a.id, status: a.status, expiration_time: a.expiration_time, reason: a.status === "PENDING" ? (a.status_details?.reason ?? null) : null };
}

export function parseCapture(body: CaptureBody) {
  if (!body.id || !body.status) throw new PayPalError(200, "NO_CAPTURE", null, body);
  return { capture_id: body.id, status: body.status, reason: body.status === "COMPLETED" ? null : (body.status_details?.reason ?? null) };
}

export function parsePayout(body: PayoutBody) {
  const h = body.batch_header;
  if (!h?.payout_batch_id || !h.batch_status) throw new PayPalError(200, "NO_PAYOUT_BATCH", null, body);
  return { payout_batch_id: h.payout_batch_id, batch_status: h.batch_status };
}

const isTimeout = (e: { code?: unknown; name?: unknown; message?: unknown }) =>
  e.code === "ECONNABORTED" || e.code === "ETIMEDOUT" || e.name === "TimeoutError" || /timeout/i.test(String(e.message ?? ""));

/** PayPal 4xx bodies carry the generic `name` (UNPROCESSABLE_ENTITY) and the useful code in `details[0].issue`
 *  (PREVIOUSLY_VOIDED, AUTHORIZATION_VOIDED, ORDER_ALREADY_AUTHORIZED): name_ is the issue when present, else name. */
export const errorName = (body: ErrorBody) => body?.details?.[0]?.issue ?? body?.name ?? null;

/** SDK ApiError -> PayPalError(statusCode, name, body.debug_id, body); timeout -> PayPalError(0, "timeout", null, null). */
export function toPayPalError(err: unknown): PayPalError {
  if (err instanceof PayPalError) return err;
  if (err instanceof ApiError) {
    const body = parseJson<ErrorBody>(err.body);
    return new PayPalError(err.statusCode, errorName(body), body?.debug_id ?? err.headers?.["paypal-debug-id"] ?? null, body ?? err.body);
  }
  const e = (typeof err === "object" && err) || {};
  if (isTimeout(e)) return new PayPalError(0, "timeout", null, null);
  return new PayPalError(0, "network", null, null);
}

export function realPaypal(env: NodeJS.ProcessEnv = process.env): PayPal {
  const base = (env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: env.PAYPAL_CLIENT_ID ?? "", oAuthClientSecret: env.PAYPAL_CLIENT_SECRET ?? "" },
    environment: base.includes("sandbox") ? Environment.Sandbox : Environment.Production,
    timeout: 10_000,
  });
  const orders = new OrdersController(client);
  const payments = new PaymentsController(client);

  // Never log the bearer or the body: one line with method, status, name and debug_id (06 "Security checks").
  async function call<T>(method: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const e = toPayPalError(err);
      console.error(`paypal ${method} failed status=${e.status} name=${e.name_} debug_id=${e.debug_id}`);
      throw e;
    }
  }

  // Raw fetch for the Payouts endpoints. Returns the parsed body on 2xx, throws PayPalError otherwise.
  async function raw<T>(method: "GET" | "POST", url: string, body?: unknown, requestId?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await getToken(env)}`, "Content-Type": "application/json" };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const json = parseJson<T & ErrorBody>(await res.text());
    if (res.ok) return json as T;
    const e = json as ErrorBody;
    throw new PayPalError(res.status, errorName(e), e?.debug_id ?? res.headers.get("paypal-debug-id"), json);
  }

  return {
    createAuthorizeOrder: ({ code, amount_minor, description }, requestId) =>
      call("createAuthorizeOrder", async () => {
        const res = await orders.createOrder({
          paypalRequestId: requestId,
          body: {
            intent: CheckoutPaymentIntent.Authorize,
            purchaseUnits: [{ customId: code, description: description.slice(0, 127), amount: { currencyCode: "USD", value: toPaypalValue(amount_minor) } }],
            paymentSource: { paypal: { experienceContext: {
              brandName: "Handshake",
              userAction: PaypalExperienceUserAction.PayNow,
              shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
              ...(env.APP_URL ? { returnUrl: `${env.APP_URL}/deals/${code}?pp=return`, cancelUrl: `${env.APP_URL}/deals/${code}?pp=cancel` } : {}),
            } } },
          },
        });
        const id = parseJson<{ id?: string }>(res.body)?.id ?? res.result.id;
        if (!id) throw new PayPalError(res.statusCode, "NO_ORDER_ID", null, null);
        return { paypal_order_id: id };
      }),

    authorizeOrder: (paypal_order_id, requestId) =>
      call("authorizeOrder", async () => {
        const res = await orders.authorizeOrder({ id: paypal_order_id, paypalRequestId: requestId, prefer: "return=representation", body: {} });
        return parseAuthorization(parseJson<OrderAuthorizeBody>(res.body) ?? {});
      }),

    captureAuthorization: (authorization_id, amount_minor, requestId) =>
      call("captureAuthorization", async () => {
        const res = await payments.captureAuthorizedPayment({
          authorizationId: authorization_id, paypalRequestId: requestId, prefer: "return=representation",
          body: { amount: { currencyCode: "USD", value: toPaypalValue(amount_minor) }, finalCapture: true },
        });
        return parseCapture(parseJson<CaptureBody>(res.body) ?? {});
      }),

    voidAuthorization: (authorization_id, requestId) =>
      call("voidAuthorization", async () => {
        try {
          await payments.voidPayment({ authorizationId: authorization_id, paypalRequestId: requestId });
        } catch (err) {
          if (toPayPalError(err).name_ !== "PREVIOUSLY_VOIDED") throw err; // C4: already voided is success
        }
      }),

    createPayout: ({ sender_batch_id, sender_item_id, receiver, amount_minor, note }, requestId) =>
      call("createPayout", async () => {
        const body = {
          sender_batch_header: { sender_batch_id, email_subject: "You have a payout from Handshake" },
          items: [{ recipient_type: "EMAIL", receiver, amount: { value: toPaypalValue(amount_minor), currency: "USD" }, note, sender_item_id }],
        };
        try {
          return parsePayout(await raw<PayoutBody>("POST", `${base}/v1/payments/payouts`, body, requestId));
        } catch (err) {
          // A sender_batch_id used in the last 30 days is rejected with a HATEOAS link to the original batch: follow it.
          const links = err instanceof PayPalError ? (err.body as ErrorBody)?.links : undefined;
          const original = links?.find((l) => l.href?.startsWith(`${base}/v1/payments/payouts/`))?.href;
          if (!original) throw err;
          return parsePayout(await raw<PayoutBody>("GET", original));
        }
      }),

    cancelPayoutItem: (payout_item_id) =>
      call("cancelPayoutItem", async () => {
        try {
          await raw("POST", `${base}/v1/payments/payouts-item/${encodeURIComponent(payout_item_id)}/cancel`);
        } catch (err) {
          if (!(err instanceof PayPalError) || !/ALREADY_CANCEL|RETURNED/.test(err.name_ ?? "")) throw err; // already cancelled or returned is success
        }
      }),

    verifyWebhook,
  };
}
