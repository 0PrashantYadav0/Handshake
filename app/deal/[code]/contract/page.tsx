// /deal/[code]/contract: the signed contract with in-browser verification and the download (trust spec §6). Parties only.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/current";
import { DealError, getDeal } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { ContractVerifier } from "@/components/deal/ContractVerifier";

export default async function ContractPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user_id = await currentUserId();
  if (!user_id) redirect(`/signin?next=/deal/${code}/contract`);
  let view;
  try {
    view = await getDeal(code, { user_id }, getDeps());
  } catch (e) {
    if (e instanceof DealError && (e.code === "deal_not_found" || e.code === "not_a_party")) notFound();
    throw e;
  }
  if (view.role === "preview") notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/deal/${code}`} className="hs-link text-sm">Back to the deal</Link>
      <h1 className="hs-display mt-2 mb-6 text-4xl">Contract {code}</h1>
      {view.contract ? (
        <ContractVerifier contract={view.contract} />
      ) : (
        <p className="hs-card">There is no contract to sign yet. It appears once the seller has joined and the amount and deadline are set.</p>
      )}
    </main>
  );
}
