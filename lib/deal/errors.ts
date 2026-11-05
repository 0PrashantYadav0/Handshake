// The code list is decisions H2, exactly; no document adds a code.
export type DealErrorCode =
  | "invalid_input" | "not_signed_in" | "not_a_party" | "deal_not_found" | "file_too_large"
  | "invalid_state" | "terms_not_accepted" | "terms_version_mismatch" | "paypal_email_required"
  | "condition_not_checkable" | "unsupported_currency" | "too_many_files" | "rate_limited" | "mandate_exceeded"
  | "internal_error" | "paypal_error" | "ai_unavailable"
  // trust spec §12
  | "mfa_required" | "totp_invalid" | "signature_invalid" | "contract_invalid" | "payout_email_unverified";

export class DealError extends Error {
  constructor(public code: DealErrorCode, message?: string, public debug_id?: string) {
    super(message ?? DEFAULT_MESSAGE[code] ?? code);
    this.name = "DealError";
  }
}

export const HTTP_STATUS: Record<DealErrorCode, number> = {
  invalid_input: 400, not_signed_in: 401, not_a_party: 403, deal_not_found: 404, file_too_large: 413,
  invalid_state: 409, terms_not_accepted: 409, terms_version_mismatch: 409, paypal_email_required: 409,
  condition_not_checkable: 422, unsupported_currency: 422, too_many_files: 422, rate_limited: 429, mandate_exceeded: 403,
  internal_error: 500, paypal_error: 502, ai_unavailable: 503,
  mfa_required: 401, totp_invalid: 400, signature_invalid: 400, contract_invalid: 409, payout_email_unverified: 409,
};

const DEFAULT_MESSAGE: Partial<Record<DealErrorCode, string>> = {
  not_signed_in: "Sign in to continue.",
  not_a_party: "You are not a party to this deal.",
  deal_not_found: "No deal with that code.",
  internal_error: "Something went wrong. Try again.",
  ai_unavailable: "The model did not answer; try again.",
  mfa_required: "Enter the code from your authenticator app to continue.",
  totp_invalid: "That code is wrong or already used.",
  signature_invalid: "The signature does not match this contract.",
  contract_invalid: "The contract no longer matches what both parties signed. No money was moved.",
  payout_email_unverified: "Verify the PayPal email where you'll be paid first.",
};
