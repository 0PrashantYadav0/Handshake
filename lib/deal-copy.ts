// Pure copy and small derivations for the deal page (08 sections 2, 7.1, 7.2, 7.4, 7.9, 7.11, 7.13). No React.
import type { CarrierStatus, DealEvent, DealPreview, DealStatus, DealView, EventActor, Payment, Payout, Role, Submission, VerdictResult } from "@/lib/deal/types";
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

// ---------- small rules (08 sections 7.3, 7.13; 02 section 8.2) ----------

/** "Cancel deal" exists in draft, terms_agreed and held (C2). */
export const cancellable = (status: DealStatus) => ["draft", "terms_agreed", "held"].includes(status);

/** "Retry payout" exactly when the latest payout is failed, or pending with no batch id (04 section 9.4). */
export function canRetryPayout(payouts: Payout[]): boolean {
  const p = payouts.at(-1);
  return !!p && (p.status === "failed" || (p.status === "pending" && !p.paypal_batch_id));
}

export const VERDICT_LABEL: Record<VerdictResult, string> = { pass: "Pass", fail: "Fail", unclear: "Unclear" };
export const VERDICT_ICON: Record<VerdictResult, string> = { pass: "✓", fail: "✕", unclear: "?" };
export const ACTOR_LABEL: Record<EventActor, string> = { buyer: "Buyer", seller: "Seller", system: "System", paypal: "PayPal", ai: "AI" };

export const carrierLabel = (s: CarrierStatus | null | undefined) => (s === "in_transit" ? "in transit" : (s ?? "unknown"));

export type Chip = { kind: "evidence" | "reference"; index: number } | { kind: "tracking" | "note" };
/** `Verdict.evidence_used` label -> what to render (08 section 7.9): e1..e6 and r1..r4 are 0-based positions. */
export function evidenceChip(label: string): Chip | null {
  if (label === "tracking" || label === "note") return { kind: label };
  const m = /^([er])([1-9])$/.exec(label);
  if (!m) return null;
  return { kind: m[1] === "e" ? "evidence" : "reference", index: Number(m[2]) - 1 };
}

/** The decision line under the verdict table (08 section 7.9); null while the decision is pending. */
export function decisionLine(s: Pick<Submission, "verdicts" | "decision" | "decision_reason">, role: Role): string | null {
  const n = (r: VerdictResult) => s.verdicts.filter((v) => v.result === r).length;
  const key = `${s.decision}:${s.decision_reason}`;
  switch (key) {
    case "capture:all_pass": return "All conditions passed with high confidence and the amount is within the auto-release limit, so the rule released the payment.";
    case "request_fix:fail": return role === "seller" ? `${n("fail")} condition(s) failed. You can fix and resubmit once.` : `${n("fail")} condition(s) failed. The seller has one chance to fix them.`;
    case "void:fail": return `${n("fail")} condition(s) clearly failed on the second attempt. The deal is voided and the hold released.`;
    case "buyer_review:unclear": return `Claude couldn't decide on ${n("unclear")} condition(s), so the buyer decides.`;
    case "buyer_review:low_confidence": return "Claude's confidence was below the rule's threshold, so the buyer decides.";
    case "buyer_review:fail": return `${n("fail")} condition(s) failed on the second attempt, but Claude wasn't confident enough to void the deal, so the buyer decides.`;
    case "buyer_review:amount_over_limit": return "Every condition passed. Deals above the auto-release limit always go to the buyer.";
    default: return null;
  }
}

export const modelLine = (s: Pick<Submission, "verdicts">) =>
  `The result and confidence come from Claude${s.verdicts[0] ? ` (${s.verdicts[0].model})` : ""}. The decision comes from a fixed rule in code, never from the model.`;

/** The first event that closed the deal (08 section 7.1), not the fact:authorization_voided that follows it. */
export const voidEvent = (events: DealEvent[]) => events.find((e) => e.to_status === "voided" && e.from_status !== "voided");

const VOID_REASON: Record<string, string> = {
  "cancel:buyer": "The buyer cancelled the deal.",
  "cancel:seller": "The seller cancelled the deal.",
  "tick:deadline:system": "The deadline passed with no passing proof.",
  "decision:void:system": "The proof failed twice.",
  "review:reject:buyer": "The buyer rejected the proof.",
  "fact:authorization_voided:paypal": "PayPal voided the hold.",
};

