// Error mapping (H2; 02 section 3.3): the 16 codes, their statuses, the response shape, and no extra member.
import { describe, expect, it } from "vitest";
import { DealError, HTTP_STATUS, type DealErrorCode } from "@/lib/deal/errors";
import { toResponse } from "@/lib/http";

const EXPECTED: Record<DealErrorCode, number> = {
  invalid_input: 400, not_signed_in: 401, not_a_party: 403, deal_not_found: 404, file_too_large: 413,
  invalid_state: 409, terms_not_accepted: 409, terms_version_mismatch: 409, paypal_email_required: 409,
  condition_not_checkable: 422, unsupported_currency: 422, too_many_files: 422, rate_limited: 429,
  internal_error: 500, paypal_error: 502, ai_unavailable: 503,
};

describe("error mapping (H2)", () => {
  it("the code list is exactly 16 and has no other member", () => {
    expect(Object.keys(HTTP_STATUS).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.keys(HTTP_STATUS)).toHaveLength(16);
  });

  it.each(Object.entries(EXPECTED) as [DealErrorCode, number][])("%s -> %i with { error: { code, message } }", async (code, status) => {
    expect(HTTP_STATUS[code]).toBe(status);
    const res = toResponse(new DealError(code, `msg for ${code}`));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toEqual({ error: { code, message: `msg for ${code}` } });
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });

  it("paypal_error carries PayPal's debug_id in the message", async () => {
    const e = new DealError("paypal_error", "PayPal rejected the capture (debug_id 9a1b2c3d4e5f6)", "9a1b2c3d4e5f6");
    expect(e.debug_id).toBe("9a1b2c3d4e5f6");
    const body = await toResponse(e).json();
    expect(body.error.message).toContain("9a1b2c3d4e5f6");
  });

  it("ai_unavailable's default message is 'the model did not answer; try again'", () => {
    expect(new DealError("ai_unavailable").message.toLowerCase()).toBe("the model did not answer; try again.");
  });

  it("an unhandled exception maps to internal_error 500 with the fixed message", async () => {
    const spy = { error: console.error };
    console.error = () => {};
    try {
      const res = toResponse(new TypeError("boom"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "internal_error", message: "Something went wrong. Try again." } });
    } finally {
      console.error = spy.error;
    }
  });
});
