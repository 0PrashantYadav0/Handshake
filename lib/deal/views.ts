// Response builders (04 sections 3 and 6.2; 02 section 3.2). Signed file URLs are minted here, after the access check.
import type { DealStatus as DbDealStatus, Prisma } from "@/generated/prisma/client";
import { carrierStatus } from "@/lib/carrier";
import { signFileUrl } from "@/lib/files/urls";
import type { DealRow } from "./access";
import { toIso } from "./dates";
import { isCodeCondition } from "./terms";
import type { Condition, DealEvent, DealPreview, DealView, FileRef, LedgerRow, Mime, Payment, Payout, Role, Submission, VerdictView } from "./types";

const iso = (d: Date | null) => (d ? toIso(d) : null);
const payloadOf = (e: { payload: Prisma.JsonValue }) => e.payload as Record<string, unknown>;

export const toFileRef = (f: DealRow["files"][number], now: Date): FileRef => ({
  id: f.id, purpose: f.purpose, mime: f.mime as Mime, size_bytes: f.size_bytes, sha256: f.sha256,
  url: signFileUrl(f.id, 600, now), created_at: toIso(f.created_at),
});

export const toCondition = (c: DealRow["conditions"][number]): Condition => ({
  id: c.id, position: c.position, text: c.text, evidence_type: c.evidence_type, system: isCodeCondition(c.text),
});

export const toEvent = (e: DealRow["events"][number]): DealEvent => ({
  id: e.id.toString(), from_status: e.from_status, to_status: e.to_status, actor: e.actor, cause: e.cause,
  payload: payloadOf(e), created_at: toIso(e.created_at),
});

export const toPayment = (deal: DealRow): Payment | null =>
  deal.seeded || !deal.payment ? null : {
    status: deal.payment.status, paypal_order_id: deal.payment.paypal_order_id, authorization_id: deal.payment.authorization_id,
    authorized_at: iso(deal.payment.authorized_at), auth_expires_at: iso(deal.payment.auth_expires_at), capture_id: deal.payment.capture_id,
  };

export const toPayout = (p: DealRow["payouts"][number]): Payout => ({
  attempt: p.attempt, status: p.status, amount_minor: p.amount_minor, sender_batch_id: p.sender_batch_id, paypal_batch_id: p.paypal_batch_id,
  paypal_item_id: p.paypal_item_id, failure_reason: p.failure_reason, created_at: toIso(p.created_at),
});

export const toVerdict = (v: DealRow["verdicts"][number]): VerdictView => ({
  condition_id: v.condition_id, result: v.result, confidence: v.confidence, reason: v.reason, evidence_used: v.evidence_used,
  model: v.model, prompt_version: v.prompt_version,
});

/** Submissions from evidence, verdicts and the submit_evidence / decision:* events; seeded deals have verdicts but no evidence.
 *  withRaw adds verdicts[].raw_response for the evidence pack (04 section 10.2). */
