// Dashboard figures, "Needs you", Buying/Selling rows and the wallet (trust spec §10). Pure: the loaders live in lib/deal/index.ts.
// Seeded deals are samples: listed in the tables, never counted in money and never "Needs you".
import type { Prisma } from "@/generated/prisma/client";
import { canRetryPayout, partyName, payoutCopy, primaryAction, whatNext, type NextCopy } from "@/lib/deal-copy";
import { toIso } from "./dates";
import { toPayout } from "./views";
import type { DealEvent, DealStatus, DealView, Payout, PaymentStatus, Role } from "./types";

/** A party's DealView plus its events (the release time is the first fact:capture_completed). */
export type SummaryDeal = DealView & { events: DealEvent[] };

/** Minor units, USD. */
export type Figures = {
  on_hold_as_buyer: number; // authorized, not captured: held / proof_submitted / in_review, caller is buyer
  held_for_you_as_seller: number; // same holds, caller is seller
  released_to_you: number; // captured this calendar month (UTC), caller is seller
  you_paid: number; // captured this calendar month (UTC), caller is buyer
  paid_out_to_you: number; // every payout PayPal reported as success, caller is seller, all time
};
export type NeedsYou = { code: string | null; item_title: string; action: string; detail: string; href: string };
export type DealLine = {
  code: string; item_title: string; other_party: string | null; amount_minor: number | null; status: DealStatus;
  next: string; deadline_at: string | null; seeded: boolean;
};
export type AccountSummary = { figures: Figures; needs_you: NeedsYou[]; buying: DealLine[]; selling: DealLine[] };

const HOLD_STATES: DealStatus[] = ["held", "proof_submitted", "in_review"];
const CLOSED: DealStatus[] = ["captured", "paid", "voided"]; // no deadline left to meet (deadlineLine)

/** Money still held on the buyer's PayPal: an authorization exists and nothing has been captured or voided.
 *  `declined` counts: PayPal refused the capture, so the authorization still stands (in_review). */
export const onHold = (status: DealStatus, p: { status: PaymentStatus; authorization_id: string | null } | null) =>
  HOLD_STATES.includes(status) && !!p?.authorization_id && (p.status === "authorized" || p.status === "declined");

/** When PayPal confirmed the capture; null if it never did. */
export const releasedAt = (events: Pick<DealEvent, "cause" | "created_at">[]) => events.find((e) => e.cause === "fact:capture_completed")?.created_at ?? null;

/** True when iso falls in now's calendar month, UTC. */
export function inMonth(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) && t < Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const dealHref = (code: string) => `/deal/${code}`;
const verifyHref = (next: string) => `/me?next=${encodeURIComponent(next)}`;

export function buildFigures(deals: SummaryDeal[], now: Date): Figures {
  const live = deals.filter((d) => !d.seeded);
  const of = (role: Role) => live.filter((d) => d.role === role);
  const held = (role: Role) => sum(of(role).filter((d) => onHold(d.status, d.payment)).map((d) => d.amount_minor ?? 0));
  const released = (role: Role) =>
    sum(of(role).filter((d) => d.payment?.status === "captured" && inMonth(releasedAt(d.events), now)).map((d) => d.amount_minor ?? 0));
  return {
    on_hold_as_buyer: held("buyer"),
    held_for_you_as_seller: held("seller"),
    released_to_you: released("seller"),
    you_paid: released("buyer"),
    paid_out_to_you: sum(of("seller").flatMap((d) => d.payouts.filter((p) => p.status === "success").map((p) => p.amount_minor))),
  };
}

/** The caller's next actions: primaryAction() per deal, a payout to retry or an email to verify, and a missing payout email. */
export function buildNeedsYou(deals: SummaryDeal[], me: { paypal_email: string | null; paypal_email_verified: boolean }, now: Date): NeedsYou[] {
  const out: NeedsYou[] = [];
  for (const d of deals.filter((x) => !x.seeded)) {
    const base = { code: d.code, item_title: d.item_title, href: dealHref(d.code) };
    const action = primaryAction(d);
    if (action) {
      // in_review: the buyer can release or reject, so "Review proof" rather than primaryAction's "Release payment".
      out.push({ ...base, action: d.status === "in_review" ? "Review proof" : action, detail: whatNext(d, { now: now.getTime() }).heading });
    } else if (d.role === "seller" && d.status === "captured" && canRetryPayout(d.payouts)) {
      const verify = d.payouts.at(-1)!.failure_reason === "PAYOUT_EMAIL_UNVERIFIED" && !me.paypal_email_verified;
      out.push({ ...base, action: verify ? "Verify PayPal email" : "Retry payout", detail: payoutCopy(d).heading, href: verify ? verifyHref(base.href) : base.href });
    }
  }
  const selling = deals.some((d) => !d.seeded && d.role === "seller" && d.status !== "paid" && d.status !== "voided");
  if (selling && !me.paypal_email_verified && !out.some((n) => n.action === "Verify PayPal email")) {
    out.push({
      code: null, item_title: "Your payout email", action: me.paypal_email ? "Verify PayPal email" : "Add PayPal email",
      detail: "Sellers are paid only to a verified PayPal email.", href: verifyHref("/dashboard"),
    });
  }
  return out;
}

