// /ledger: first paint from listDeals on the server (08 section 4.2, section 8). Signed out -> /.
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { listDeals } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { Ledger } from "@/components/Ledger";

export default async function LedgerPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user_id = token ? await readSession(token) : null;
  if (!user_id) redirect("/?next=/ledger");
  const rows = await listDeals({ user_id }, getDeps());

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Your deals</h1>
        <span className="text-[var(--hs-muted)]">{rows.length} {rows.length === 1 ? "deal" : "deals"}</span>
        <div className="ml-auto flex gap-2">
          <Link href="/new" className="hs-btn">New deal</Link>
          <Link href="/dashboard" className="hs-btn-secondary">Open dashboard</Link>
        </div>
      </div>
      <Ledger rows={rows} />
    </main>
  );
}
