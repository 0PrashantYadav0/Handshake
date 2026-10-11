// /ledger: first paint from listDeals on the server (08 section 4.2, section 8). Signed out -> /signin.
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/current";
import { listDeals } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { Ledger } from "@/components/Ledger";

export default async function LedgerPage() {
  const user_id = await currentUserId();
  if (!user_id) redirect("/signin?next=/ledger");
  const rows = await listDeals({ user_id }, getDeps());

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Your deals</h1>
        <span className="text-[var(--hs-muted)]">{rows.length} {rows.length === 1 ? "deal" : "deals"}</span>
        <div className="ml-auto flex gap-2">
          <Link href="/new" className="hs-btn">New deal</Link>
          <Link href="/dashboard/studio" className="hs-btn-secondary">Open analytics studio</Link>
        </div>
      </div>
      <Ledger rows={rows} />
    </main>
  );
}
