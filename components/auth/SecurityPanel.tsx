"use client";
// /security: 2FA status and new recovery codes under step-up (trust spec §4).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";
import type { MfaStatus } from "@/lib/auth/mfa";
import { CodeInput, codeError } from "./CodeInput";
import { RecoveryCodes } from "./RecoveryCodes";

export function SecurityPanel({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = codes ? codes.length : status.recovery_codes_left;
  return (
    <div className="flex flex-col gap-4">
      <section className="hs-card" aria-labelledby="tfa-h">
        <h2 id="tfa-h" className="font-semibold">Two-step sign-in</h2>
        <p className="mt-1" data-testid="mfa-status">
          {status.enabled ? `On since ${new Date(status.enabled_at!).toLocaleDateString()}.` : "Off."} {left} recovery {left === 1 ? "code" : "codes"} left.
        </p>
      </section>
      <section className="hs-card" aria-labelledby="everywhere-h">
        <h2 id="everywhere-h" className="font-semibold">Signed in somewhere else?</h2>
        <p className="hs-help mt-1">Ends every session of this account on every device, this one too. You sign in again with your email and code.</p>
        <button
          type="button" className="hs-btn-danger mt-2" data-testid="sign-out-everywhere"
          onClick={() => void api("/api/auth/sign-out-everywhere", { method: "POST" }).then(() => { router.push("/signin"); router.refresh(); }).catch((e) => setError(codeError(e)))}
        >
          Sign out everywhere
        </button>
      </section>
      {codes ? (
        <RecoveryCodes codes={codes} />
      ) : (
        <form
          className="hs-card flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            setBusy(true);
            setError(null);
            api<{ recovery_codes: string[] }>("/api/auth/2fa/recovery-codes", { json: { totp: code } })
              .then((r) => setCodes(r.recovery_codes))
              .catch((e) => setError(codeError(e)))
              .finally(() => setBusy(false));
          }}
        >
          <h2 className="font-semibold">New recovery codes</h2>
          <p className="hs-help">Your old codes stop working.</p>
          {error && <p className="hs-banner" role="alert">{error}</p>}
          <CodeInput id="regen-code" value={code} onChange={setCode} label="Code from your authenticator app" />
          <button type="submit" className="hs-btn-secondary self-start" disabled={busy}>{busy ? "Making…" : "Make new codes"}</button>
        </form>
      )}
    </div>
  );
}
