// Every type of the lib/deal interface (02 section 3) and the response shapes of 04 sections 3, 6.2 and 10.2.
import type { PrismaClient } from "@/generated/prisma/client";
import type { AiDep, RawResponse, HashSkip } from "@/lib/ai/types";
import type { PayPal } from "@/lib/paypal/types";
import type { Email } from "@/lib/email/types";
import type { Clock } from "@/lib/clock";

export type { AiDep, RawResponse, HashSkip } from "@/lib/ai/types";
export type { PayPal } from "@/lib/paypal/types";
export { PayPalError } from "@/lib/paypal/types";
export type { Email } from "@/lib/email/types";
export type { Clock } from "@/lib/clock";
import type { PublicKey } from "@/lib/contract/signature";
import type { ContractDoc } from "@/lib/contract/canonical";
export type { PublicKey } from "@/lib/contract/signature";
export type { ContractDoc } from "@/lib/contract/canonical";

/** trust spec §6: what a party sees and signs, and who has signed this version. */
export type ContractSignatureView = {
  role: Role; terms_version: number; contract_hash: string; signature: string; signed_at: string;
  key_fingerprint: string; public_key: PublicKey;
};
export type ContractView = { document: ContractDoc; hash: string; signatures: ContractSignatureView[] };

export type DealStatus =
  | "draft" | "terms_agreed" | "held" | "proof_submitted"
  | "in_review" | "captured" | "paid" | "voided";
export type PaymentStatus =
  | "created" | "approved" | "authorized" | "capture_pending"
  | "captured" | "declined" | "voided";
export type PayoutStatus = "pending" | "success" | "failed";
export type EvidenceType = "photo" | "tracking";
export type EvidenceKind = "photo" | "tracking" | "note";
export type VerdictResult = "pass" | "fail" | "unclear";
export type Decision = "capture" | "request_fix" | "buyer_review" | "void";
export type DecisionReason = "all_pass" | "fail" | "unclear" | "low_confidence" | "amount_over_limit";
export type CarrierStatus = "delivered" | "in_transit" | "unknown";
export type Role = "buyer" | "seller";
export type EventActor = "buyer" | "seller" | "system" | "paypal" | "ai";
export type Mime = "image/jpeg" | "image/png" | "image/webp";

/** The signed-in user. lib/deal derives the role from deals.buyer_id and deals.seller_id. */
export type Actor = { user_id: string };

export type ConditionInput = { text: string; evidence_type: EvidenceType };

/** One variant per command in decisions.md C2. */
export type Command =
  | { type: "edit_terms"; item_title: string; amount_minor: number | null; deadline_days: number | null; conditions: ConditionInput[] }
  | { type: "join" }
  | { type: "accept"; terms_version: number; contract_hash: string; signature: string; public_key: PublicKey; key_label?: string | null } // trust spec §6: accepting is signing
  | { type: "start_payment" }
  | { type: "confirm_approval"; order_id: string }
  | { type: "submit_evidence"; file_ids: string[]; tracking_number: string | null; note: string | null }
  | { type: "review"; decision: "approve" | "reject"; note: string | null }
  | { type: "cancel" }
  | { type: "retry_payout" };

export type CommandType = Command["type"];

export type CreateDealInput = { text: string }; // the sentence, <= 500 chars
export type AddFileInput = { purpose: "reference" | "evidence"; mime: Mime; bytes: Uint8Array };

/** A verified, parsed PayPal webhook event, as built by app/api/webhooks/paypal/route.ts. */
export type PaypalWebhookEvent = {
  id: string; // PayPal event id; primary key of webhook_events
  event_type: string; // one of the names in decisions.md E5
  create_time: string;
  resource_type: string;
  resource: Record<string, unknown>; // the v2 resource (order, authorization, capture or payout item)
  verified: boolean; // result of lib/paypal/verify.ts
  body: unknown; // the parsed raw body, stored in webhook_events.body
};

export type TickReport = {
  voided: string[]; // deal codes voided for a passed deadline
  verdicts_rerun: string[]; // deal codes whose verdict step was finished
  reconciled: string[]; // deal codes where a PayPal fact was applied by reconcile() (E12), once per fact
  errors: { code: string; message: string }[];
};

export type Deps = { db: PrismaClient; paypal: PayPal; ai: AiDep; email: Email; clock: Clock };

