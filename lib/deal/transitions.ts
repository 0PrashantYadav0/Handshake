// The C2 table as data (decisions C2; 02 section 5.1). Pure. The effectful transition(tx, ...) lives in commands.ts (T-08).
//
// Design: a trigger is a command type, "tick", a PayPal fact, or "decision" (the decide() outcome applied in
// proof_submitted, which is neither a command nor a fact). Rows that depend on more than (status, trigger) read an
// optional ctx: accept needs bothAccepted, review needs review, decision needs decision, authorization_voided needs
// captureIdSet (null capture_id voids; a set one is detail-only), payout_succeeded on captured needs latestAttempt.
// A C2 row whose "To" is "unchanged" (authorization_voided on captured/paid) returns null, as 06 "Transition table"
// requires: null means "no status change"; the caller turns it into invalid_state for a command and into a
// detail-only event or a no-op for a fact (facts.ts).
import type { CommandType, DealStatus, Decision } from "./types";

export const DEAL_STATUSES: readonly DealStatus[] = [
  "draft", "terms_agreed", "held", "proof_submitted", "in_review", "captured", "paid", "voided",
];

export const FACT_TYPES = [
  "authorization_created", "capture_completed", "capture_pending", "capture_declined",
  "authorization_voided", "payout_succeeded", "payout_failed",
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const COMMAND_TYPES: readonly CommandType[] = [
  "edit_terms", "join", "accept", "start_payment", "confirm_approval", "submit_evidence", "review", "cancel", "retry_payout",
];

export type Trigger = CommandType | "tick" | FactType | "decision";
export const TRIGGERS: readonly Trigger[] = [...COMMAND_TYPES, "tick", ...FACT_TYPES, "decision"];

export type TransitionCtx = {
  bothAccepted?: boolean; // accept: both accepted versions equal terms_version
  captureIdSet?: boolean; // authorization_voided: payments.capture_id is set
  latestAttempt?: boolean; // payout_succeeded: the fact is for the latest payouts.attempt
  decision?: Decision; // decision: the decide() outcome
  review?: "approve" | "reject"; // review: the buyer's choice
};

type Row = [from: readonly DealStatus[], trigger: Trigger, to: DealStatus | ((ctx: TransitionCtx) => DealStatus | null)];

const PRE_CAPTURE: readonly DealStatus[] = ["draft", "terms_agreed", "held", "proof_submitted", "in_review"];

const DECISION_TO: Record<string, DealStatus | undefined> = {
  capture: "captured", request_fix: "held", buyer_review: "in_review", void: "voided",
};

const TABLE: readonly Row[] = [
  [["draft"], "edit_terms", "draft"],
  [["draft"], "join", "draft"],
  [["draft"], "accept", (c) => (c.bothAccepted ? "terms_agreed" : "draft")],
  [["terms_agreed"], "edit_terms", "draft"],
  [["terms_agreed"], "start_payment", "terms_agreed"],
  [["terms_agreed"], "confirm_approval", "held"], // the command form of the authorization_created row
  [["terms_agreed"], "authorization_created", "held"],
  [["held"], "submit_evidence", "proof_submitted"],
  [["proof_submitted"], "decision", (c) => DECISION_TO[c.decision ?? "none"] ?? null],
  [["in_review"], "review", (c) => (c.review === "approve" ? "captured" : c.review === "reject" ? "voided" : null)],
  [["proof_submitted", "in_review"], "capture_completed", "captured"],
  [["proof_submitted", "in_review"], "capture_pending", "captured"],
  [["captured"], "capture_declined", "in_review"],
  [["captured"], "payout_succeeded", (c) => (c.latestAttempt === false ? null : "paid")],
  [["paid"], "payout_succeeded", "paid"], // an earlier attempt: that payouts row only (E7)
  [["draft", "terms_agreed", "held"], "cancel", "voided"],
  [["held", "in_review"], "tick", "voided"],
  [PRE_CAPTURE, "authorization_voided", (c) => (c.captureIdSet ? null : "voided")],
  [["captured"], "retry_payout", "captured"],
];

/** The target status for (status, trigger), or null when C2 has no row (or the row's "To" is "unchanged"). */
export function nextStatus(status: DealStatus, trigger: Trigger, ctx: TransitionCtx = {}): DealStatus | null {
  for (const [from, t, to] of TABLE) {
    if (t === trigger && from.includes(status)) return typeof to === "function" ? to(ctx) : to;
  }
  return null;
}

/** The error for a command that has no row in the current status (06 "Transition table"; 02 section 3.3). */
export function commandError(status: DealStatus, command: CommandType): "invalid_state" | "terms_not_accepted" {
  return status === "draft" && (command === "start_payment" || command === "confirm_approval") ? "terms_not_accepted" : "invalid_state";
}
