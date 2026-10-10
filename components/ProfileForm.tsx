"use client";
// Profile card (08 section 10): display name + PayPal email -> PATCH /api/me, "Saved." toast, `next` return after the paypal_email_required prompt.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Me } from "@/lib/auth/me";
import { api, ApiError, errorCopy } from "@/lib/client-api";
import { toast } from "@/components/Toast";

const DEMO_SELLER = "demo-seller@handshake.demo";

export function ProfileForm({ me, next }: { me: Me; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState(me.display_name ?? "");
  const [email, setEmail] = useState(me.paypal_email ?? "");
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setEmailError(null);
    setError(null);
    try {
      await api("/api/me", { method: "PATCH", json: { ...(name.trim() && { display_name: name.trim() }), ...(email.trim() && { paypal_email: email.trim() }) } });
      toast("Saved.");
      router.refresh(); // header shows the new name
      if (next) router.push(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "not_signed_in") return router.push("/?next=/me");
      if (e instanceof ApiError && e.code === "invalid_input") setEmailError("Enter a valid email address.");
      else setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="hs-card flex flex-col gap-4" onSubmit={submit} noValidate>
      {error && <p role="alert" tabIndex={-1} className="hs-banner">{error}</p>}
      <div>
        <span className="hs-label">Email</span>
        <p className="text-[var(--hs-muted)]">{me.email}</p>
      </div>
      <div>
        <label htmlFor="display_name" className="hs-label">Display name</label>
        <input id="display_name" className="hs-input w-full" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="display_name-help" />
        <p id="display_name-help" className="hs-help mt-1">Shown to the other party instead of your email.</p>
      </div>
      <div>
        <label htmlFor="paypal_email" className="hs-label">PayPal email</label>
        <input id="paypal_email" type="email" className="hs-input w-full" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="paypal_email-help" aria-invalid={!!emailError} />
        {emailError && <p role="alert" className="mt-1 text-sm text-[var(--hs-status-voided)]">{emailError}</p>}
        <p id="paypal_email-help" className="hs-help mt-1">
          Where you&apos;re paid when you sell. Required before you can accept a deal as seller. In the sandbox, use the seller test account&apos;s email from the README.
          {me.email === DEMO_SELLER && " The demo seller's PayPal email is reset each time you switch to this persona."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" data-testid="save-profile" className="hs-btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {next && <Link href={next} className="hs-link text-sm">Back to the deal</Link>}
      </div>
    </form>
  );
}
