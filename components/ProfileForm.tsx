"use client";
// Profile card (08 section 10): display name -> PATCH /api/me, "Saved." toast. The payout address has its own card (trust spec §8).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Me } from "@/lib/auth/me";
import { api, ApiError, errorCopy } from "@/lib/client-api";
import { toast } from "@/components/Toast";

export function ProfileForm({ me, next }: { me: Me; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState(me.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/me", { method: "PATCH", json: { display_name: name.trim() } });
      toast("Saved.");
      router.refresh(); // header shows the new name
      if (next) router.push(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "not_signed_in") return router.push("/signin?next=/me");
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="hs-card flex flex-col gap-4" onSubmit={submit} noValidate>
      <h2 className="font-semibold">Profile</h2>
      {error && <p role="alert" tabIndex={-1} className="hs-banner">{error}</p>}
      <div>
        <span className="hs-label">Email</span>
        <p className="text-[var(--hs-muted)]">{me.email}</p>
      </div>
      <div>
        <label htmlFor="display_name" className="hs-label">Display name</label>
        <input id="display_name" className="hs-input w-full" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="display_name-help" />
        <p id="display_name-help" className="hs-help mt-1">Shown to the other party instead of your email.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" data-testid="save-profile" className="hs-btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {next && <Link href={next} className="hs-link text-sm">Back to the deal</Link>}
      </div>
    </form>
  );
}
