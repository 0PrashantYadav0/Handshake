// PayPal-Request-Id builders (decisions E4; 02 section 8.1). Every key is under 38 characters.
export const orderKey = (code: string, n: number) => `order-${code}-${n}`; // n = payments.order_attempts, from 1
export const authKey = (code: string) => `auth-${code}`; // once per deal
export const voidKey = (code: string) => `void-${code}`; // at most once per deal, on the stored authorization_id
export const strayVoidKey = (authorizationId: string) => `void-${authorizationId}`; // once per stray authorization; never the stored one
export const captureKey = (code: string, n: number) => `capture-${code}-${n}`; // n = payments.capture_attempts, from 0; only a decline advances it
export const payoutBatchId = (code: string, n: number) => `payout-${code}-${n}`; // n = payouts.attempt, from 1; also sender_item_id
