// /signin/2fa: the second factor for a partial session (trust spec §4). No session -> /signin; not enrolled -> /security/setup.
import { redirect } from "next/navigation";
import { sessionClaims } from "@/lib/auth/current";
import { personaOf } from "@/lib/auth/demo";
import { safeNext } from "@/lib/auth/magic-link";
import { getDeps } from "@/lib/deps";
import { TwoFactorForm } from "@/components/auth/TwoFactorForm";

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next: raw }, claims] = await Promise.all([searchParams, sessionClaims()]);
  const next = safeNext(raw);
  if (!claims) redirect(`/signin?next=${encodeURIComponent(next)}`);
  if (claims.mfa) redirect(next);
  const u = await getDeps().db.user.findUnique({ where: { id: claims.sub }, select: { email: true, totp_enabled_at: true } });
  if (!u) redirect("/signin");
  if (!u.totp_enabled_at) redirect(`/security/setup?next=${encodeURIComponent(next)}`);
  const demo = process.env.DEMO_LOGIN === "true" && personaOf(u.email) !== null;
  return (
    <main className="mx-auto max-w-md px-4 py-10 md:py-16">
      <h1 className="hs-display mb-2 text-4xl">Two-step check</h1>
      <p className="mb-6 text-[var(--hs-muted)]">Signing in as {u.email}. Open your authenticator app and enter the 6-digit code for Handshake.</p>
      <TwoFactorForm next={next} demo={demo} />
    </main>
  );
}
