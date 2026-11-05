"use client";
// Make and revoke agent keys, and copy the MCP connection (docs/agents.md). A new key asks for a fresh authenticator code.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CodeInput, codeError } from "@/components/auth/CodeInput";
import { api, errorCopy } from "@/lib/client-api";
import { money } from "@/lib/ledger-columns";

export type KeyRow = { id: string; label: string; token_hint: string; max_amount_minor: number; last_used_at: string | null; revoked_at: string | null };

export function AgentKeysPanel({ keys, demo, appUrl }: { keys: KeyRow[]; demo: boolean; appUrl: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("My shopping agent");
  const [ceiling, setCeiling] = useState("25");
  const [totp, setTotp] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = keys.filter((k) => !k.revoked_at);

  const make = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setToken((await api<{ token: string }>("/api/agents/keys", { json: { label, max_usd: Number(ceiling), totp } })).token);
      setTotp("");
      router.refresh();
    } catch (e) {
      setError(codeError(e));
    } finally {
      setBusy(false);
    }
  };
  const fillDemo = async () => {
    setError(null);
    try {
      setTotp((await api<{ code: string }>("/api/auth/2fa/demo-code")).code);
    } catch (e) {
      setError(codeError(e));
    }
  };
  const revoke = async (id: string) => {
    try {
      await api(`/api/agents/keys/${id}/revoke`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(errorCopy(e));
    }
  };

  return (
    <section className="hs-card p-5" data-testid="agent-keys">
      <h2 className="hs-display text-2xl">Connect your own agent</h2>
      <p className="hs-help mt-1 text-[0.95rem]">Handshake is an MCP server, so Claude or any agent that speaks MCP can use it. A key can propose, sign and prove, up to the ceiling you set. It can never approve a hold or release a payment.</p>
      <form onSubmit={make} className="mt-4 grid gap-3 md:grid-cols-[1fr_8rem_12rem_auto] md:items-end">
        <div><label className="hs-label" htmlFor="agent-label">Agent name</label><input id="agent-label" className="hs-input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} required /></div>
        <div><label className="hs-label" htmlFor="agent-ceiling">Ceiling, USD</label><input id="agent-ceiling" className="hs-input" type="number" min={1} max={1000} value={ceiling} onChange={(e) => setCeiling(e.target.value)} required /></div>
        <div>
          <CodeInput id="agent-totp" value={totp} onChange={setTotp} label="Authenticator code" />
          {demo && <button type="button" className="hs-link mt-1 text-xs" onClick={fillDemo} data-testid="agent-demo-code">Fill the demo code</button>}
        </div>
        <button className="hs-btn" disabled={busy || !totp} data-testid="agent-make">Make a key</button>
      </form>
      {error && <p className="hs-banner mt-3" role="alert">{error}</p>}
      {token && (
        <div className="mt-4 rounded-lg border border-[var(--hs-accent)] p-3" data-testid="agent-token">
          <p className="text-sm font-semibold">Copy this now. It is shown once and stored only as a hash.</p>
          <pre className="mt-2 overflow-x-auto font-mono text-xs">{`claude mcp add --transport http handshake ${appUrl}/api/mcp \\\n  --header "Authorization: Bearer ${token}"`}</pre>
        </div>
      )}
      {live.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--hs-border)] text-sm">
          {live.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{k.label} <span className="font-mono text-xs text-[var(--hs-muted)]">{k.token_hint}…</span></span>
              <span className="flex items-center gap-3">
                <span className="text-[var(--hs-muted)]">up to {money(k.max_amount_minor)}{k.last_used_at ? " · used" : ""}</span>
                <button type="button" className="hs-btn-secondary hs-btn-danger min-h-8 rounded border text-xs" onClick={() => revoke(k.id)}>Revoke</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
