"use client";
// /deal/[code]/contract (trust spec §6): the signed contract, re-verified here with WebCrypto, and the signed bundle to download.
// Nothing on this page trusts the server's word: the hash and both signatures are recomputed in the browser.
import { useEffect, useState } from "react";
import type { ContractView, Role } from "@/lib/deal/types";
import { contractHash, shortHash, signingMessage, canonicalJson } from "@/lib/contract/canonical";
import { verifySignature } from "@/lib/contract/signature";
import { money } from "@/lib/ledger-columns";

type Check = { hashOk: boolean; sigs: Partial<Record<Role, boolean>> } | null;

export function ContractVerifier({ contract }: { contract: ContractView }) {
  const { document: doc, signatures } = contract;
  const rule = doc.rule;
  const [check, setCheck] = useState<Check>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const h = await contractHash(doc);
      const sigs: Partial<Record<Role, boolean>> = {};
      for (const s of signatures) sigs[s.role] = s.contract_hash === h && (await verifySignature(s.public_key, signingMessage(h), s.signature));
      if (live) setCheck({ hashOk: h === contract.hash, sigs });
    })().catch(() => live && setCheck({ hashOk: false, sigs: {} }));
    return () => { live = false; };
  }, [doc, signatures, contract.hash]);

  const bundle = {
    format: "handshake-signed-contract/1",
    document: doc,
    contract_hash: contract.hash,
    signed_message: signingMessage(contract.hash),
    signatures: signatures.map((s) => ({ role: s.role, signed_at: s.signed_at, key_fingerprint: s.key_fingerprint, public_key: { kty: "EC", crv: "P-256", ...s.public_key }, signature: s.signature })),
    how_to_verify: "contract_hash = SHA-256 hex of the document as JSON with keys sorted at every level and no whitespace. Each signature is ECDSA P-256 with SHA-256 over the UTF-8 bytes of signed_message, as raw 64-byte r||s in base64url; verify it with the public key (JWK).",
  };
  const href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(bundle, null, 2))}`;
  const badge = (ok: boolean | undefined) =>
    ok === undefined ? <span className="hs-help">Checking…</span>
      : ok ? <span className="hs-badge" data-tone="ok">Verified in your browser</span>
      : <span className="hs-badge" data-tone="bad">Does not verify</span>;

  return (
    <div className="flex flex-col gap-4">
      <section className="hs-card" aria-labelledby="sig-h">
        <h2 id="sig-h" className="font-semibold">Signatures on version {doc.terms_version}</h2>
        <p className="mt-1 text-sm">Contract fingerprint <span className="font-mono" data-testid="contract-hash">{shortHash(contract.hash)}</span>{" "}
          {check && !check.hashOk ? <span className="hs-badge" data-tone="bad">The document does not match its fingerprint</span> : null}
        </p>
        <ul className="mt-3 flex flex-col gap-2" data-testid="signature-list">
          {(["buyer", "seller"] as const).map((role) => {
            const s = signatures.find((x) => x.role === role);
            const party = role === "buyer" ? doc.buyer : doc.seller;
            return (
              <li key={role} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--hs-border)] pt-2 text-sm">
                <span className="w-16 font-medium capitalize">{role}</span>
                <span>{party.email}</span>
                {s ? (
                  <>
                    <span className="text-[var(--hs-muted)]">signed {new Date(s.signed_at).toLocaleString()} with key <span className="font-mono">{shortHash(s.key_fingerprint)}</span></span>
                    <span data-testid={`sig-${role}`}>{badge(check ? check.sigs[role] : undefined)}</span>
                  </>
                ) : <span className="text-[var(--hs-muted)]">has not signed this version</span>}
              </li>
            );
          })}
        </ul>
        <a className="hs-btn-secondary mt-4 inline-flex" href={href} download={`handshake-${doc.code}-v${doc.terms_version}-signed-contract.json`} data-testid="download-contract">Download signed contract</a>
      </section>

      <section className="hs-card" aria-labelledby="terms-h">
        <h2 id="terms-h" className="font-semibold">Terms</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--hs-muted)]">Deal</dt><dd className="font-mono">{doc.code}</dd>
          <dt className="text-[var(--hs-muted)]">Item</dt><dd>{doc.item_title}</dd>
          <dt className="text-[var(--hs-muted)]">Amount</dt><dd>{money(doc.amount_minor)} {doc.currency}</dd>
          <dt className="text-[var(--hs-muted)]">Deadline</dt><dd>{doc.deadline_days} days after PayPal places the hold</dd>
          <dt className="text-[var(--hs-muted)]">Buyer</dt><dd>{doc.buyer.email}</dd>
          <dt className="text-[var(--hs-muted)]">Seller</dt><dd>{doc.seller.email}</dd>
          <dt className="text-[var(--hs-muted)]">Listing photos</dt>
          <dd>{doc.reference_photos.length === 0 ? "None" : <ol className="list-decimal pl-5 font-mono text-xs">{doc.reference_photos.map((p) => <li key={p.position} className="break-all">SHA-256 {p.sha256}</li>)}</ol>}</dd>
        </dl>
        <h3 className="mt-4 text-sm font-semibold">Conditions the seller must prove</h3>
        <ol className="mt-1 list-decimal pl-5 text-sm">{doc.conditions.map((c) => <li key={c.position}>{c.text} <span className="hs-help">({c.evidence_type})</span></li>)}</ol>
        <h3 className="mt-4 text-sm font-semibold">How the money moves</h3>
        <ul className="mt-1 list-disc pl-5 text-sm leading-relaxed">
          <li>PayPal holds the buyer&apos;s money; nothing is charged when the hold is placed.</li>
          <li>Claude checks each condition against the seller&apos;s proof. It never moves money.</li>
          <li>Code releases the money to the seller only if every condition passes with confidence of at least {rule.pass_threshold} and the amount is at most {money(rule.auto_capture_max_minor)}; otherwise the seller gets one chance to fix the proof, or the buyer decides.</li>
          <li>If the deadline passes without passing proof, the hold is voided and the buyer keeps the money.</li>
          <li>Before any money moves, both signatures are checked against these exact terms.</li>
        </ul>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm">Exact signed document (canonical JSON)</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-[var(--hs-bg)] p-3 text-xs" data-testid="canonical-json">{canonicalJson(doc)}</pre>
        </details>
      </section>
    </div>
  );
}
