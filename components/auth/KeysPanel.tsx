"use client";
// /security: this account's signing keys, one per browser (trust spec §6). Revoking needs a fresh authenticator code.
import { useEffect, useState } from "react";
import type { KeyView } from "@/lib/auth/keys";
import { api } from "@/lib/client-api";
import { devicePublicKey } from "@/lib/contract/device-key";
import { fingerprint } from "@/lib/contract/signature";
import { CodeInput, codeError } from "./CodeInput";

const short = (fp: string) => fp.slice(0, 16).replace(/(.{4})(?!$)/g, "$1 ");

export function KeysPanel({ keys: initial }: { keys: KeyView[] }) {
  const [keys, setKeys] = useState(initial);
  const [mine, setMine] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Only reads a key this browser already has; signing is what creates one.
    indexedDB.databases?.()
      .then(async (dbs) => {
        if (dbs.some((d) => d.name === "handshake")) setMine(await fingerprint(await devicePublicKey()));
      })
      .catch(() => {});
  }, []);

  return (
    <section className="hs-card" aria-labelledby="keys-h">
      <h2 id="keys-h" className="font-semibold">Signing keys</h2>
      <p className="hs-help mt-1">Each browser you sign a contract in gets its own key. The private half never leaves that browser. Revoke a key if you lose the device; contracts it already signed stay valid.</p>
      {keys.length === 0 ? (
        <p className="mt-3 text-sm">No keys yet. One is made the first time you sign a contract.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" data-testid="signing-keys">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--hs-border)] pt-2 text-sm">
              <span className="font-mono">{short(k.fingerprint)}</span>
              {k.fingerprint === mine && <span className="hs-badge">This browser</span>}
              {k.revoked_at && <span className="hs-badge">Revoked</span>}
              <span className="text-[var(--hs-muted)]">{k.signatures} {k.signatures === 1 ? "signature" : "signatures"} · added {new Date(k.created_at).toLocaleDateString()}</span>
              {!k.revoked_at && <button type="button" className="hs-link ml-auto" onClick={() => { setRevoking(k.id); setError(null); }}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
      {revoking && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            setBusy(true);
            api<{ keys: KeyView[] }>(`/api/keys/${revoking}/revoke`, { json: { totp } })
              .then((r) => { setKeys(r.keys); setRevoking(null); setTotp(""); })
              .catch((e) => setError(codeError(e)))
              .finally(() => setBusy(false));
          }}
        >
          <CodeInput id="revoke-code" value={totp} onChange={setTotp} label="Code from your authenticator app" />
          {error && <p className="hs-banner" role="alert">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" className="hs-btn-danger" disabled={busy}>{busy ? "Revoking…" : "Revoke key"}</button>
            <button type="button" className="hs-link text-sm" onClick={() => setRevoking(null)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
