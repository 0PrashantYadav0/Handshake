// /dashboard, home after sign-in (trust spec §10): four money figures, "Needs you", Buying and Selling, the security card.
// Full (second-factor) session only. The AG Studio analytics moved to /dashboard/studio.
import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current";
import { listKeys } from "@/lib/auth/keys";
import { mfaStatus } from "@/lib/auth/mfa";
import { getAccountSummary, type DealLine } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { formatUsd } from "@/lib/money";
import { relTime } from "@/lib/ledger-columns";
import { StatusPill } from "@/components/StatusPill";
import { Table, Time } from "@/components/Table";

export default async function DashboardPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/dashboard");
  const deps = getDeps();
  const [s, mfa, keys] = await Promise.all([getAccountSummary({ user_id: me.id }, deps), mfaStatus(me.id, deps.db), listKeys(me.id, deps.db)]);
  const f = s.figures;
  const activeKeys = keys.filter((k) => !k.revoked_at).length;
  const fresh = s.buying.length + s.selling.length === 0;

  const figures = [
    { label: "On hold as buyer", value: f.on_hold_as_buyer, help: "Held on your PayPal. Nothing charged yet." },
    { label: "Held for you", value: f.held_for_you_as_seller, help: "Released to you when your proof passes." },
    { label: "Released to you this month", value: f.released_to_you, help: f.you_paid ? `You released ${formatUsd(f.you_paid)} to sellers this month.` : "Since the 1st of the month (UTC)." },
    { label: "Paid out to you", value: f.paid_out_to_you, help: "Sent to your PayPal, all time." },
  ];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="hs-display text-4xl">Dashboard</h1>
          <p className="mt-1 text-[var(--hs-muted)]">Hello, {me.display_name ?? me.email}. Amounts are in USD; sample deals are listed but not counted.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/new" className="hs-btn">New deal</Link>
          <Link href="/dashboard/studio" className="hs-btn-secondary">Open analytics studio</Link>
        </div>
      </div>

      <section aria-labelledby="money-h">
        <h2 id="money-h" className="sr-only">Your money</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {figures.map((x) => (
            <div key={x.label} className="hs-card">
              <dt className="text-sm text-[var(--hs-muted)]">{x.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums md:text-3xl" data-testid="figure">{formatUsd(x.value)}</dd>
              <dd className="hs-help mt-1">{x.help}</dd>
            </div>
          ))}
        </dl>
      </section>

      {fresh && (
        <section className="hs-card" aria-labelledby="start-h">
          <h2 id="start-h" className="text-lg font-semibold">No deals yet</h2>
          <p className="mt-1 text-[var(--hs-muted)]">Describe what you&apos;re buying in one sentence. PayPal holds the money until the seller&apos;s proof checks out.</p>
          <Link href="/new" className="hs-btn mt-4">Start your first deal</Link>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="hs-card lg:col-span-2" aria-labelledby="needs-h">
          <h2 id="needs-h" className="text-lg font-semibold">Needs you</h2>
          {s.needs_you.length === 0 ? (
            <p className="mt-1 text-[var(--hs-muted)]">Nothing needs you right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--hs-border)]">
              {s.needs_you.map((n) => (
                <li key={`${n.code}-${n.action}`} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{n.item_title}{n.code && <span className="ml-2 font-mono text-xs whitespace-nowrap text-[var(--hs-muted)]">{n.code}</span>}</p>
                    <p className="hs-help">{n.detail}</p>
                  </div>
                  <Link href={n.href} className="hs-btn-secondary">{n.action}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="hs-card" aria-labelledby="sec-h">
          <h2 id="sec-h" className="text-lg font-semibold">Security</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-[var(--hs-muted)]">Two-step sign-in</dt>
            <dd>{mfa.enabled ? <>On since <Time iso={mfa.enabled_at} /></> : "Off"}</dd>
            <dt className="text-[var(--hs-muted)]">Recovery codes</dt>
            <dd>{mfa.recovery_codes_left} left</dd>
            <dt className="text-[var(--hs-muted)]">Signing keys</dt>
            <dd>{activeKeys} active</dd>
            <dt className="text-[var(--hs-muted)]">Payout email</dt>
            <dd className="min-w-0 break-all">{me.paypal_email ? `${me.paypal_email} (${me.paypal_email_verified ? "verified" : "not verified"})` : "Not set"}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/security" className="hs-link">Manage security</Link>
            <Link href="/me" className="hs-link">Profile and payout email</Link>
          </div>
        </section>
      </div>

      <DealTable caption="Buying" other="Seller" rows={s.buying} empty={<>You haven&apos;t bought anything yet. <Link href="/new" className="hs-link">Start a deal</Link>.</>} />
      <DealTable caption="Selling" other="Buyer" rows={s.selling} empty="When a buyer shares a deal link with you and you join, it shows up here." />
    </main>
  );
}

function DealTable({ caption, other, rows, empty }: { caption: string; other: string; rows: DealLine[]; empty: React.ReactNode }) {
  return (
    <Table
      caption={caption}
      head={["Item", other, "Amount", "Status", "Next step", "Deadline"]}
      empty={empty}
      rows={rows.map((r) => ({
        key: r.code,
        cells: [
          <Fragment key="i">
            <Link href={`/deal/${r.code}`} className="hs-link font-medium">{r.item_title}</Link>
            <span className="block font-mono text-xs text-[var(--hs-muted)]">{r.code}</span>
            {r.seeded && <span className="hs-badge mt-1">Sample deal</span>}
          </Fragment>,
          r.other_party ?? <span key="o" className="text-[var(--hs-muted)]">Not joined yet</span>,
          <span key="m" className="tabular-nums">{r.amount_minor == null ? "—" : formatUsd(r.amount_minor)}</span>,
          <StatusPill key="s" status={r.status} />,
          r.next,
          r.deadline_at ? <Fragment key="t"><Time iso={r.deadline_at} /><span className="block text-xs text-[var(--hs-muted)]">{relTime(r.deadline_at)}</span></Fragment> : "—",
        ],
      }))}
    />
  );
}
