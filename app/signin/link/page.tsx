// /signin/link: where the emailed link lands (K10). Opening it spends nothing, so a mail scanner's visit is harmless;
// the button POSTs the token to /api/auth/callback, which uses it once.
import Link from "next/link";
import { readClaims } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/magic-link";

export default async function SignInLinkPage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string }> }) {
  const { token = "", next } = await searchParams;
  const claims = await readClaims(token, "login");
  return (
    <main className="mx-auto max-w-md px-4 py-10 md:py-16">
      <h1 className="hs-display mb-6 text-4xl">Sign in</h1>
      {claims ? (
        <form method="post" action="/api/auth/callback" className="hs-card flex flex-col gap-3">
          <p>Continue as <strong>{claims.sub}</strong>. The link works once.</p>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="next" value={safeNext(next)} />
          <button type="submit" className="hs-btn" data-testid="use-sign-in-link">Continue signing in</button>
        </form>
      ) : (
        <div className="hs-card" role="alert">
          <p>This sign-in link has expired or is not valid.</p>
          <Link href="/signin" className="hs-btn mt-3 inline-block">Get a new link</Link>
        </div>
      )}
    </main>
  );
}
