// In-memory PayPal (06 "Fakes"; 02 section 10): records every call, honours idempotency keys, can be told to fail.
// The get* reads (E12) answer from the maps below; tests set a status there to play PayPal moving on without a webhook.
import type { Clock } from "@/lib/clock";
import { fixedClock } from "@/lib/clock";
import type { PaypalWebhookEvent } from "@/lib/deal/types";
import { PayPalError, type AuthorizationStatus, type CaptureStatus, type PayPal, type PayoutItemStatus } from "./types";

export type PaypalOp =
  | "createAuthorizeOrder" | "authorizeOrder" | "captureAuthorization" | "voidAuthorization"
  | "createPayout" | "cancelPayoutItem" | "verifyWebhook" | "getCapture" | "getAuthorization" | "getPayoutBatch";
export type FailMode = "timeout" | "pending" | "declined" | { status: number; name: string };

export interface FakePaypal extends PayPal {
  calls: Array<{ op: PaypalOp; requestId: string | null; args: unknown }>;
  orders: Map<string, { status: "CREATED" | "APPROVED" | "COMPLETED" }>;
  authorizations: Map<string, { status: AuthorizationStatus; expiration_time?: string }>;
  captures: Map<string, { status: CaptureStatus }>;
  /** keyed by payout_batch_id; itemStatus is what getPayoutBatch reports (RETURNED once cancelled), errorName its errors.name */
  payouts: Map<string, { senderBatchId: string; itemId: string; cancelled: boolean; itemStatus: PayoutItemStatus; errorName?: string }>;
  byRequestId: Map<string, unknown>;
  authorizeStatus: "CREATED" | "PENDING" | "DENIED";
  captureStatus: "COMPLETED" | "PENDING" | "DECLINED";
  failNext(op: PaypalOp, mode: FailMode): void;
  /** The next call of `op` waits for `promise` before doing its work (dies-between tests). */
  hangUntil(op: PaypalOp, promise: Promise<unknown>): void;
  event(type: string, resource: Record<string, unknown>): PaypalWebhookEvent;
}

const TIMEOUT = () => new PayPalError(0, "timeout", null, null);
const DAY = 86_400_000;

