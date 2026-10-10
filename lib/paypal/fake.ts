// In-memory PayPal (06 "Fakes"; 02 section 10): records every call, honours idempotency keys, can be told to fail.
import type { Clock } from "@/lib/clock";
import { fixedClock } from "@/lib/clock";
import type { PaypalWebhookEvent } from "@/lib/deal/types";
import { PayPalError, type PayPal } from "./types";

export type PaypalOp =
  | "createAuthorizeOrder" | "authorizeOrder" | "captureAuthorization" | "voidAuthorization"
  | "createPayout" | "cancelPayoutItem" | "verifyWebhook";
export type FailMode = "timeout" | "pending" | "declined" | { status: number; name: string };

export interface FakePaypal extends PayPal {
  calls: Array<{ op: PaypalOp; requestId: string | null; args: unknown }>;
  orders: Map<string, { status: "CREATED" | "APPROVED" | "COMPLETED" }>;
  authorizations: Map<string, { status: "CREATED" | "CAPTURED" | "VOIDED" }>;
  captures: Map<string, { status: "COMPLETED" | "PENDING" | "DECLINED" }>;
  payouts: Map<string, { senderBatchId: string; itemId: string; cancelled: boolean }>;
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
        fake.orders.set(paypal_order_id, { status: "COMPLETED" });
        if (status !== "DENIED") fake.authorizations.set(id, { status: "CREATED" });
        return {
          authorization_id: id,
          status,
          expiration_time: new Date(clock.now().getTime() + 29 * DAY).toISOString().replace(".000Z", "Z"),
          reason: status === "PENDING" ? "PENDING_REVIEW" : null,
        };
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
        fake.payouts.set(id, { senderBatchId: input.sender_batch_id, itemId: `ITEM-${n.batch}`, cancelled: false });
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
