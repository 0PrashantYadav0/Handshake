"use client";
// Toasts (08 sections 4.6, 10, 11): one aria-live="polite" region for "Copied", "Saved." and errors that have no inline home.
// `toast()` is callable from anywhere on the client; ToastHost is mounted once in app/layout.tsx.
import { useEffect, useState } from "react";

type Toast = { id: number; message: string; tone: "info" | "error" };
let push: ((t: Toast) => void) | null = null;
let seq = 0;

export function toast(message: string, tone: Toast["tone"] = "info") {
  push?.({ id: ++seq, message, tone });
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((cur) => [...cur.slice(-2), t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), t.tone === "error" ? 6000 : 2500);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="hs-toast-region" role="status" aria-live="polite" data-testid="toast-region">
      {items.map((t) => <div key={t.id} className="hs-toast" data-tone={t.tone}>{t.message}</div>)}
    </div>
  );
}
