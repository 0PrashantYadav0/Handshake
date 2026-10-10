"use client";
// Header right side (08 sections 3.3, 4.1): the Demo badge with the Buyer | Seller control, and Sign out.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";

type Persona = "buyer" | "seller";
const personaOf = (email: string): Persona | null =>
  email === "demo-buyer@handshake.demo" ? "buyer" : email === "demo-seller@handshake.demo" ? "seller" : null;

/** `email` is the signed-in user's; the active segment is the demo persona it belongs to, if any. */
export function PersonaSwitcher({ demo, email }: { demo: boolean; email: string }) {
  const router = useRouter();
  const active = personaOf(email);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, then?: string) => {
    setBusy(true);
    try {
      await fn();
      if (then) router.push(then);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ml-auto flex items-center gap-2">
      {demo && (
        <div className="flex items-center gap-1.5" role="group" aria-label="Demo persona">
          <span className="hs-badge">Demo</span>
          {(["buyer", "seller"] as const).map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`persona-${p}`}
              aria-pressed={active === p}
              className="hs-chip"
              disabled={busy}
              onClick={() => active !== p && run(() => api("/api/auth/demo", { json: { persona: p } }))}
            >
              {p === "buyer" ? "Buyer" : "Seller"}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="hs-link text-sm" disabled={busy} onClick={() => run(() => api("/api/auth/sign-out", { method: "POST" }), "/")}>
        Sign out
      </button>
    </div>
  );
}
