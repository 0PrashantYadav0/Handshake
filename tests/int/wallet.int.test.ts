// Trust spec §10: getWallet and getAccountSummary for a buyer and a seller across held, captured, paid and failed-payout deals.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPaypalEvent, getAccountSummary, getWallet } from "@/lib/deal";
import { toIso } from "@/lib/deal/dates";
import { payoutBatchId } from "@/lib/deal/keys";
import { fixedClock } from "@/lib/clock";
import { assertEventsInC6, dealBuilder, parties, resetDb, testDeps, webhookEvent, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;

beforeEach(async () => {
  await resetDb();
  // deal_events.created_at is the database clock, so the summary's "this month" must be read against the real date.
  deps = testDeps({ clock: fixedClock(new Date().toISOString()) });
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(assertEventsInC6);

const payoutItem = async (code: string, type: string, extra: Record<string, unknown> = {}) => {
  const row = await deps.db.payout.findFirstOrThrow({ where: { deal: { public_code: code }, attempt: 1 } });
  await applyPaypalEvent(webhookEvent(`PAYMENT.PAYOUTS-ITEM.${type}`, {
    payout_item_id: `ITEM-${row.paypal_batch_id!.slice("BATCH-".length)}`, payout_batch_id: row.paypal_batch_id, payout_item: { sender_item_id: payoutBatchId(code, 1) }, ...extra,
  }), deps);
};
const paymentOf = (code: string) => deps.db.payment.findFirstOrThrow({ where: { deal: { public_code: code } } });
const iso = (d: Date | null) => (d ? toIso(d) : null);

/** held, captured (payout pending), paid, failed payout: four deals between the same buyer and seller. */
async function fourDeals() {
  const held = await build.held();
  const captured = await build.captured();
  const paid = await build.captured();
  await payoutItem(paid, "SUCCEEDED");
  const failed = await build.captured();
  await payoutItem(failed, "FAILED", { errors: { name: "RECEIVER_ACCOUNT_INVALID" } });
  return { held, captured, paid, failed };
}

describe("getWallet", () => {
  test("buyer: the hold with its authorization id and expiry, the three captures; no payouts", async () => {
    const c = await fourDeals();
    const w = await getWallet(p.asBuyer, deps);
    const hp = await paymentOf(c.held);
    const deal = await deps.db.deal.findUniqueOrThrow({ where: { public_code: c.held } });
    expect(w.buyer.holds).toEqual([{
      code: c.held, item_title: expect.any(String), other_party: "Seller", amount_minor: 8000, status: "held",
      authorization_id: hp.authorization_id, authorized_at: iso(hp.authorized_at), auth_expires_at: iso(hp.auth_expires_at), deadline_at: iso(deal.deadline_at),
    }]);
    expect(w.buyer.holds[0]!.authorization_id).toMatch(/^AUTH-/);
    expect(w.buyer.holds[0]!.item_title).not.toMatch(/^enc1\./); // opened, not ciphertext
    expect(w.buyer.captures.map((x) => x.code).sort()).toEqual([c.captured, c.paid, c.failed].sort());
    for (const x of w.buyer.captures) {
      expect(x).toMatchObject({ amount_minor: 8000, capture_id: (await paymentOf(x.code)).capture_id, payment_status: "captured", other_party: "Seller" });
      expect(x.captured_at).not.toBeNull();
    }
    expect(w.seller).toEqual({ holds: [], captures: [], payouts: [] });
  });

  test("seller: the same hold and captures, and each payout with its PayPal ids, status and retry", async () => {
    const c = await fourDeals();
    const w = await getWallet(p.asSeller, deps);
    expect(w.buyer).toEqual({ holds: [], captures: [] });
    expect(w.seller.holds.map((h) => [h.code, h.other_party])).toEqual([[c.held, "Buyer"]]);
    expect(w.seller.captures).toHaveLength(3);
    const by = Object.fromEntries(w.seller.payouts.map((x) => [x.code, x]));
    expect(w.seller.payouts).toHaveLength(3);
    for (const code of [c.captured, c.paid, c.failed]) {
      const row = await deps.db.payout.findFirstOrThrow({ where: { deal: { public_code: code } } });
      expect(by[code]).toMatchObject({
        attempt: 1, amount_minor: 8000, recipient_email: "seller-pp@test", sender_batch_id: payoutBatchId(code, 1), paypal_batch_id: row.paypal_batch_id,
        paypal_item_id: row.paypal_item_id, status: row.status, latest: true,
      });
    }
    expect(by[c.captured]).toMatchObject({ status: "pending", retry: false, copy: null, verify_href: null });
    expect(by[c.paid]).toMatchObject({ status: "success", retry: false, copy: null });
    expect(by[c.failed]).toMatchObject({
      status: "failed", failure_reason: "RECEIVER_ACCOUNT_INVALID", retry: true, verify_href: null,
      copy: { heading: "Payout failed", helper: expect.stringContaining("RECEIVER_ACCOUNT_INVALID") },
    });
  });

  test("a payout refused for an unverified email points the seller at /me first", async () => {
    const code = await build.held();
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "changed@test", paypal_email_verified_at: null } });
    deps.ai.judgeWith([]);
    await build.submit(code);
    const [x] = (await getWallet(p.asSeller, deps)).seller.payouts;
    expect(x).toMatchObject({ status: "failed", failure_reason: "PAYOUT_EMAIL_UNVERIFIED", paypal_batch_id: null, retry: true, copy: { heading: "Verify your PayPal email" }, verify_href: `/me?next=%2Fdeal%2F${code}` });
  });

  test("a stranger's wallet is empty", async () => {
    await fourDeals();
    expect(await getWallet(p.asThird, deps)).toEqual({ buyer: { holds: [], captures: [] }, seller: { holds: [], captures: [], payouts: [] } });
  });
});

describe("getAccountSummary", () => {
  test("figures, Needs you and both tables from the database, for each side", async () => {
    const c = await fourDeals();
    const draft = await build.joined(); // both still to sign
    const b = await getAccountSummary(p.asBuyer, deps);
    expect(b.figures).toEqual({ on_hold_as_buyer: 8000, held_for_you_as_seller: 0, released_to_you: 0, you_paid: 24000, paid_out_to_you: 0 });
    expect(b.needs_you.map((n) => [n.code, n.action])).toEqual([[draft, "Sign contract"]]);
    expect(b.buying.map((r) => r.code).sort()).toEqual([c.held, c.captured, c.paid, c.failed, draft].sort());
    expect(b.selling).toEqual([]);

    const s = await getAccountSummary(p.asSeller, deps);
    expect(s.figures).toEqual({ on_hold_as_buyer: 0, held_for_you_as_seller: 8000, released_to_you: 24000, you_paid: 0, paid_out_to_you: 8000 });
    expect(s.needs_you.map((n) => [n.code, n.action]).sort()).toEqual([[c.held, "Submit proof for checking"], [c.failed, "Retry payout"], [draft, "Sign contract"]].sort());
    expect(s.selling.find((r) => r.code === c.paid)).toMatchObject({ other_party: "Buyer", status: "paid", next: "Paid", amount_minor: 8000 });
  });
});
