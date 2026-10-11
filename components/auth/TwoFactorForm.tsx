"use client";
// /signin/2fa form: a TOTP code or a recovery code; demo personas can fill their published code (trust spec §4).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { CodeInput, codeError } from "./CodeInput";

export function TwoFactorForm({ next, demo }: { next: string; demo: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(codeError(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api<{ recovery_codes_left: number | null }>("/api/auth/2fa/verify", { json: useRecovery ? { recovery_code: recovery } : { code } });
      if (r.recovery_codes_left !== null && r.recovery_codes_left <= 3) {
        setLeft(r.recovery_codes_left);
        return;
      }
      router.push(next);
      router.refresh();
    });
  };
  const fillDemo = () => run(async () => setCode((await api<{ code: string }>("/api/auth/2fa/demo-code")).code));

  if (left !== null) {
    return (
      <div className="hs-card" role="status">
        <p className="font-medium">Signed in with a recovery code. {left} {left === 1 ? "code is" : "codes are"} left.</p>
        <p className="hs-help mt-1">Make a new set on the Security page before you run out.</p>
        <div className="mt-3 flex gap-2">
          <a className="hs-btn" href="/security">Open Security</a>
          <a className="hs-btn-secondary" href={next}>Continue</a>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="hs-card flex flex-col gap-2">
      {error && <p className="hs-banner" role="alert">{error}</p>}
      {useRecovery ? (
        <>
          <label htmlFor="recovery" className="hs-label">Recovery code</label>
          <input id="recovery" className="hs-input font-mono" autoComplete="off" required value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXXX-XXXXX" />
        </>
      ) : (
        <CodeInput id="code" value={code} onChange={setCode} />
      )}
      <button type="submit" data-testid="verify-2fa" className="hs-btn mt-2 self-start" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      <button type="button" className="hs-link self-start text-sm" onClick={() => setUseRecovery(!useRecovery)}>
        {useRecovery ? "Use the authenticator code instead" : "Lost your phone? Use a recovery code"}
      </button>
      {demo && !useRecovery && (
        <div className="mt-3 border-t border-[var(--hs-border)] pt-3">
          <p className="hs-help">Demo account: its authenticator secret is published, so you can fill the current code here.</p>
          <button type="button" data-testid="demo-code" className="hs-btn-secondary mt-2" disabled={busy} onClick={() => void fillDemo()}>Use demo code</button>
        </div>
      )}
    </form>
  );
}
