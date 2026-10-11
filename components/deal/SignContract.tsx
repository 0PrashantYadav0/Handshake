"use client";
// Sign the contract (trust spec §6): re-hash the document shown here, sign the hash with this browser's key, and send it
// with a fresh authenticator code. The server recomputes the hash from its own rows and refuses any mismatch.
import { useState } from "react";
import Link from "next/link";
import type { DealView } from "@/lib/deal/types";
import { api } from "@/lib/client-api";
import { money } from "@/lib/ledger-columns";
import { contractHash, shortHash, signingMessage } from "@/lib/contract/canonical";
import { signWithDevice } from "@/lib/contract/device-key";
import { CodeInput, codeError } from "@/components/auth/CodeInput";

export function SignContract({ deal, onDone }: { deal: DealView; onDone: (d: DealView) => void }) {
  const [totp, setTotp] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = deal.contract;
  if (!c) return null;
  const doc = c.document;
  const other = deal.role === "buyer" ? "seller" : "buyer";
  const otherSigned = c.signatures.some((s) => s.role === other);

  const sign = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const hash = await contractHash(doc);
      if (hash !== c.hash) throw new Error("The contract on this page doesn't match its fingerprint. Reload the page before signing.");
      const { signature, public_key } = await signWithDevice(signingMessage(hash));
      onDone(await api<DealView>(`/api/deals/${deal.code}/accept`, { json: { terms_version: doc.terms_version, contract_hash: hash, signature, public_key, totp } }));
    } catch (e) {
      setError(codeError(e));
      setTotp("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={sign} className="flex flex-col gap-3 rounded-lg border border-[var(--hs-border)] p-4" aria-labelledby="sign-h" data-testid="sign-contract">
      <h3 id="sign-h" className="font-semibold">Sign version {doc.terms_version}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[var(--hs-muted)]">Item</dt><dd>{doc.item_title}</dd>
        <dt className="text-[var(--hs-muted)]">Amount</dt><dd>{money(doc.amount_minor)}</dd>
        <dt className="text-[var(--hs-muted)]">Deadline</dt><dd>{doc.deadline_days} days after the hold</dd>
        <dt className="text-[var(--hs-muted)]">Buyer</dt><dd>{doc.buyer.email}</dd>
        <dt className="text-[var(--hs-muted)]">Seller</dt><dd>{doc.seller.email}</dd>
        <dt className="text-[var(--hs-muted)]">Conditions</dt>
        <dd><ol className="list-decimal pl-5">{doc.conditions.map((x) => <li key={x.position}>{x.text}</li>)}</ol></dd>
        <dt className="text-[var(--hs-muted)]">Listing photos</dt><dd>{doc.reference_photos.length || "None"}{doc.reference_photos.length ? " (fingerprinted in the contract)" : ""}</dd>
        <dt className="text-[var(--hs-muted)]">Rule</dt><dd>Released only if every condition passes at confidence {doc.rule.pass_threshold} or more, up to {money(doc.rule.auto_capture_max_minor)}; above that the buyer decides.</dd>
        <dt className="text-[var(--hs-muted)]">Contract fingerprint</dt><dd className="font-mono" data-testid="contract-fingerprint">{shortHash(c.hash)}</dd>
      </dl>
      <p className="hs-help">
        {otherSigned ? `The ${other} has signed this version. ` : ""}Your signature is made by a key that stays in this browser.{" "}
        <Link className="hs-link" href={`/deal/${deal.code}/contract`}>See the full contract</Link>
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="sign-agree" className="mt-1" />
        <span>I agree to these terms. Money moves only as the rule on the contract page describes.</span>
      </label>
      <CodeInput id="sign-totp" value={totp} onChange={setTotp} label="Code from your authenticator app" />
      {error && <p className="hs-banner" role="alert">{error}</p>}
      <button type="submit" className="hs-btn self-start" data-testid="accept-terms" data-primary-action disabled={busy || !agree}>
        {busy ? "Signing…" : "Sign contract"}
      </button>
    </form>
  );
}
