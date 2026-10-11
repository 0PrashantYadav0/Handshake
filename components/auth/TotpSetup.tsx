"use client";
// /security/setup: QR + secret, confirm with one code, then the recovery codes (trust spec §4).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { CodeInput, codeError } from "./CodeInput";
import { RecoveryCodes } from "./RecoveryCodes";

type Setup = { secret: string; otpauth_uri: string; qr_svg: string };

export function TotpSetup({ next }: { next: string }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-medium" role="status">Two-step sign-in is on.</p>
        <RecoveryCodes codes={codes} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="codes-saved" />
          I saved my recovery codes
        </label>
        <button type="button" className="hs-btn self-start" disabled={!saved} data-testid="setup-continue" onClick={() => { router.push(next); router.refresh(); }}>Continue</button>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="hs-card">
        {error && <p className="hs-banner mb-3" role="alert">{error}</p>}
        <p>You need an authenticator app such as Google Authenticator, 1Password, Authy or Microsoft Authenticator.</p>
        <button type="button" className="hs-btn mt-4" data-testid="start-setup" disabled={busy} onClick={() => run(async () => setSetup(await api<Setup>("/api/auth/2fa/setup", { method: "POST" })))}>
          {busy ? "Preparing…" : "Show my QR code"}
        </button>
      </div>
    );
  }
  return (
    <form
      className="hs-card flex flex-col gap-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(async () => setCodes((await api<{ recovery_codes: string[] }>("/api/auth/2fa/enable", { json: { code } })).recovery_codes));
      }}
    >
      {error && <p className="hs-banner" role="alert">{error}</p>}
      <p>1. Scan this code with your authenticator app.</p>
      {/* The SVG is generated on our server from the otpauth URI; it carries no user-supplied markup. */}
      <div className="w-48 rounded bg-white p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
      <p className="hs-help">Can&apos;t scan? Enter this key by hand:</p>
      <code className="break-all font-mono text-sm" data-testid="totp-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
      <p className="mt-2">2. Enter the 6-digit code the app shows.</p>
      <CodeInput id="code" value={code} onChange={setCode} />
      <button type="submit" className="hs-btn self-start" data-testid="enable-2fa" disabled={busy}>{busy ? "Checking…" : "Turn on"}</button>
    </form>
  );
}