export function fakePaypal(clock: Clock = fixedClock("2026-10-20T10:00:00Z")): FakePaypal {
  const fails = new Map<PaypalOp, FailMode>();
  const hangs = new Map<PaypalOp, Promise<unknown>>();
  const n = { order: 0, auth: 0, cap: 0, batch: 0, event: 0 };

  const takeFail = (op: PaypalOp) => {
    const m = fails.get(op);
    fails.delete(op);
    return m;
  };
  const throwIfError = (mode: FailMode | undefined) => {
    if (mode === "timeout") throw TIMEOUT();
    if (typeof mode === "object") throw new PayPalError(mode.status, mode.name, "FAKE-DEBUG", { name: mode.name });
  };
  const resolveStatus = <T extends string>(mode: FailMode | undefined, knob: T, pending: T, declined: T): T =>
    mode === "pending" ? pending : mode === "declined" ? declined : knob;

  const fake: FakePaypal = {
    calls: [],
    orders: new Map(),
    authorizations: new Map(),
    captures: new Map(),
    payouts: new Map(),
    byRequestId: new Map(),
    authorizeStatus: "CREATED",
    captureStatus: "COMPLETED",
    failNext: (op, mode) => void fails.set(op, mode),
    hangUntil: (op, promise) => void hangs.set(op, promise),

    async createAuthorizeOrder(input, requestId) {
      return run("createAuthorizeOrder", requestId, input, () => {
        throwIfError(takeFail("createAuthorizeOrder"));
        const id = `ORD-${++n.order}`;
        fake.orders.set(id, { status: "CREATED" });
        return { paypal_order_id: id };
      });
    },

    async authorizeOrder(paypal_order_id, requestId) {
      return run("authorizeOrder", requestId, { paypal_order_id }, () => {
        const mode = takeFail("authorizeOrder");
        throwIfError(mode);
        if (!fake.orders.has(paypal_order_id)) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        const status = resolveStatus(mode, fake.authorizeStatus, "PENDING", "DENIED");
        const id = `AUTH-${++n.auth}`;
        const expiration_time = expiresAt();
        fake.orders.set(paypal_order_id, { status: "COMPLETED" });
        if (status !== "DENIED") fake.authorizations.set(id, { status, expiration_time });
        return { authorization_id: id, status, expiration_time, reason: status === "PENDING" ? "PENDING_REVIEW" : null };
      });
    },

    async captureAuthorization(authorization_id, amount_minor, requestId) {
      return run("captureAuthorization", requestId, { authorization_id, amount_minor }, () => {
        const mode = takeFail("captureAuthorization");
        if (mode !== "timeout") throwIfError(mode);
        const auth = fake.authorizations.get(authorization_id);
        if (!auth) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        if (auth.status === "VOIDED") throw new PayPalError(422, "AUTHORIZATION_VOIDED", "FAKE-DEBUG", null);
        if (auth.status === "CAPTURED") throw new PayPalError(422, "AUTHORIZATION_ALREADY_CAPTURED", "FAKE-DEBUG", null);
        const status = resolveStatus(mode, fake.captureStatus, "PENDING", "DECLINED");
        const id = `CAP-${++n.cap}`;
        fake.captures.set(id, { status });
        if (status !== "DECLINED") auth.status = "CAPTURED";
        const result = { capture_id: id, status, reason: status === "COMPLETED" ? null : status === "PENDING" ? "PENDING_REVIEW" : "DECLINED" };
        if (mode === "timeout") {
          fake.byRequestId.set(requestId, result); // PayPal did it, we never heard
          throw TIMEOUT();
        }
        return result;
      });
    },

    async voidAuthorization(authorization_id, requestId) {
      return run("voidAuthorization", requestId, { authorization_id }, () => {
        const mode = takeFail("voidAuthorization");
        const auth = fake.authorizations.get(authorization_id);
        if (typeof mode === "object" && mode.name === "PREVIOUSLY_VOIDED") {
          if (auth) auth.status = "VOIDED";
          return;
        }
        throwIfError(mode);
        if (!auth) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        if (auth.status === "CAPTURED") throw new PayPalError(422, "AUTHORIZATION_ALREADY_CAPTURED", "FAKE-DEBUG", null);
        auth.status = "VOIDED";
      });
    },

    async createPayout(input, requestId) {
      return run("createPayout", requestId, input, () => {
        throwIfError(takeFail("createPayout"));
        for (const [id, p] of fake.payouts) if (p.senderBatchId === input.sender_batch_id) return { payout_batch_id: id, batch_status: "PENDING" as const };
        const id = `BATCH-${++n.batch}`;
        fake.payouts.set(id, { senderBatchId: input.sender_batch_id, itemId: `ITEM-${n.batch}`, cancelled: false, itemStatus: "PENDING" });
        return { payout_batch_id: id, batch_status: "PENDING" as const };
      });
    },

    async cancelPayoutItem(payout_item_id) {
      return run("cancelPayoutItem", null, { payout_item_id }, () => {
        throwIfError(takeFail("cancelPayoutItem"));
        const item = [...fake.payouts.values()].find((p) => p.itemId === payout_item_id);
        if (!item) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        item.cancelled = true;
      });
    },

    async getCapture(capture_id) {
      return run("getCapture", null, { capture_id }, () => {
        throwIfError(takeFail("getCapture"));
        const c = fake.captures.get(capture_id);
        if (!c) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        return { capture_id, status: c.status, reason: c.status === "COMPLETED" ? null : c.status === "PENDING" ? "PENDING_REVIEW" : c.status };
      });
    },

    async getAuthorization(authorization_id) {
      return run("getAuthorization", null, { authorization_id }, () => {
        throwIfError(takeFail("getAuthorization"));
        const a = fake.authorizations.get(authorization_id);
        if (!a) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        return { authorization_id, status: a.status, expiration_time: a.expiration_time ?? expiresAt(), reason: a.status === "PENDING" ? "PENDING_REVIEW" : null };
      });
    },

    async getPayoutBatch(payout_batch_id) {
      return run("getPayoutBatch", null, { payout_batch_id }, () => {
        throwIfError(takeFail("getPayoutBatch"));
        const b = fake.payouts.get(payout_batch_id);
        if (!b) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "FAKE-DEBUG", null);
        const transaction_status = b.cancelled ? "RETURNED" : b.itemStatus;
        return {
          payout_batch_id,
          batch_status: transaction_status === "PENDING" ? "PENDING" : "SUCCESS",
          items: [{ payout_item_id: b.itemId, sender_item_id: b.senderBatchId, transaction_status, error_name: b.errorName ?? null }],
        };
      });
    },

    async verifyWebhook(rawBody, headers) {
      return run("verifyWebhook", null, { rawBody, headers }, () => ({
        result: takeFail("verifyWebhook") ? ("unverified" as const) : ("verified" as const),
        webhook_id: "WEBHOOK_ID",
      }));
    },

    event(type, resource) {
      const id = `WH-${++n.event}`;
      const resource_type = type.startsWith("CHECKOUT.") ? "checkout-order" : type.split(".")[1]!.toLowerCase().replace("-", "_");
      const body = { id, event_type: type, create_time: clock.now().toISOString(), resource_type, resource };
      return { ...body, verified: true, body };
    },
  };

  function expiresAt(): string {
    return new Date(clock.now().getTime() + 29 * DAY).toISOString().replace(".000Z", "Z");
  }

  async function run<T>(op: PaypalOp, requestId: string | null, args: unknown, work: () => T): Promise<T> {
    fake.calls.push({ op, requestId, args });
    const hang = hangs.get(op);
    if (hang) {
      hangs.delete(op);
      await hang;
    }
    if (requestId !== null && fake.byRequestId.has(requestId)) return fake.byRequestId.get(requestId) as T;
    const result = work();
    if (requestId !== null) fake.byRequestId.set(requestId, result);
    return result;
  }

  return fake;
}
