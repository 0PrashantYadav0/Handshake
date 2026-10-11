// /security/setup: mandatory TOTP enrollment (trust spec §4). Partial or full session; already enrolled -> /security.
import { redirect } from "next/navigation";
import { sessionClaims } from "@/lib/auth/current";
import { safeNext } from "@/lib/auth/magic-link";
import { getDeps } from "@/lib/deps";
import { TotpSetup } from "@/components/auth/TotpSetup";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next: raw }, claims] = await Promise.all([searchParams, sessionClaims()]);
  const next = safeNext(raw);
  if (!claims) redirect(`/signin?next=${encodeURIComponent(next)}`);
  const u = await getDeps().db.user.findUnique({ where: { id: claims.sub }, select: { totp_enabled_at: true } });
  if (!u) redirect("/signin");
  if (u.totp_enabled_at) redirect(claims.mfa ? "/security" : `/signin/2fa?next=${encodeURIComponent(next)}`);
  return (
    <main className="mx-auto max-w-xl px-4 py-10 md:py-16">
      <h1 className="hs-display mb-2 text-4xl">Turn on two-step sign-in</h1>
      <p className="mb-6 text-[var(--hs-muted)]">Handshake holds and releases money, so every buyer and seller signs in with a code from an authenticator app as well as an email link.</p>
      <TotpSetup next={next} />
    </main>
  );
}
