// 08 section 4.4: the H2 code -> copy mapping of lib/client-api.ts.
import { describe, expect, it } from "vitest";
import { ApiError, errorCopy } from "@/lib/client-api";

describe("errorCopy", () => {
  it("maps known codes, keeps the server message for invalid_input, generic for the rest", () => {
    expect(errorCopy(new ApiError("terms_not_accepted", ""))).toBe("Both of you must accept the current terms before payment.");
    expect(errorCopy(new ApiError("invalid_input", "email: Invalid email"))).toBe("email: Invalid email");
    expect(errorCopy(new ApiError("invalid_input", ""))).toBe("Check the highlighted fields.");
    expect(errorCopy(new ApiError("internal_error", "x"))).toBe("Something went wrong on our side. Try again.");
    expect(errorCopy(new Error("boom"))).toBe("Something went wrong on our side. Try again.");
  });
  it("paypal_error: debug id from the message when present, parenthesis dropped otherwise", () => {
    expect(errorCopy(new ApiError("paypal_error", "PayPal authorize failed: debug_id=AB12cd"))).toBe("PayPal couldn't complete that (debug id AB12cd). Try again in a moment.");
    expect(errorCopy(new ApiError("paypal_error", "PayPal did not place the hold (DENIED)"))).toBe("PayPal couldn't complete that. Try again in a moment.");
  });
});
