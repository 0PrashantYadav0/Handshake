// Browser-side fetch helper: JSON in, JSON out, every failure thrown as the H2 error shape (08 section 4.4).
import type { DealErrorCode } from "@/lib/deal/errors";

export class ApiError extends Error {
  constructor(public code: DealErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** `json` becomes the body (method defaults to POST). Network failures read as internal_error. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      cache: "no-store",
      ...rest,
      method: rest.method ?? (json === undefined ? "GET" : "POST"),
      headers: { ...(json !== undefined && { "content-type": "application/json" }), ...rest.headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  } catch {
    throw new ApiError("internal_error", "network");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: DealErrorCode; message?: string } } | null;
  if (!res.ok) throw new ApiError(data?.error?.code ?? "internal_error", data?.error?.message ?? "");
  return data as T;
}

const GENERIC = "Something went wrong on our side. Try again.";
const COPY: Partial<Record<DealErrorCode, string>> = {
  not_signed_in: "Sign in to continue.",
  not_a_party: "This deal is private.",
  deal_not_found: "No deal with that code.",
  file_too_large: "That photo is over 2 MB. Choose a smaller one.",
  invalid_state: "This deal has moved on. Showing the latest state.",
  terms_not_accepted: "Both of you must accept the current terms before payment.",
  terms_version_mismatch: "The terms changed while you were looking. Showing the latest version.",
  paypal_email_required: "Add the PayPal email where you'll be paid, then accept.",
  condition_not_checkable: "We couldn't find anything checkable in that sentence. Say what a photo or a tracking number should show, for example 'matches the listing photos' or 'tracking shows delivered'.",
  unsupported_currency: "Only US dollars are supported. Write the price as $ or USD.",
  too_many_files: "Too many photos.",
  rate_limited: "Too many questions in a row. Wait a few minutes and ask again.",
  ai_unavailable: "The model didn't answer. Try again.",
  mfa_required: "Enter the code from your authenticator app to continue.",
  totp_invalid: "That code is wrong or already used. Check your authenticator app and try the new code.",
  signature_invalid: "Your signature didn't match this version of the contract. Reload and sign again.",
  contract_invalid: "The contract no longer matches what you both signed, so no money was moved. Contact the other party and start a new deal.",
  payout_email_unverified: "Verify the PayPal email where you'll be paid, then try again.",
};

/** The 08 section 4.4 copy for a thrown ApiError; anything else reads as the generic line. */
export function errorCopy(e: unknown): string {
  if (!(e instanceof ApiError)) return GENERIC;
  if (e.code === "invalid_input") return e.message || "Check the highlighted fields.";
  if (e.code === "paypal_error") {
    const id = /debug[ _-]?id[=: ]+([A-Za-z0-9]+)/i.exec(e.message)?.[1];
    return `PayPal couldn't complete that${id ? ` (debug id ${id})` : ""}. Try again in a moment.`;
  }
  return COPY[e.code] ?? GENERIC;
}
