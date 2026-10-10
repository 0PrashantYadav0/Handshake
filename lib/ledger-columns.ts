// Pure formatters for the /ledger grid (08 section 8). No React, no AG Grid: unit-tested in tests/unit/ledger-columns.test.ts.
import { formatUsd } from "@/lib/money";

export const money = (minor: number | null | undefined) => (minor == null ? "—" : formatUsd(minor));
export const pct = (c: number | null | undefined) => (c == null ? "—" : `${Math.round(c * 100)}%`);
export const roleLabel = (role: "buyer" | "seller") => (role === "buyer" ? "Buyer" : "Seller");

/** "29 Oct 2026, 14:05" in the viewer's local time (08 section 2). */
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
/** "2 hours ago" / "in 12 days"; "just now" under a minute. */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const sec = (new Date(iso).getTime() - now) / 1000;
  const unit = UNITS.find(([, s]) => Math.abs(sec) >= s);
  if (!unit) return "just now";
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.trunc(sec / unit[1]), unit[0]);
}

// 08 section 7.11 sentences, minus the payload and actor parts a LedgerRow does not carry. Unknown causes show raw.
const EVENT_SENTENCE: Record<string, string> = {
  create: "Deal created from one sentence.",
  edit_terms: "Terms edited.",
  join: "Seller joined.",
  accept: "Terms accepted.",
  start_payment: "Buyer started PayPal checkout.",
  submit_evidence: "Seller submitted proof.",
  verdict: "Claude judged the proof.",
  "decision:capture": "Rule: release the payment.",
  "decision:request_fix": "Rule: ask the seller for one fix.",
  "decision:buyer_review": "Rule: ask the buyer to decide.",
  "decision:void": "Rule: void the deal.",
  "review:approve": "Buyer approved the proof.",
  "review:reject": "Buyer rejected the proof.",
  cancel: "Deal cancelled.",
  retry_payout: "Seller retried the payout.",
  "tick:deadline": "The deadline passed; the hold was released.",
  "tick:reverify": "The check was re-run after an interruption.",
  "fact:authorization_created": "PayPal placed the hold.",
  "fact:late_authorization_voided": "PayPal confirmed a hold after the deal closed; it was voided.",
  "fact:capture_completed": "PayPal completed the capture.",
  "fact:capture_pending": "PayPal is still processing the capture.",
  "fact:capture_declined": "PayPal declined the capture.",
  "fact:authorization_voided": "PayPal voided the hold.",
  "fact:payout_succeeded": "PayPal paid the seller.",
  "fact:payout_failed": "The payout failed.",
};
export const eventSentence = (cause: string | null | undefined) => (cause ? (EVENT_SENTENCE[cause] ?? cause) : "—");
