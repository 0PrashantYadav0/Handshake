"use client";
// The payout address card (trust spec §8): new address + authenticator code -> emailed 6-digit code -> verified.
// Used on /me and inline when a seller accepts without a verified address.
import { useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import type { Me } from "@/lib/auth/me";
import { CodeInput, codeError } from "@/components/auth/CodeInput";

type Props = { current: string | null; verified: boolean; onVerified?: () => void | Promise<void>; demoSeller?: boolean };

export function PayoutEmailForm({ current, verified: initiallyVerified, onVerified, demoSeller }: Props) {
  const [email, setEmail] = useState(current ?? "");
  const [saved, setSaved] = useState(current);
  const [verified, setVerified] = useState(initiallyVerified);
  const [editing, setEditing] = useState(!current);
  const [totp, setTotp] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "invalid_input" && !e.message.includes("code") ? "Enter a valid email address." : codeError(e));
    } finally {
      setBusy(false);
    }
  };
  const done = async (me: Me) => {
    setSaved(me.paypal_email);
    setVerified(me.paypal_email_verified);
    if (me.paypal_email_verified) await onVerified?.();
  };

  if (verified && !editing) {
    return (
      <section className="hs-card" aria-labelledby="payout-h" data-testid="payout-email-card">
        <h2 id="payout-h" className="font-semibold">Where you&apos;re paid</h2>
        <p className="mt-1"><span className="font-mono">{saved}</span> <span className="hs-badge ml-2">Verified</span></p>
        {demoSeller && <p className="hs-help mt-1">The demo seller&apos;s sandbox address is reset each time you switch to this persona.</p>}
        <button type="button" className="hs-link mt-2 text-sm" onClick={() => setEditing(true)}>Change</button>
      </section>
    );
  }
  if (saved && !verified && !editing) {
    return (
      <form
        className="hs-card flex flex-col gap-2" aria-labelledby="payout-h" data-testid="payout-email-card"
        onSubmit={(ev) => {
          ev.preventDefault();
          void run(async () => done((await api<{ user: Me }>("/api/me/paypal-email/verify", { json: { code } })).user));
        }}
      >
        <h2 id="payout-h" className="font-semibold">Confirm your PayPal email</h2>
        <p className="hs-help">We emailed a 6-digit code to <span className="font-mono">{saved}</span>. It proves the address is yours before any money is sent there.</p>
        {error && <p className="hs-banner" role="alert">{error}</p>}
        {note && <p className="hs-help" role="status">{note}</p>}
        <CodeInput id="payout-code" value={code} onChange={setCode} label="Code from the email" />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="hs-btn" data-testid="verify-payout-email" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button>
          <button type="button" className="hs-btn-secondary" disabled={busy} onClick={() => run(async () => { await api("/api/me/paypal-email/resend", { method: "POST" }); setNote("A new code is on its way."); })}>Send a new code</button>
          <button type="button" className="hs-link text-sm" onClick={() => setEditing(true)}>Use a different address</button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="hs-card flex flex-col gap-2" aria-labelledby="payout-h" data-testid="payout-email-card"
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(async () => {
          await done((await api<{ user: Me }>("/api/me", { method: "PATCH", json: { paypal_email: email.trim(), totp } })).user);
          setEditing(false);
          setTotp("");
        });
      }}
    >
      <h2 id="payout-h" className="font-semibold">Where you&apos;re paid</h2>
      <label htmlFor="paypal_email" className="hs-label">PayPal email</label>
      <input id="paypal_email" type="email" required className="hs-input" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="paypal_email-help" />
      <p id="paypal_email-help" className="hs-help">Payouts go only to a confirmed address. In the sandbox, use the seller test account&apos;s email from the README.</p>
      <CodeInput id="payout-totp" value={totp} onChange={setTotp} label="Code from your authenticator app" />
      {error && <p className="hs-banner" role="alert">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" className="hs-btn" data-testid="save-payout-email" disabled={busy}>{busy ? "Saving…" : "Save and send code"}</button>
        {saved && <button type="button" className="hs-link text-sm" onClick={() => { setEditing(false); setEmail(saved); }}>Cancel</button>}
      </div>
    </form>
  );
}
