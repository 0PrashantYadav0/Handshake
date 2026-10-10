"use client";
// /new step 4 (08 section 6.4): the link, "Copy link" only in the first pass (4.6). CopyButton is shared with step 2.
import { useState } from "react";
import Link from "next/link";
import type { DealView } from "@/lib/deal/types";

export function CopyButton({ text, label = "Copy", className = "hs-btn-secondary" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function ShareLink({ deal }: { deal: DealView }) {
  const url = `${typeof window === "undefined" ? "" : location.origin}/deal/${deal.code}`;
  return (
    <section>
      <h2 className="text-2xl font-semibold">Send this link to the seller</h2>
      <label htmlFor="share-url" className="mt-4 block text-sm font-medium">Deal link</label>
      <div className="mt-1 flex gap-2">
        <input id="share-url" className="hs-input w-full" readOnly value={url} onFocus={(e) => e.target.select()} />
        <CopyButton text={url} label="Copy link" />
      </div>
      <p className="mt-4 text-sm">You accepted version {deal.terms_version}.</p>
      <p className="mt-1 text-sm text-[var(--hs-muted)]">
        The seller signs in, adds their PayPal email and accepts. Then you approve the hold with PayPal on the deal page.
      </p>
      <div className="mt-6 flex items-center gap-4">
        <Link href={`/deal/${deal.code}`} className="hs-btn">Open deal page</Link>
        {/* a plain anchor: a full load is what resets the flow state */}
        <a href="/new" className="text-sm font-medium text-[var(--hs-accent)]">New deal</a>
      </div>
    </section>
  );
}
