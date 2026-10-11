// /wallet (trust spec §10): the payout destination, then holds, captures and payouts with their PayPal ids, as seller and as buyer.
// Full (second-factor) session only. Seeded sample deals are left out: their ids are not real PayPal ids.
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current";
import { getWallet, type WalletCapture, type WalletHold } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { formatUsd } from "@/lib/money";
import { Id, Table, Time } from "@/components/Table";

const PAYOUT_STATUS = { pending: ["Pending", "held"], success: ["Paid", "paid"], failed: ["Failed", "voided"] } as const; // label, pill colour role

const Deal = ({ code, title }: { code: string; title: string }) => (
  <>
    <Link href={`/deal/${code}`} className="hs-link font-medium">{title}</Link>
    <span className="block font-mono text-xs text-[var(--hs-muted)]">{code}</span>
  </>
);
const Amount = ({ minor }: { minor: number }) => <span className="tabular-nums">{formatUsd(minor)}</span>;

export default async function WalletPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/wallet");
  const w = await getWallet({ user_id: me.id }, getDeps());

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-8">
      <div>
        <h1 className="hs-display text-4xl">Wallet</h1>
        <p className="mt-1 text-[var(--hs-muted)]">Where your money is at PayPal, deal by deal. PayPal ids are shown so you can match them in your PayPal account.</p>
      </div>

      <section className="hs-card" aria-labelledby="dest-h">
        <h2 id="dest-h" className="text-lg font-semibold">Payout destination</h2>
        {me.paypal_email ? (
          <p className="mt-1 break-all">
            <span className="font-mono">{me.paypal_email}</span>{" "}
            <span className="hs-pill align-middle" data-status={me.paypal_email_verified ? "paid" : "in_review"}>{me.paypal_email_verified ? "Verified" : "Not verified"}</span>
          </p>
        ) : (
          <p className="mt-1">No PayPal email yet.</p>
        )}
        <p className="hs-help mt-1">Sellers are paid only to a verified PayPal email. Changing it needs a code from your authenticator app and one we email to the new address.</p>
        <Link href="/me?next=/wallet" className="hs-btn-secondary mt-3">{me.paypal_email ? (me.paypal_email_verified ? "Change payout email" : "Verify payout email") : "Add payout email"}</Link>
      </section>

      <h2 className="hs-display mt-2 text-2xl">As seller</h2>
      <Holds caption="Held for you" other="Buyer" rows={w.seller.holds} empty="No money is held for you right now." />
      <Captures caption="Released to you" other="Buyer" rows={w.seller.captures} empty="Nothing released to you yet." />
      <Table
        caption="Payouts to you"
        head={["Deal", "Attempt", "Amount", "Recipient", "Batch id", "Item id", "Status", "Details"]}
        empty="No payouts yet. A payout starts as soon as a payment is released to you."
        rows={w.seller.payouts.map((p) => ({
          key: p.sender_batch_id,
          cells: [
            <Deal key="d" code={p.code} title={p.item_title} />,
            <span key="a" className="tabular-nums">{p.attempt}</span>,
            <Amount key="m" minor={p.amount_minor} />,
            <span key="r" className="whitespace-nowrap">{p.recipient_email}</span>,
            <Id key="b" v={p.paypal_batch_id} />,
            <Id key="i" v={p.paypal_item_id} />,
            <span key="s" className="hs-pill" data-status={PAYOUT_STATUS[p.status][1]}>{PAYOUT_STATUS[p.status][0]}</span>,
            <div key="x" className="max-w-xs">
              {p.copy ? (
                <>
                  <p className="font-medium">{p.copy.heading}</p>
                  <p className="hs-help">{p.copy.helper}</p>
                </>
              ) : p.failure_reason ? (
                <p className="hs-help">PayPal reported {p.failure_reason}.</p>
              ) : (
                <span className="text-[var(--hs-muted)]">Sent <Time iso={p.created_at} /></span>
              )}
              {p.verify_href && <Link href={p.verify_href} className="hs-link mt-1 block">Verify your PayPal email</Link>}
              {p.retry && <Link href={`/deal/${p.code}`} className="hs-link mt-1 block">Retry the payout on the deal page</Link>}
            </div>,
          ],
        }))}
      />

      <h2 className="hs-display mt-2 text-2xl">As buyer</h2>
      <Holds caption="Holds on your PayPal" other="Seller" rows={w.buyer.holds} empty="Nothing is held on your PayPal right now." />
      <Captures caption="Payments you released" other="Seller" rows={w.buyer.captures} empty="You haven't released a payment yet." />
    </main>
  );
}

function Holds({ caption, other, rows, empty }: { caption: string; other: string; rows: WalletHold[]; empty: string }) {
  return (
    <Table
      caption={caption}
      head={["Deal", other, "Amount", "Authorization id", "Hold expires", "Proof deadline"]}
      empty={empty}
      rows={rows.map((h) => ({
        key: h.authorization_id,
        cells: [<Deal key="d" code={h.code} title={h.item_title} />, h.other_party ?? "—", <Amount key="m" minor={h.amount_minor} />, <Id key="a" v={h.authorization_id} />, <Time key="e" iso={h.auth_expires_at} />, <Time key="t" iso={h.deadline_at} />],
      }))}
    />
  );
}

function Captures({ caption, other, rows, empty }: { caption: string; other: string; rows: WalletCapture[]; empty: string }) {
  return (
    <Table
      caption={caption}
      head={["Deal", other, "Amount", "Capture id", "Captured"]}
      empty={empty}
      rows={rows.map((c) => ({
        key: c.capture_id,
        cells: [
          <Deal key="d" code={c.code} title={c.item_title} />, c.other_party ?? "—", <Amount key="m" minor={c.amount_minor} />, <Id key="c" v={c.capture_id} />,
          c.payment_status === "capture_pending" ? <span key="t" className="text-[var(--hs-status-in_review)]">Pending at PayPal</span> : <Time key="t" iso={c.captured_at} />,
        ],
      }))}
    />
  );
}
