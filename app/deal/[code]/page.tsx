// /deal/[code]: first paint from getDeal on the server (08 sections 4.2, 7). Signed out -> /?next=; 403 and 404 per 08 section 4.4.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/current";
import { DealError, getDeal, type DealPreview, type DealView } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { Deal } from "@/components/deal/Deal";

export default async function DealPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user_id = await currentUserId();
  if (!user_id) redirect(`/?next=/deal/${code}`);

  let deal: DealView | DealPreview;
  try {
    deal = await getDeal(code, { user_id }, getDeps());
  } catch (e) {
    if (e instanceof DealError && e.code === "deal_not_found") notFound();
    if (e instanceof DealError && e.code === "not_a_party") {
      return (
        <main className="mx-auto max-w-xl p-8 text-center">
          <h1 className="text-2xl font-semibold">This deal is private.</h1>
          <p className="mt-2 text-[var(--hs-muted)]">Only its buyer and seller can see it.</p>
          <Link href="/ledger" className="hs-btn mt-6">Go to your ledger</Link>
        </main>
      );
    }
    throw e;
  }
  return <Deal initial={deal} demo={process.env.DEMO_LOGIN === "true"} paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""} />;
}
