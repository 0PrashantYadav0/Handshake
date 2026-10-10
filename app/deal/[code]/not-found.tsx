// deal_not_found (08 section 4.4). not-found.tsx gets no params, so the code is not repeated here.
import Link from "next/link";

export default function DealNotFound() {
  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold">No deal with that code.</h1>
      <p className="mt-2 text-[var(--hs-muted)]">Check the link you were sent.</p>
      <Link href="/ledger" className="hs-btn mt-6">Go to your ledger</Link>
    </main>
  );
}
