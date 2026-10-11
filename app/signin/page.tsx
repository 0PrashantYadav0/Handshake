// /signin: demo personas and the magic-link form (08 section 5, moved from / by trust spec §11).
// A full session goes straight to next; a partial one goes on to its second factor.
import { redirect } from "next/navigation";
import { sessionClaims } from "@/lib/auth/current";
import { safeNext } from "@/lib/auth/magic-link";
import { SignInPanel } from "@/components/SignInPanel";
import { getDeps } from "@/lib/deps";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const [{ next, error }, claims] = await Promise.all([searchParams, sessionClaims()]);
  const okNext = next && safeNext(next) === next ? next : null;
  if (claims?.mfa) redirect(safeNext(okNext));
  if (claims) {
    const u = await getDeps().db.user.findUnique({ where: { id: claims.sub }, select: { totp_enabled_at: true } });
    if (u) redirect(`${u.totp_enabled_at ? "/signin/2fa" : "/security/setup"}?next=${encodeURIComponent(safeNext(okNext))}`);
  }
  return (
    <main className="mx-auto max-w-md px-4 py-10 md:py-16">
      <h1 className="hs-display mb-6 text-4xl">Sign in</h1>
      <SignInPanel demo={process.env.DEMO_LOGIN === "true"} dev={process.env.NODE_ENV !== "production"} name={null} next={okNext} invalidLink={error === "invalid_link"} />
      <p className="hs-help mt-4">Every account uses two steps: a link to your email, then a code from your authenticator app.</p>
    </main>
  );
}