export function buildDealLine(d: SummaryDeal, now: Date): DealLine {
  const other = d.role === "buyer" ? d.seller : d.buyer;
  return {
    code: d.code, item_title: d.item_title, other_party: other ? partyName(other, "") : null, amount_minor: d.amount_minor, status: d.status,
    next: whatNext(d, { now: now.getTime(), events: d.events }).heading, deadline_at: CLOSED.includes(d.status) ? null : d.deadline_at, seeded: d.seeded,
  };
}

export function buildSummary(deals: SummaryDeal[], me: { paypal_email: string | null; paypal_email_verified: boolean }, now: Date): AccountSummary {
  const sorted = [...deals].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return {
    figures: buildFigures(sorted, now),
    needs_you: buildNeedsYou(sorted, me, now),
    buying: sorted.filter((d) => d.role === "buyer").map((d) => buildDealLine(d, now)),
    selling: sorted.filter((d) => d.role === "seller").map((d) => buildDealLine(d, now)),
  };
}

// ---------- /wallet ----------

/** What getWallet loads per deal: no conditions, files or evidence; the one event that dates the capture. */
export const WALLET_INCLUDE = {
  buyer: true,
  seller: true,
  payment: true,
  payouts: { orderBy: { attempt: "asc" } },
  events: { where: { cause: "fact:capture_completed" }, orderBy: { id: "asc" }, take: 1 },
} satisfies Prisma.DealInclude;
export type WalletDeal = Prisma.DealGetPayload<{ include: typeof WALLET_INCLUDE }>;

type DealRef = { code: string; item_title: string; other_party: string | null };
export type WalletHold = DealRef & {
  amount_minor: number; status: DealStatus; authorization_id: string; authorized_at: string | null; auth_expires_at: string | null; deadline_at: string | null;
};
export type WalletCapture = DealRef & { amount_minor: number; capture_id: string; payment_status: "captured" | "capture_pending"; captured_at: string | null };
/** retry: the deal's latest attempt can be retried (canRetryPayout); copy: payoutCopy() for that attempt; verify_href when the email must be verified first. */
export type WalletPayout = DealRef & Payout & { recipient_email: string; latest: boolean; retry: boolean; copy: NextCopy | null; verify_href: string | null };
export type WalletSide = { holds: WalletHold[]; captures: WalletCapture[] };
export type Wallet = { buyer: WalletSide; seller: WalletSide & { payouts: WalletPayout[] } };

const iso = (d: Date | null) => (d ? toIso(d) : null);

/** Seeded deals are left out: their PayPal ids are samples. Holds soonest-expiring first; captures and payouts newest first. */
export function buildWallet(deals: WalletDeal[], actorId: string, verified: boolean): Wallet {
  const live = deals.filter((d) => !d.seeded);
  const side = (role: Role): WalletSide => {
    const mine = live.filter((d) => (role === "buyer" ? d.buyer_id : d.seller_id) === actorId);
    const ref = (d: WalletDeal): DealRef => {
      const other = role === "buyer" ? d.seller : d.buyer;
      return { code: d.public_code, item_title: d.item_title, other_party: other ? partyName(other, "") : null };
    };
    const holds = mine.flatMap((d): WalletHold[] => {
      const p = d.payment;
      return p && onHold(d.status, p) ? [{
        ...ref(d), amount_minor: d.amount_minor ?? 0, status: d.status, authorization_id: p.authorization_id!,
        authorized_at: iso(p.authorized_at), auth_expires_at: iso(p.auth_expires_at), deadline_at: iso(d.deadline_at),
      }] : [];
    });
    const captures = mine.flatMap((d): WalletCapture[] => {
      const p = d.payment;
      return p?.capture_id && (p.status === "captured" || p.status === "capture_pending") ? [{
        ...ref(d), amount_minor: d.amount_minor ?? 0, capture_id: p.capture_id, payment_status: p.status,
        captured_at: p.status === "captured" ? iso(d.events[0]?.created_at ?? null) : null,
      }] : [];
    });
    return {
      holds: holds.sort((a, b) => (a.auth_expires_at ?? "").localeCompare(b.auth_expires_at ?? "")),
      captures: captures.sort((a, b) => (b.captured_at ?? "~").localeCompare(a.captured_at ?? "~")), // pending (no time yet) first
    };
  };
  const payouts = live.filter((d) => d.seller_id === actorId).flatMap((d) => {
    const all = d.payouts.map(toPayout);
    const view = {
      role: "seller" as const, amount_minor: d.amount_minor, payouts: all,
      seller: d.seller && { display_name: d.seller.display_name, email: d.seller.email, has_paypal_email: !!d.seller.paypal_email, payout_email_verified: verified, paypal_email: d.seller.paypal_email },
    };
    const retry = d.status === "captured" && canRetryPayout(all);
    return d.payouts.map((row, i): WalletPayout => {
      const latest = i === d.payouts.length - 1;
      const verify = latest && retry && row.failure_reason === "PAYOUT_EMAIL_UNVERIFIED" && !verified;
      return {
        code: d.public_code, item_title: d.item_title, other_party: partyName(d.buyer, ""), ...all[i]!, recipient_email: row.recipient_email,
        latest, retry: latest && retry, copy: latest && retry ? payoutCopy(view) : null, verify_href: verify ? verifyHref(`/deal/${d.public_code}`) : null,
      };
    });
  });
  return { buyer: side("buyer"), seller: { ...side("seller"), payouts: payouts.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.attempt - a.attempt) } };
}
