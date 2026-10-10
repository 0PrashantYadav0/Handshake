"use client";
// The deal page after first paint (08 section 7.2 layout; 4.2 refetch and polling; 4.3 banners). Server page passes the initial view.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DealPreview, DealView } from "@/lib/deal/types";
import { api, ApiError, errorCopy } from "@/lib/client-api";
import { when } from "@/lib/ledger-columns";
import { CancelDeal } from "./Controls";
import { DealHeader } from "./DealHeader";
import { TermsCard } from "./TermsCard";
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
  const polling = !!view && !view.seeded && (view.status === "draft" || view.status === "terms_agreed");
  const expired = usePoll(polling, refetch);
  const onImgError = () => {
    if (imgRetried.current) return;
    imgRetried.current = true;
    void refetch();
  };
  const cancellable = !!view && !view.seeded && ["draft", "terms_agreed", "held"].includes(view.status);

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
          <WhatNext deal={deal} demo={demo} paypalClientId={paypalClientId} pollExpired={expired} setDeal={setDeal} refetch={refetch} fail={fail} />
          <TermsCard deal={deal} onImgError={onImgError} />
        </div>
        {view && (
          <aside className="grid content-start gap-4">
            {view.payment && (
              <section className="hs-card text-sm">
                <h2 className="font-semibold">Payment</h2>
                {view.payment.authorized_at && <p className="mt-2" title={view.payment.authorized_at}>Hold placed {when(view.payment.authorized_at)}</p>}
                {view.payment.auth_expires_at && <p title={view.payment.auth_expires_at}>Hold valid until {when(view.payment.auth_expires_at)}</p>}
                {view.payment.capture_id && <p>Capture {view.payment.capture_id}</p>}
              </section>
            )}
            <section className="hs-card grid gap-2 text-sm">
              <a className="hs-link" href={`/api/deals/${view.code}/evidence-pack`}>Download evidence pack (JSON)</a>
              <p className="hs-help">Everything about this deal in one file: terms and versions, photo hashes, each verdict with its reason, PayPal ids, and the full timeline.</p>
              {cancellable && <div><CancelDeal deal={view} onDone={setDeal} fail={fail} /></div>}
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
