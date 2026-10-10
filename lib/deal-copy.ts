// Pure copy for the deal page (08 sections 2, 7.2, 7.4) up to `held`; later states are T-28's. No React.
import type { DealPreview, DealView, Payment } from "@/lib/deal/types";
import { money, relTime, when } from "@/lib/ledger-columns";

export const partyName = (p: { display_name: string | null; email?: string } | null | undefined, fallback: string) =>
  p?.display_name || p?.email || fallback;

/** The secondary status under the pill (08 section 2). */
export function paymentLine(p: Payment | null, updatedAt: string): string | null {
  if (!p) return null;
  switch (p.status) {
    case "created": case "approved": return "Approval pending";
    case "authorized": return `Hold placed ${when(p.authorized_at)}`;
    case "capture_pending": return "Capture pending at PayPal";
    case "captured": return `Captured ${when(updatedAt)}`;
    case "declined": return "Capture declined";
    case "voided": return `Hold released ${when(updatedAt)}`;
  }
}

/** 08 section 7.2 item 2; null once the deal is closed. */
export function deadlineLine(d: Pick<DealView, "status" | "deadline_days" | "deadline_at">, now = Date.now()): string | null {
  if (["captured", "paid", "voided"].includes(d.status)) return null;
  if (d.deadline_at) return `Proof due ${when(d.deadline_at)} (${relTime(d.deadline_at, now)})`;
  return d.deadline_days ? `Seller has ${d.deadline_days} days after the hold is placed` : null;
}

export type NextCopy = { heading: string; helper: string };

/** The "What happens next" heading and helper (08 section 7.4) for draft, terms_agreed and held. */
export function whatNext(d: DealView | DealPreview, opts: { holdFailed?: boolean; now?: number } = {}): NextCopy {
  if (d.role === "preview") {
    return { heading: `${partyName(d.buyer, "The buyer")} invited you to a deal`, helper: "Joining doesn't commit you. You'll accept the terms in the next step." };
  }
  const buyer = partyName(d.buyer, "the buyer");
  const seller = partyName(d.seller, "the seller");
  const v = d.terms_version;
  const amount = money(d.amount_minor);
  const deadline = d.deadline_at ? `${when(d.deadline_at)} (${relTime(d.deadline_at, opts.now)})` : "the deadline";
  const failed = d.submissions.at(-1)?.verdicts.filter((x) => x.result === "fail").length ?? 0;

  switch (d.status) {
    case "draft":
      if (d.role === "buyer") {
        if (!d.seller) return { heading: "Share the link with your seller", helper: "They sign in, add their PayPal email and accept. You'll approve the hold after that." };
        if (d.seller_accepted_version !== v) return { heading: `Waiting for ${seller} to accept`, helper: `They're looking at version ${v}. You can still edit; editing clears both acceptances.` };
        return { heading: `${seller} accepted. Accept to continue.`, helper: `Once you accept version ${v}, you'll approve the hold with PayPal.` };
      }
      if (d.seller_accepted_version !== v) {
        return { heading: "Review the terms", helper: `Accepting means you'll prove each condition with photos or tracking before ${d.deadline_days ?? "the agreed"} days after the hold is placed. Nothing is charged to anyone yet.` };
      }
      return { heading: `You accepted version ${v}`, helper: `Waiting for ${buyer} to accept and approve the hold.` };
    case "terms_agreed": {
      if (d.role === "seller") return { heading: `Waiting for ${buyer} to approve the hold`, helper: "You'll be told here when the money is held. Don't ship before that." };
      const p = d.payment;
      if (p?.status === "approved" && p.authorization_id) {
        return { heading: "PayPal is reviewing the payment", helper: "We'll place the hold when PayPal confirms it. You can close this page; we'll finish it." };
      }
      if (opts.holdFailed) return { heading: "The hold wasn't confirmed", helper: "PayPal didn't confirm the hold. Try again, or cancel the deal. Nothing was charged." };
      if (p?.status === "approved") {
        return { heading: "Approved. Confirming the hold…", helper: "You approved in PayPal but we haven't confirmed the hold yet. PayPal usually confirms within a minute. You can close this page; we'll finish it." };
      }
      return { heading: "Approve the hold with PayPal", helper: `PayPal holds ${amount} on your account. Nothing is charged until the proof passes or you release it yourself. If the deal is voided or the deadline passes, the hold is released.` };
    }
    case "held":
      if (d.role === "buyer") {
        return d.fix_attempts_used === 0
          ? { heading: "Money held. Waiting for proof.", helper: `Nothing has been charged. If the seller's proof doesn't pass by ${deadline}, the hold is released automatically.` }
          : { heading: "The first proof failed. One more try.", helper: `${failed} condition(s) failed. The seller can fix them once before ${deadline}. If it clearly fails again the hold is released; if Claude is unsure, you decide.` };
      }
      return d.fix_attempts_used === 0
        ? { heading: "Ship it, then add your proof", helper: `Upload photos that show each condition, enter the tracking number, and submit before ${deadline}. Claude checks them against the terms; a fixed rule then releases the money, asks you to fix one thing, or asks the buyer.` }
        : { heading: "One more try", helper: `Your first proof failed ${failed} condition(s), marked below. Fix them and resubmit before ${deadline}. If it clearly fails again the deal is voided and the hold is released; if Claude is unsure, the buyer decides.` };
    default:
      return { heading: "Proof step comes next", helper: "This part of the deal page is still being built." };
  }
}
