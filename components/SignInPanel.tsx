"use client";
// The sign-in card of / (08 section 5): demo personas, the magic-link form, the signed-in state.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorCopy } from "@/lib/client-api";

type Props = { demo: boolean; dev: boolean; name: string | null; next: string | null; invalidLink: boolean };

export function SignInPanel({ demo, dev, name, next, invalidLink }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(invalidLink ? "That link has expired or was already used. Request a new one." : null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  const persona = (p: "buyer" | "seller") =>
    run(async () => {
      await api("/api/auth/demo", { json: { persona: p } });
      router.push(`/signin/2fa?next=${encodeURIComponent(next ?? (p === "buyer" ? "/new" : "/dashboard"))}`);
    });
  const magic = (ev: React.FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      await api("/api/auth/magic-link", { json: { email, ...(next && { next }) } });
      setSent(true);
    });
  };

  if (name) {
    return (
      <section className="hs-card">
        <h2 className="text-lg font-semibold">You&apos;re signed in as {name}.</h2>
        <div className="mt-4 flex gap-2">
          <Link href="/new" className="hs-btn">New deal</Link>
          <Link href="/dashboard" className="hs-btn-secondary">Your dashboard</Link>
        </div>
      </section>
    );
  }
  return (
    <section className="hs-card" aria-labelledby="signin-h">
      <h2 id="signin-h" className="text-lg font-semibold">{next ? "Sign in to continue" : demo ? "Try the demo" : "Sign in"}</h2>
      {error && <p className="hs-banner mt-3" role="alert">{error}</p>}
      {demo && (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="hs-btn" data-testid="persona-buyer" disabled={busy} onClick={() => persona("buyer")}>Continue as buyer</button>
            <button type="button" className="hs-btn-secondary" data-testid="persona-seller" disabled={busy} onClick={() => persona("seller")}>Continue as seller</button>
          </div>
          <p className="hs-help mt-2">Two seeded accounts. Switch sides any time from the header.</p>
          <p className="my-4 text-center text-sm text-[var(--hs-muted)]">or</p>
        </>
      )}
      {sent ? (
        <div className="mt-4" aria-live="polite">
          <p className="font-medium">Check your email.</p>
          <p className="hs-help">The link works for 15 minutes.</p>
          {dev && <p className="hs-help">Development: the link is printed to the server console.</p>}
        </div>
      ) : (
        <form onSubmit={magic} className="mt-4 flex flex-col gap-2">
          <label htmlFor="email" className="hs-label">Email</label>
          <input id="email" type="email" required className="hs-input" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="email-help" />
          <button type="submit" className="hs-btn mt-1 justify-center" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
          <p id="email-help" className="hs-help">No password. After the link you enter a code from your authenticator app; then you stay signed in on this device for 30 days.</p>
        </form>
      )}
    </section>
  );
}
