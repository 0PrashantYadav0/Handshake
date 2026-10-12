"use client";
// The PayPal hold button (08 section 7.6; decisions E9): legacy V5 provider from the package root, intent "authorize".
// Never import from @paypal/react-paypal-js/sdk-v6 (dependencies.md trap 5).
import { useEffect, useState } from "react";
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { api, errorCopy } from "@/lib/client-api";

const NOT_LOADED = "PayPal's button didn't load. Turn off ad blockers for this site and reload.";

type Props = { code: string; clientId: string; onHeld: () => void; onFail: (e: unknown) => void };

export function PayButton({ code, clientId, onHeld, onFail }: Props) {
  const [waiting, setWaiting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  if (!clientId) return <p className="hs-banner" data-tone="info">{NOT_LOADED}</p>;
  if (waiting) {
    return (
      <div role="status" aria-live="polite" className="rounded-lg border border-[var(--hs-border)] p-4">
        <h3 className="font-semibold">Approved. Placing the hold…</h3>
        <p className="hs-help mt-1">Don&apos;t close this page. This takes a few seconds.</p>
      </div>
    );
  }
  return (
    <div>
      {banner && <p className="hs-banner mb-3" role="alert">{banner}</p>}
      <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "authorize", components: "buttons", dataCspNonce: pageNonce() }}>
        <Buttons
          createOrder={async () => {
            setBanner(null);
            try {
              return (await api<{ order_id: string }>(`/api/deals/${code}/payment`, { method: "POST" })).order_id; // start_payment: stored order or order n+1 (E4)
            } catch (e) {
              setBanner(errorCopy(e));
              throw e;
            }
          }}
          onApprove={async (data) => {
            setWaiting(true);
            try {
              await api(`/api/deals/${code}/payment/authorize`, { json: { order_id: data.orderID } });
              onHeld();
            } catch (e) {
              setWaiting(false);
              onFail(e);
            }
          }}
          onCancel={() => setBanner("You closed PayPal before approving. Nothing was charged. Try again when you're ready.")}
          onError={() => setBanner((b) => b ?? "PayPal returned an error. Try again in a moment, or reload the page.")}
        />
      </PayPalScriptProvider>
      <p className="hs-help mt-2">Secure checkout by PayPal. Handshake never sees your PayPal password.</p>
    </div>
  );
}

// H-2: the page's CSP nonce, for the inline styles and scripts the PayPal SDK adds. Browsers hide the attribute; the property keeps it.
const pageNonce = () => (typeof document === "undefined" ? undefined : document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || undefined);

// Grey block of the button's height until the script resolves; the not-loaded line after 10 s or on a load failure.
function Buttons(props: React.ComponentProps<typeof PayPalButtons>) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  if (isRejected || (isPending && slow)) return <p className="hs-banner" data-tone="info">{NOT_LOADED}</p>;
  return (
    <>
      {isPending && <div aria-hidden className="h-12 rounded bg-[var(--hs-border)]" />}
      <PayPalButtons {...props} />
    </>
  );
}