export function buildSubmissions(deal: DealRow, now: Date, withRaw = false): Submission[] {
  const filesById = new Map(deal.files.map((f) => [f.id, f]));
  const posById = new Map(deal.conditions.map((c) => [c.id, c.position]));
  const nos = [...new Set([...deal.evidence.map((e) => e.submission_no), ...deal.verdicts.map((v) => v.submission_no)])].sort();
  return nos.map((n) => {
    const ev = deal.evidence.filter((e) => e.submission_no === n);
    const verdictRows = deal.verdicts.filter((v) => v.submission_no === n).sort((a, b) => (posById.get(a.condition_id) ?? 0) - (posById.get(b.condition_id) ?? 0));
    const ofNo = deal.events.filter((e) => payloadOf(e).submission_no === n);
    const submitted = ofNo.find((e) => e.cause === "submit_evidence");
    const decided = ofNo.filter((e) => e.cause.startsWith("decision:")).at(-1); // the newest decision:* of the submission (04 section 9.1 step 9)
    const tracking = ev.find((e) => e.kind === "tracking")?.value ?? null;
    return {
      submission_no: n as 1 | 2,
      submitted_at: toIso(submitted?.created_at ?? ev[0]?.created_at ?? verdictRows[0]?.created_at ?? deal.created_at),
      files: ev.filter((e) => e.kind === "photo").flatMap((e) => (e.file_id && filesById.get(e.file_id) ? [toFileRef(filesById.get(e.file_id)!, now)] : [])),
      tracking_number: tracking,
      carrier_status: tracking ? carrierStatus(tracking) : null,
      note: ev.find((e) => e.kind === "note")?.value ?? null,
      verdicts: verdictRows.map((v) => (withRaw ? { ...toVerdict(v), raw_response: v.raw_response } : toVerdict(v))),
      decision: decided ? (decided.cause.slice("decision:".length) as Submission["decision"]) : null,
      decision_reason: decided ? ((payloadOf(decided).reason as Submission["decision_reason"]) ?? null) : null,
      decided_at: decided ? toIso(decided.created_at) : null,
    };
  });
}

export function buildDealView(deal: DealRow, role: Role, now: Date): DealView {
  return {
    code: deal.public_code, role, status: deal.status, item_title: deal.item_title, source_text: deal.source_text,
    amount_minor: deal.amount_minor, currency: "USD", deadline_days: deal.deadline_days, deadline_at: iso(deal.deadline_at),
    terms_version: deal.terms_version, buyer_accepted_version: deal.buyer_accepted_version, seller_accepted_version: deal.seller_accepted_version,
    fix_attempts_used: deal.fix_attempts_used as 0 | 1,
    buyer: { display_name: deal.buyer.display_name, email: deal.buyer.email },
    seller: deal.seller && {
      display_name: deal.seller.display_name, email: deal.seller.email, has_paypal_email: !!deal.seller.paypal_email,
      paypal_email: role === "seller" ? deal.seller.paypal_email : null,
    },
    conditions: deal.conditions.map(toCondition),
    reference_files: deal.files.filter((f) => f.purpose === "reference").map((f) => toFileRef(f, now)),
    submissions: buildSubmissions(deal, now),
    payment: toPayment(deal),
    payouts: deal.payouts.map(toPayout),
    seeded: deal.seeded, created_at: toIso(deal.created_at), updated_at: toIso(deal.updated_at),
  };
}

/** Exactly the F4 keys. */
export function buildDealPreview(deal: DealRow): DealPreview {
  return {
    role: "preview", code: deal.public_code, item_title: deal.item_title, amount_minor: deal.amount_minor, currency: "USD",
    deadline_days: deal.deadline_days, conditions: deal.conditions.map(toCondition), buyer: { display_name: deal.buyer.display_name },
  };
}

export type LedgerDeal = Prisma.DealGetPayload<{ include: { buyer: true; seller: true; verdicts: true; events: { orderBy: { id: "desc" }; take: 1 } } }>;

export function buildLedgerRow(deal: LedgerDeal, actorId: string): LedgerRow {
  const role: Role = deal.buyer_id === actorId ? "buyer" : "seller";
  const other = role === "buyer" ? deal.seller : deal.buyer;
  const last = deal.events[0];
  const latestNo = Math.max(0, ...deal.verdicts.map((v) => v.submission_no));
  const confidences = deal.verdicts.filter((v) => v.submission_no === latestNo).map((v) => v.confidence);
  return {
    code: deal.public_code, item_title: deal.item_title, role, counterparty: other ? (other.display_name ?? other.email) : null,
    amount_minor: deal.amount_minor, currency: "USD", status: deal.status as DbDealStatus, deadline_at: iso(deal.deadline_at),
    last_event_cause: last?.cause ?? null, last_event_at: last ? toIso(last.created_at) : null,
    lowest_confidence: confidences.length ? Math.min(...confidences) : null,
    seeded: deal.seeded, updated_at: toIso(deal.updated_at),
  };
}
