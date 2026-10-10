// The PayPal port (02 section 3.4). Seven methods (E1). Every write sends the given idempotency key as
// PayPal-Request-Id and throws PayPalError on any non-2xx except the cases named on the method.
export type AuthorizationStatus = "CREATED" | "PENDING" | "DENIED" | "CAPTURED" | "PARTIALLY_CAPTURED" | "VOIDED";
export type CaptureStatus = "COMPLETED" | "PENDING" | "DECLINED" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";
export type PayoutBatchStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";

export interface PayPal {
  createAuthorizeOrder(
    input: { code: string; amount_minor: number; description: string }, // custom_id = code (E2); one purchase unit
    requestId: string, // order-{code}-{n}
  ): Promise<{ paypal_order_id: string }>;

  authorizeOrder(
    paypal_order_id: string,
    requestId: string, // auth-{code}
  ): Promise<{ authorization_id: string; status: AuthorizationStatus; expiration_time: string; reason: string | null }>;

  captureAuthorization(
    authorization_id: string, // always the original (E3)
    amount_minor: number, // sent explicitly, with final_capture: true
    requestId: string, // capture-{code}-{n}
  ): Promise<{ capture_id: string; status: CaptureStatus; reason: string | null }>;

  /** PREVIOUSLY_VOIDED resolves as success (C4). A refusal because the authorization is captured throws PayPalError 422. */
  voidAuthorization(authorization_id: string, requestId: string): Promise<void>; // void-{code} or void-{authorization_id}

  /** Raw fetch POST /v1/payments/payouts. A duplicate sender_batch_id resolves as the original batch (02 section 3.4). */
  createPayout(
    input: { sender_batch_id: string; sender_item_id: string; receiver: string; amount_minor: number; note: string },
    requestId: string, // payout-{code}-{n}, equal to sender_batch_id
  ): Promise<{ payout_batch_id: string; batch_status: PayoutBatchStatus }>;

  /** Raw fetch POST /v1/payments/payouts-item/{id}/cancel (E1, E7). Already cancelled or returned resolves as success. */
  cancelPayoutItem(payout_item_id: string): Promise<void>;

  /** E6 self-verification (02 section 9.4). Never throws; a cert that cannot be fetched is reported as fetch_failed. */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | null>,
  ): Promise<{ result: "verified" | "unverified" | "fetch_failed"; webhook_id: string | null }>;
}

export class PayPalError extends Error {
  constructor(
    public status: number,
    public name_: string | null,
    public debug_id: string | null,
    public body: unknown,
  ) {
    super(name_ ?? `paypal_${status}`);
    this.name = "PayPalError";
  }
}
