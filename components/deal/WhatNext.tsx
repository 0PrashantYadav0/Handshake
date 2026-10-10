"use client";
// The "What happens next" card (08 sections 7.3 to 7.10) for every status: the 7.4 heading and helper, then the state's controls.
// `checking` (the seller's evidence POST in flight, 7.8) lives in Deal.tsx so the sticky bar can hide while the wait screen shows.
import { useState } from "react";
import type { DealEvent, DealPreview, DealView } from "@/lib/deal/types";
import { ApiError } from "@/lib/client-api";
import { whatNext } from "@/lib/deal-copy";
import { AcceptTerms, Join, ShareLink } from "./Controls";
import { EvidenceForm } from "./EvidenceForm";
import { PayButton } from "./PayButton";
import { ReviewPanel } from "./ReviewPanel";

type Props = {
  deal: DealView | DealPreview;
  demo: boolean;
  paypalClientId: string;
  pollExpired: boolean;
  events: DealEvent[];
  checking: boolean;
  setChecking: (on: boolean) => void;
  setDeal: (d: DealView) => void;
  refetch: () => Promise<DealView | DealPreview | null>;
  fail: (e: unknown) => void;
};

export function WhatNext({ deal, demo, paypalClientId, pollExpired, events, checking, setChecking, setDeal, refetch, fail }: Props) {
  const [holdFailed, setHoldFailed] = useState(false);
  const [paypalNote, setPaypalNote] = useState<string | null>(null);
  const view = deal.role === "preview" ? null : deal;
  const p = view?.payment ?? null;
  const approvedUnconfirmed = p?.status === "approved" && !p.authorization_id;
  const failed = holdFailed || (approvedUnconfirmed && pollExpired);
  const { heading, helper } = whatNext(checking && view ? { ...view, status: "proof_submitted" } : deal, { holdFailed: failed, events });

  // 7.6: paypal_error with no authorization stored -> "The hold wasn't confirmed" at once; anything else -> the refetched deal decides.
  const onPayFail = async (e: unknown) => {
    const fresh = await refetch();
    const auth = fresh && fresh.role !== "preview" ? fresh.payment?.authorization_id : null;
    if (e instanceof ApiError && e.code === "paypal_error" && !auth) setHoldFailed(true);
    else if (!(e instanceof ApiError && e.code === "paypal_error")) fail(e);
  };

  // 7.8 on 200: show the verdicts and move focus to the decision line of the newest Proof card.
  const onProofDone = (d: DealView) => {
    setChecking(false);
    setDeal(d);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-decision-line]")?.focus());
  };
  // 7.8 on paypal_error: the verdict is stored, the deal stays proof_submitted; Deal.tsx polls until tick finishes the payment step.
  const onPaypalError = async (e: ApiError) => {
    const id = /debug[ _-]?id[=: ]+([A-Za-z0-9-]+)/i.exec(e.message)?.[1];
    setPaypalNote(`PayPal couldn't complete the payment step${id ? ` (debug id ${id})` : ""}. The result is saved; the payment step is retried automatically.`);
    setChecking(false);
    await refetch();
  };

  // 08 section 11: the PayPal iframe gets a heading; data-primary-action lets the sticky bar scroll here (the button itself can't be repeated).
  const paypalPanel = (
    <div className="mt-4 grid gap-3 outline-none" data-primary-action tabIndex={-1} aria-labelledby="paypal-h">
      <h3 id="paypal-h" className="sr-only">Pay with PayPal</h3>
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
        {view.role === "buyer" && !view.seller && <ShareLink code={view.code} title={view.item_title} />}
        {mine !== view.terms_version ? <AcceptTerms deal={view} onDone={setDeal} fail={fail} /> : <p className="text-sm">You accepted v{mine}.</p>}
      </>
    );
  } else if (view.status === "terms_agreed" && view.role === "buyer") {
    if (p?.status === "approved" && p.authorization_id) body = <button type="button" className="hs-btn-secondary" onClick={() => void refetch()}>Check again</button>;
    else if (approvedUnconfirmed && !failed) body = <button type="button" className="hs-btn-secondary" onClick={() => void refetch()}>Check again</button>;
    else body = paypalPanel;
  } else if (view.status === "held" && view.role === "seller") {
    body = <EvidenceForm deal={view} demo={demo} onChecking={setChecking} onDone={onProofDone} onPaypalError={onPaypalError} fail={(e) => { setChecking(false); fail(e); }} />;
  } else if (view.status === "proof_submitted" && paypalNote) {
    body = <p className="hs-banner" data-tone="info" role="status">{paypalNote}</p>;
  } else if (view.status === "in_review") {
    body = <ReviewPanel deal={view} demo={demo} onDone={setDeal} fail={fail} />;
  }

  return (
    <section className="hs-card" aria-labelledby="next-h">
      <h2 id="next-h" className="hs-display text-2xl">{heading}</h2>
      {helper && <p className="mt-2 text-sm leading-relaxed text-[var(--hs-muted)]">{helper}</p>}
      {body && <div className="mt-5 grid gap-3">{body}</div>}
    </section>
  );
}
