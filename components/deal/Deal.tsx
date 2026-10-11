"use client";
// The deal page after first paint (08 section 7.2 layout; 4.2 refetch and polling; 4.3 banners). Server page passes the initial view.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DealPreview, DealView } from "@/lib/deal/types";
import { api, ApiError, errorCopy } from "@/lib/client-api";
import { cancellable, primaryAction } from "@/lib/deal-copy";
import { CancelDeal } from "./Controls";
import { DealHeader } from "./DealHeader";
import { PayoutCard } from "./PayoutCard";
import { ProofCard } from "./ProofCard";
import { TermsCard } from "./TermsCard";
import { Timeline, useEvents } from "./Timeline";
import { WhatNext } from "./WhatNext";

type Props = { initial: DealView | DealPreview; demo: boolean; paypalClientId: string };

/** Every 5 s while the tab is visible, 2 minutes at most (08 section 4.2); true once the budget is spent. */
function usePoll(active: boolean, fn: () => Promise<unknown>): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++ticks > 24) {
        clearInterval(id);
        setExpired(true);
        return;
      }
      void fn();
    }, 5000);
    return () => clearInterval(id);
  }, [active, fn]);
  return expired;
}

const POLLED = ["draft", "terms_agreed", "proof_submitted"];

/** 08 section 7.2 item 3 (phones only, CSS): forwards to the card's [data-primary-action]; a disabled or non-button target is scrolled to instead. */
function StickyBar({ label }: { label: string }) {
  const go = () => {
    const el = document.querySelector<HTMLElement>("[data-primary-action]");
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (el instanceof HTMLButtonElement && !el.disabled) el.click();
    else el.focus();
  };
  return (
    <div className="hs-sticky">
      <button type="button" className="hs-btn w-full" data-testid="sticky-action" onClick={go}>{label}</button>
    </div>
  );
}

export function Deal({ initial, demo, paypalClientId }: Props) {
  const [deal, setDeal] = useState(initial);
  const [banner, setBanner] = useState<string | null>(null);
  const [checking, setChecking] = useState(false); // the seller's evidence POST is in flight (7.8)
  const bannerRef = useRef<HTMLParagraphElement>(null);
  const imgRetried = useRef(false);
  const code = initial.code;

  const refetch = useCallback(async () => {
    try {
      const d = await api<DealView | DealPreview>(`/api/deals/${code}`);
      setDeal(d);
      return d;
    } catch (e) {
      setBanner(errorCopy(e));
      return null;
    }
  }, [code]);
  const fail = useCallback((e: unknown) => {
    setBanner(errorCopy(e));
    if (e instanceof ApiError && (e.code === "invalid_state" || e.code === "terms_version_mismatch")) void refetch();
  }, [refetch]);
  useEffect(() => bannerRef.current?.focus(), [banner]);

  const view = deal.role === "preview" ? null : deal;
  const polling = !!view && !view.seeded && POLLED.includes(view.status);
  const expired = usePoll(polling, refetch);
  const events = useEvents(code, view?.updated_at ?? "");
  const onImgError = () => {
    if (imgRetried.current) return;
    imgRetried.current = true;
    void refetch();
  };
  const canCancel = !!view && !view.seeded && cancellable(view.status);
  const sticky = checking ? null : primaryAction(deal);
  // Newest first; in in_review the review panel already shows the latest attempt.
  const proofs = view ? [...view.submissions].reverse().filter((s) => !(view.status === "in_review" && s === view.submissions.at(-1))) : [];

  return (
    <main className={`mx-auto max-w-5xl p-4 md:p-8 ${sticky ? "pb-28 md:pb-8" : ""}`}>
      <DealHeader deal={deal} onRefresh={() => void refetch()} refreshLabel={expired ? "Check again" : "Refresh"} />
      {banner && (
        <p ref={bannerRef} tabIndex={-1} role="alert" className="hs-banner mt-4 flex items-start gap-3">
          <span className="flex-1">{banner}</span>
          <button type="button" className="underline" onClick={() => setBanner(null)}>Dismiss</button>
        </p>
      )}
      <div className="mt-8 grid gap-4 md:grid-cols-3 md:gap-6">
        <div className="grid content-start gap-4 md:col-span-2">
          <WhatNext deal={deal} demo={demo} paypalClientId={paypalClientId} pollExpired={expired} events={events} checking={checking} setChecking={setChecking} setDeal={setDeal} refetch={refetch} fail={fail} />
          <TermsCard deal={deal} onImgError={onImgError} />
          {view && proofs.map((s) => <ProofCard key={s.submission_no} sub={s} deal={view} demo={demo} />)}
        </div>
        {view && (
          <aside className="grid content-start gap-4">
            <PayoutCard deal={view} onDone={setDeal} fail={fail} />
            <Timeline events={events} />
            <section className="hs-card grid gap-2 text-sm" aria-labelledby="more-h">
              <h2 id="more-h" className="font-semibold">Records</h2>
              {view.contract && <a className="hs-link" href={`/deal/${view.code}/contract`} data-testid="contract-link">Contract and signatures</a>}
              <a className="hs-link" href={`/api/deals/${view.code}/evidence-pack`}>Download evidence pack (JSON)</a>
              <p className="hs-help">Everything about this deal in one file: terms and versions, photo hashes, each verdict with its reason, PayPal ids, and the full timeline. Built from the database, so it can be reproduced.</p>
              {canCancel && <div className="mt-2 border-t border-[var(--hs-border)] pt-3"><CancelDeal deal={view} onDone={setDeal} fail={fail} /></div>}
            </section>
          </aside>
        )}
      </div>
      {sticky && <StickyBar label={sticky} />}
    </main>
  );
}
