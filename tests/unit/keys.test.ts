// Idempotency keys (E4; 02 section 8.1).
import { describe, expect, it } from "vitest";
import { authKey, captureKey, orderKey, payoutBatchId, strayVoidKey, voidKey } from "@/lib/deal/keys";

const code = "HS-7K2Q";

describe("idempotency keys", () => {
  it("orderKey(code, 1) is order-HS-7K2Q-1 (15 characters); the second order is order-HS-7K2Q-2", () => {
    expect(orderKey(code, 1)).toBe("order-HS-7K2Q-1");
    expect(orderKey(code, 1)).toHaveLength(15);
    expect(orderKey(code, 2)).toBe("order-HS-7K2Q-2");
  });
  it("authKey is auth-HS-7K2Q (once per deal)", () => expect(authKey(code)).toBe("auth-HS-7K2Q"));
  it("voidKey is void-HS-7K2Q (at most once per deal, on the stored authorization_id)", () => expect(voidKey(code)).toBe("void-HS-7K2Q"));
  it("strayVoidKey('0VF52814937998046') is void-0VF52814937998046 (22 characters)", () => {
    expect(strayVoidKey("0VF52814937998046")).toBe("void-0VF52814937998046");
    expect(strayVoidKey("0VF52814937998046")).toHaveLength(22);
  });
  it("voidKey and strayVoidKey never collide for the same deal", () => {
    expect(strayVoidKey("0VF52814937998046")).not.toBe(voidKey(code));
    expect(strayVoidKey("AUTH-2")).not.toBe(voidKey(code));
  });
  it("captureKey(code, 0) is capture-HS-7K2Q-0; one decline -> capture-HS-7K2Q-1; a timeout, 5xx or crash keeps capture-HS-7K2Q-0", () => {
    expect(captureKey(code, 0)).toBe("capture-HS-7K2Q-0");
    expect(captureKey(code, 1)).toBe("capture-HS-7K2Q-1"); // capture_attempts advanced by fact:capture_declined
    expect(captureKey(code, 0)).toBe("capture-HS-7K2Q-0"); // no decline: same n
  });
  it("payoutBatchId(code, 1) is payout-HS-7K2Q-1", () => expect(payoutBatchId(code, 1)).toBe("payout-HS-7K2Q-1"));
  it("every builder with n = 99 is at most 38 characters", () => {
    for (const k of [orderKey(code, 99), authKey(code), voidKey(code), strayVoidKey("0VF52814937998046"), captureKey(code, 99), payoutBatchId(code, 99)]) {
      expect(k.length).toBeLessThanOrEqual(38);
    }
  });
});
