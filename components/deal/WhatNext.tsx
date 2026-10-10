"use client";
// The "What happens next" card (08 sections 7.3 to 7.6) for draft, terms_agreed and held; later states show a placeholder (T-28).
import { useState } from "react";
import type { DealPreview, DealView } from "@/lib/deal/types";
import { ApiError } from "@/lib/client-api";
import { whatNext } from "@/lib/deal-copy";
import { AcceptTerms, Join, ShareLink } from "./Controls";
import { PayButton } from "./PayButton";

type Props = {
  deal: DealView | DealPreview;
  demo: boolean;
  paypalClientId: string;
  pollExpired: boolean;
  setDeal: (d: DealView) => void;
  refetch: () => Promise<DealView | DealPreview | null>;
  fail: (e: unknown) => void;
};

export function WhatNext({ deal, demo, paypalClientId, pollExpired, setDeal, refetch, fail }: Props) {
  const [holdFailed, setHoldFailed] = useState(false);
  const view = deal.role === "preview" ? null : deal;
  const p = view?.payment ?? null;
  const approvedUnconfirmed = p?.status === "approved" && !p.authorization_id;
  const failed = holdFailed || (approvedUnconfirmed && pollExpired);
  const { heading, helper } = whatNext(deal, { holdFailed: failed });

  // 7.6: paypal_error with no authorization stored -> "The hold wasn't confirmed" at once; anything else -> the refetched deal decides.
  const onPayFail = async (e: unknown) => {
    const fresh = await refetch();
    const auth = fresh && fresh.role !== "preview" ? fresh.payment?.authorization_id : null;
    if (e instanceof ApiError && e.code === "paypal_error" && !auth) setHoldFailed(true);
    else if (!(e instanceof ApiError && e.code === "paypal_error")) fail(e);
  };

  const paypalPanel = (
    <div className="mt-4 grid gap-3">
      {demo && (
        <p className="hs-help">
          Sandbox: in the PayPal window, sign in with the test buyer account from the{" "}
          <a className="hs-link" href="https://github.com/0PrashantYadav0/Handshake#readme" target="_blank" rel="noreferrer">README</a>{" "}
          (Testing Tools › Sandbox Accounts). No real money is involved.
        </p>
      )}
      <PayButton key={holdFailed ? "retry" : "first"} code={deal.code} clientId={paypalClientId} onHeld={() => void refetch()} onFail={onPayFail} />
    </div>
  );

  let body: React.ReactNode = null;
  if (!view) body = <Join code={deal.code} onDone={setDeal} fail={fail} />;
  else if (view.seeded) body = <p className="hs-help">This is a seeded sample. It has events but no live PayPal hold, so payment actions are not available.</p>;
  else if (view.status === "draft") {
    const mine = view.role === "buyer" ? view.buyer_accepted_version : view.seller_accepted_version;
    body = (
      <>
        {view.role === "buyer" && !view.seller && <ShareLink code={view.code} />}
        {mine !== view.terms_version ? <AcceptTerms deal={view} onDone={setDeal} fail={fail} /> : <p className="text-sm">You accepted v{mine}.</p>}
      </>
    );
  } else if (view.status === "terms_agreed" && view.role === "buyer") {
    if (p?.status === "approved" && p.authorization_id) body = <button type="button" className="hs-btn-secondary" onClick={() => void refetch()}>Check again</button>;
    else if (approvedUnconfirmed && !failed) body = <button type="button" className="hs-btn-secondary" onClick={() => void refetch()}>Check again</button>;
    else body = paypalPanel;
  }

  return (
    <section className="hs-card" aria-labelledby="next-h">
      <h2 id="next-h" className="text-lg font-semibold">{heading}</h2>
      {helper && <p className="mt-1 text-sm text-[var(--hs-muted)]">{helper}</p>}
      {body && <div className="mt-4 grid gap-3">{body}</div>}
    </section>
  );
}