// ---------- response shapes (04 section 3) ----------

export type Party = { display_name: string | null; email: string };

export type Condition = {
  id: string;
  position: number; // 1-based display order; the code condition is always last
  text: string;
  evidence_type: EvidenceType;
  system: boolean; // true for the server-added "Photo shows the deal code {code} written by hand"
};

export type FileRef = {
  id: string;
  purpose: "reference" | "evidence";
  mime: Mime;
  size_bytes: number;
  sha256: string; // lowercase hex, 64 chars
  url: string; // signed, relative, valid 10 minutes from the response
  created_at: string;
};

export type VerdictView = {
  condition_id: string;
  result: VerdictResult;
  confidence: number;
  reason: string;
  evidence_used: string[];
  model: string;
  prompt_version: string;
};

export type Submission = {
  submission_no: 1 | 2;
  submitted_at: string;
  files: FileRef[]; // evidence photos, in upload order
  tracking_number: string | null;
  carrier_status: CarrierStatus | null;
  note: string | null;
  verdicts: VerdictView[];
  decision: Decision | null; // null while status is proof_submitted
  decision_reason: DecisionReason | null;
  decided_at: string | null;
};

export type Payment = {
  status: PaymentStatus;
  paypal_order_id: string;
  authorization_id: string | null; // the ORIGINAL authorization id (E3)
  authorized_at: string | null;
  auth_expires_at: string | null;
  capture_id: string | null;
};

export type Payout = {
  attempt: number;
  status: PayoutStatus;
  amount_minor: number;
  sender_batch_id: string;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  failure_reason: string | null;
  created_at: string;
};

export type DealView = {
  code: string;
  role: Role;
  status: DealStatus;
  item_title: string;
  source_text: string;
  amount_minor: number | null;
  currency: "USD";
  deadline_days: number | null;
  deadline_at: string | null;
  terms_version: number;
  buyer_accepted_version: number | null;
  seller_accepted_version: number | null;
  fix_attempts_used: 0 | 1;
  buyer: Party;
  seller: (Party & { has_paypal_email: boolean; payout_email_verified: boolean; paypal_email: string | null }) | null; // paypal_email only when role = "seller"
  conditions: Condition[];
  reference_files: FileRef[];
  submissions: Submission[];
  payment: Payment | null;
  payouts: Payout[]; // ascending by attempt
  contract: ContractView | null; // null until the seller has joined and the amount and deadline are set
  seeded: boolean;
  created_at: string;
  updated_at: string;
};

export type DealPreview = {
  role: "preview";
  code: string;
  item_title: string;
  amount_minor: number | null;
  currency: "USD";
  deadline_days: number | null;
  conditions: Condition[];
  buyer: { display_name: string | null };
};

export type DealEvent = {
  id: string; // BigInt as decimal string
  from_status: DealStatus | null;
  to_status: DealStatus;
  actor: EventActor;
  cause: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type LedgerRow = {
  code: string;
  item_title: string;
  role: Role;
  counterparty: string | null;
  amount_minor: number | null;
  currency: "USD";
  status: DealStatus;
  deadline_at: string | null;
  last_event_cause: string | null;
  last_event_at: string | null;
  lowest_confidence: number | null;
  seeded: boolean;
  updated_at: string;
};

export type EvidencePack = {
  format: "handshake-evidence-pack/1";
  generated_at: string;
  generated_for: Role;
  deal: Omit<DealView, "role" | "buyer" | "seller" | "conditions" | "reference_files" | "submissions" | "payment" | "payouts">;
  parties: { buyer: Party; seller: (Party & { paypal_email: string | null }) | null };
  conditions: Condition[];
  reference_files: FileRef[];
  submissions: (Omit<Submission, "verdicts"> & { verdicts: (VerdictView & { raw_response: RawResponse | HashSkip | { seeded: true } })[] })[];
  payment: Payment | null;
  payouts: (Payout & { recipient_email: string })[];
  events: DealEvent[];
  webhook_events: { paypal_event_id: string; event_type: string; verified: boolean; processed_at: string | null; created_at: string }[];
  extraction: { model: string; prompt_version: string; rejected: { text: string; suggestion: string }[] } | null;
  /** trust spec §6: the current contract with its signatures, and every signature ever made on this deal (all versions). */
  contract: ContractView | null;
  signature_history: ContractSignatureView[];
};
