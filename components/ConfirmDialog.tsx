"use client";
// Confirmation dialog (08 sections 4.5, 11): a native <dialog>, so showModal() gives the focus trap, Escape and focus return for free.
// `confirm()` resolves true for the action, false for "Go back", Escape or a backdrop click. ConfirmHost is mounted once in app/layout.tsx.
import { useEffect, useRef, useState } from "react";

export type ConfirmOptions = { title: string; sentence: string; action: string; tone?: "primary" | "danger" };
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let open: ((p: Pending) => void) | null = null;

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => (open ? open({ ...opts, resolve }) : resolve(false)));
}

export function ConfirmHost() {
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useRef<Pending | null>(null);
  const [p, setP] = useState<ConfirmOptions | null>(null);

  useEffect(() => {
    open = (next) => {
      pending.current?.resolve(false); // ponytail: one dialog at a time; a second request cancels the first
      pending.current = next;
      setP(next);
    };
    return () => { open = null; };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!p || !d || d.open) return;
    d.showModal();
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus(); // the safe choice for danger, the action otherwise
  }, [p]);

  const done = (ok: boolean) => {
    const cur = pending.current;
    pending.current = null;
    cur?.resolve(ok);
    setP(null);
    if (ref.current?.open) ref.current.close();
  };

  const danger = p?.tone === "danger";
  return (
    <dialog
      ref={ref}
      className="hs-dialog"
      aria-labelledby="confirm-h"
      aria-describedby="confirm-s"
      data-testid="confirm-dialog"
      onClose={() => done(false)}
      onClick={(e) => e.target === e.currentTarget && done(false)}
    >
      {p && (
        <div className="grid gap-4">
          <h2 id="confirm-h" className="text-lg font-semibold">{p.title}</h2>
          <p id="confirm-s" className="text-sm">{p.sentence}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="hs-btn-secondary" data-testid="confirm-dialog-cancel" data-autofocus={danger ? "" : undefined} onClick={() => done(false)}>
              Go back
            </button>
            <button type="button" className={danger ? "hs-btn-danger" : "hs-btn"} data-testid="confirm-dialog-confirm" data-autofocus={danger ? undefined : ""} onClick={() => done(true)}>
              {p.action}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