/** 08 section 7.11 sentences with the payload parts filled in. Unknown causes show raw. */
export function timelineSentence(e: Pick<DealEvent, "cause" | "actor" | "payload">): string {
  const p = e.payload;
  const actor = ACTOR_LABEL[e.actor];
  switch (e.cause) {
    case "create": return "Buyer created the deal from one sentence.";
    case "edit_terms": return `Buyer edited the terms (now version ${p.terms_version}).`;
    case "join": return "Seller joined.";
    case "accept": return `${actor} accepted version ${p.terms_version}.`;
    case "start_payment": return `Buyer started PayPal checkout (order attempt ${p.order_attempt}).`;
    case "submit_evidence": return `Seller submitted proof (attempt ${p.submission_no}).`;
    case "verdict": return `Claude judged attempt ${p.submission_no}.`;
    case "decision:capture": return "Rule: release the payment.";
    case "decision:request_fix": return "Rule: ask the seller for one fix.";
    case "decision:buyer_review": return `Rule: ask the buyer to decide (${p.reason}).`;
    case "decision:void": return "Rule: void the deal.";
    case "review:approve": return "Buyer approved the proof.";
    case "review:reject": return "Buyer rejected the proof.";
    case "cancel": return `${actor} cancelled the deal.`;
    case "retry_payout": return `Seller retried the payout (attempt ${p.attempt}).`;
    case "tick:deadline": return "The deadline passed; the hold was released.";
    case "tick:reverify": return "The check was re-run after an interruption.";
    case "fact:authorization_created": return "PayPal placed the hold.";
    case "fact:late_authorization_voided": return "PayPal confirmed a hold after the deal closed; it was voided.";
    case "fact:capture_completed": return "PayPal completed the capture.";
    case "fact:capture_pending": return "PayPal is still processing the capture.";
    case "fact:capture_declined": return "PayPal declined the capture.";
    case "fact:authorization_voided": return "PayPal voided the hold.";
    case "fact:payout_succeeded": return "PayPal paid the seller.";
    case "fact:payout_failed": return `The payout failed (${p.failure_reason}).`;
    default: return e.cause;
  }
}

export type NextCopy = { heading: string; helper: string };

/** The captured-state card (08 section 7.4 "captured"), keyed by role and the latest payout. */
export function payoutCopy(d: Pick<DealView, "role" | "amount_minor" | "seller" | "payouts">): NextCopy {
  const amount = money(d.amount_minor);
  const p = d.payouts.at(-1);
  if (d.role === "buyer") {
    return p?.status === "failed"
      ? { heading: "Payment released. Payout to the seller failed.", helper: "The seller has been asked to check their PayPal email and retry. You've already paid." }
      : { heading: "Payment released", helper: `${amount} is being charged to your PayPal and paid to ${partyName(d.seller, "the seller")}. The deal is complete once the payout lands.` };
  }
  const email = d.seller?.paypal_email ?? "your PayPal email";
  if (p?.status === "failed") {
    const extra = p.failure_reason === "UNCLAIMED" ? " That address has no PayPal account yet. Retrying cancels the unclaimed payment first." : "";
    return { heading: "Payout failed", helper: `PayPal couldn't pay ${email}: ${p.failure_reason ?? "unknown reason"}. Check your PayPal email on your profile, then retry.${extra}` };
  }
  if (p?.status === "pending" && !p.paypal_batch_id) return { heading: "Payout not confirmed", helper: "We didn't hear back from PayPal. Retry to send the payout again." };
  return { heading: "Payment released to you", helper: `PayPal is sending ${amount} to ${email}. This usually takes a minute.` };
}

const CHECKING_HELPER = "This usually takes under 15 seconds, at most about 40. If the check could not finish, Handshake re-runs it at the next daily check (06:00 UTC) or when an operator runs it; nothing is charged until then.";

