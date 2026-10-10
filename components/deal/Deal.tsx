"use client";
// The deal page after first paint (08 section 7.2 layout; 4.2 refetch and polling; 4.3 banners). Server page passes the initial view.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DealPreview, DealView } from "@/lib/deal/types";
import { api, ApiError, errorCopy } from "@/lib/client-api";
import { cancellable } from "@/lib/deal-copy";
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

export function Deal({ initial, demo, paypalClientId }: Props) {
  const [deal, setDeal] = useState(initial);
  const [banner, setBanner] = useState<string | null>(null);
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
  // Newest first; in in_review the review panel already shows the latest attempt.
  const proofs = view ? [...view.submissions].reverse().filter((s) => !(view.status === "in_review" && s === view.submissions.at(-1))) : [];

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <DealHeader deal={deal} onRefresh={() => void refetch()} refreshLabel={expired ? "Check again" : "Refresh"} />
      {banner && (
        <p ref={bannerRef} tabIndex={-1} role="alert" className="hs-banner mt-4 flex items-start gap-3">
          <span className="flex-1">{banner}</span>
          <button type="button" className="underline" onClick={() => setBanner(null)}>Dismiss</button>
        </p>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="grid content-start gap-4 md:col-span-2">
          <WhatNext deal={deal} demo={demo} paypalClientId={paypalClientId} pollExpired={expired} events={events} setDeal={setDeal} refetch={refetch} fail={fail} />
          <TermsCard deal={deal} onImgError={onImgError} />
          {view && proofs.map((s) => <ProofCard key={s.submission_no} sub={s} deal={view} demo={demo} />)}
        </div>
        {view && (
          <aside className="grid content-start gap-4">
            <PayoutCard deal={view} onDone={setDeal} fail={fail} />
            <Timeline events={events} />
            <section className="hs-card grid gap-2 text-sm">
              <a className="hs-link" href={`/api/deals/${view.code}/evidence-pack`}>Download evidence pack (JSON)</a>
              <p className="hs-help">Everything about this deal in one file: terms and versions, photo hashes, each verdict with its reason, PayPal ids, and the full timeline. Built from the database, so it can be reproduced.</p>
              {canCancel && <div><CancelDeal deal={view} onDone={setDeal} fail={fail} /></div>}
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
