"use client";
// /dashboard client shell (09 section 5.1): fetches the data, loads the Studio bundle client-only behind a skeleton.
// `next/dynamic({ ssr: false })` keeps the ~2 MB Studio bundle off every other route (dependencies.md trap 6).
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/dashboard-rows";

const StudioCanvas = dynamic(() => import("@/components/StudioCanvas").then((m) => m.StudioCanvas), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

/** Four grey tiles and two grey chart boxes in the final layout, so the page does not jump. */
export function DashboardSkeleton() {
  const box = "animate-pulse rounded-[10px] border border-[var(--hs-border)] bg-[var(--hs-surface)]";
  return (
    <div className="grid grid-cols-4 gap-3 p-4 md:p-8" aria-busy="true" aria-label="Loading dashboard">
      {[0, 1, 2, 3].map((i) => <div key={i} className={`${box} h-32`} />)}
      <div className={`${box} col-span-4 h-56`} />
      <div className={`${box} col-span-2 h-72`} />
      <div className={`${box} col-span-2 h-72`} />
    </div>
  );
}

export function StudioDashboard({ licenseKey, dataUrl }: { licenseKey?: string; dataUrl: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(dataUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setData, (e: Error) => setError(e.message));
  }, [dataUrl]);
  if (error) return <p className="p-8 text-[var(--hs-muted)]">Could not load the dashboard ({error}). Reload to try again.</p>;
  if (!data) return <DashboardSkeleton />;
  return <StudioCanvas data={data} licenseKey={licenseKey} />;
}