/** The "What happens next" heading and helper (08 section 7.4) for every status. `events` keys the voided reason. */
export function whatNext(d: DealView | DealPreview, opts: { holdFailed?: boolean; now?: number; events?: DealEvent[] } = {}): NextCopy {
  if (d.role === "preview") {
    return { heading: `${partyName(d.buyer, "The buyer")} invited you to a deal`, helper: "Joining doesn't commit you. You'll accept the terms in the next step." };
  }
  const buyer = partyName(d.buyer, "the buyer");
  const seller = partyName(d.seller, "the seller");
  const v = d.terms_version;
  const amount = money(d.amount_minor);
  const deadline = d.deadline_at ? `${when(d.deadline_at)} (${relTime(d.deadline_at, opts.now)})` : "the deadline";
  const last = d.submissions.at(-1);
  const count = (r: VerdictResult) => last?.verdicts.filter((x) => x.result === r).length ?? 0;
  const failed = count("fail");

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
    case "proof_submitted":
      return { heading: d.role === "buyer" ? "Checking the seller's proof…" : "Checking your proof…", helper: CHECKING_HELPER };
    case "in_review": {
      const declined = d.payment?.status === "declined";
      if (d.role === "seller") {
        return declined
          ? { heading: `PayPal declined the capture. Waiting for ${buyer}.`, helper: "The buyer can try the capture again or reject the proof. You'll see the result here." }
          : { heading: `Waiting for ${buyer} to decide`, helper: "Claude couldn't decide on its own, so the buyer is looking at your proof. You'll see the result here." };
      }
      if (declined) return { heading: "PayPal declined the capture", helper: "The proof passed, but PayPal declined the capture (details in the timeline). Try again, or reject the proof to release the hold." };
      const tail = `Look at the proof and decide. If you do nothing, the hold is released on ${deadline}.`;
      switch (last?.decision_reason) {
        case "low_confidence": return { heading: "Your decision: confidence was too low", helper: `Claude's confidence was below what the rule requires. ${tail}` };
        case "fail": return { heading: "Your decision: the second proof may have failed", helper: `${failed} condition(s) failed on the second try, but Claude wasn't confident enough for the rule to void the deal. ${tail}` };
        case "amount_over_limit": return { heading: "Your decision: this deal is over the auto-release limit", helper: `Every condition passed. Deals above the auto-release limit always need your confirmation. If you do nothing, the hold is released on ${deadline}.` };
        default: return { heading: "Your decision: Claude couldn't decide", helper: `${count("unclear")} of ${d.conditions.length} conditions came back unclear. ${tail}` };
      }
    }
    case "captured":
      return payoutCopy(d);
    case "paid":
      return d.role === "buyer"
        ? { heading: "Deal complete", helper: `${seller} was paid ${amount} on ${when(d.updated_at)}. Thanks for using Handshake.` }
        : { heading: "Paid", helper: `${amount} was sent to ${d.seller?.paypal_email ?? "your PayPal email"} on ${when(d.updated_at)}.` };
    case "voided": {
      const e = voidEvent(opts.events ?? []);
      const why = (e && VOID_REASON[`${e.cause}:${e.actor}`]) ?? "The deal was closed.";
      const held = d.payment?.authorized_at ? `The hold of ${amount} was released. Nothing was charged.` : "No money was ever held.";
      return { heading: "Deal voided", helper: `${why} ${held}` };
    }
  }
}

/** T-40, 08 section 7.2 item 3: the label of the viewer's primary action in the "What happens next" card, repeated in the mobile sticky bar; null when there is none. */
export function primaryAction(d: DealView | DealPreview): string | null {
  if (d.role === "preview") return "Join as seller";
  if (d.seeded) return null;
  switch (d.status) {
    case "draft": {
      const mine = d.role === "buyer" ? d.buyer_accepted_version : d.seller_accepted_version;
      return mine === d.terms_version ? null : "Accept terms";
    }
    case "terms_agreed":
      return d.role === "buyer" && d.payment?.status !== "approved" ? "Pay with PayPal" : null;
    case "held":
      return d.role === "seller" ? "Submit proof for checking" : null;
    case "in_review":
      return d.role === "buyer" && d.submissions.length > 0 ? "Release payment" : null;
    default:
      return null;
  }
}
