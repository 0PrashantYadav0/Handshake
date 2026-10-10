"use client";
// /new step 4 (08 section 6.4): the link, "Copy link" and, where navigator.share exists, "Share…". CopyButton and ShareButton are shared with the deal page.
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { DealView } from "@/lib/deal/types";
import { toast } from "@/components/Toast";

export function CopyButton({ text, label = "Copy", className = "hs-btn-secondary" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast("Copied");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast("Couldn't copy. Select the text and copy it yourself.", "error");
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

const noop = () => () => {};
const canShare = () => typeof navigator.share === "function";

/** Rendered only on devices with the Web Share API (phones, mostly); nothing on the server or on desktop browsers without it. */
export function ShareButton({ url, title, className = "hs-btn-secondary" }: { url: string; title: string; className?: string }) {
  const supported = useSyncExternalStore(noop, canShare, () => false);
  if (!supported) return null;
  return (
    <button type="button" className={className} onClick={() => navigator.share({ title, url }).catch(() => {})}>
      Share…
    </button>
  );
}

export function ShareLink({ deal }: { deal: DealView }) {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const url = `${origin}/deal/${deal.code}`;
  return (
    <section>
      <h1 className="text-3xl md:text-4xl">Send this link to the seller</h1>
      <label htmlFor="share-url" className="hs-label mt-6">Deal link</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="share-url" className="hs-input min-w-0 flex-1 font-mono text-sm" readOnly value={url} onFocus={(e) => e.target.select()} />
        <CopyButton text={url} label="Copy link" />
        <ShareButton url={url} title={`Handshake deal ${deal.code}: ${deal.item_title}`} />
      </div>
      <p className="mt-5 text-sm">You accepted version {deal.terms_version}.</p>
      <p className="hs-help mt-1">
        The seller signs in, adds their PayPal email and accepts. Then you approve the hold with PayPal on the deal page.
      </p>
      <div className="mt-6 flex items-center gap-4">
        <Link href={`/deal/${deal.code}`} className="hs-btn">Open deal page</Link>
        {/* a plain anchor: a full load is what resets the flow state */}
        <a href="/new" className="hs-link text-sm font-medium">New deal</a>
      </div>
    </section>
  );
}
