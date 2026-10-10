import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe } from "@/lib/auth/me";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getDeps } from "@/lib/deps";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handshake",
  description: "Pay on proof: money is held until the evidence checks out.",
};

// Header per 08 section 4.1, minimal: wordmark, nav, signed-in name. The persona switcher and sign-out are T-18's.
async function whoami() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const id = token ? await readSession(token) : null;
  if (!id) return null;
  return getMe(id, getDeps().db).catch(() => null);
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await whoami();
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--hs-bg)] text-[var(--hs-ink)] antialiased">
        <header className="border-b border-[var(--hs-border)] bg-[var(--hs-surface)]">
          <nav className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-3 text-sm md:px-8">
            <Link href="/" className="text-base font-semibold">Handshake</Link>
            {me && (
              <>
                <Link href="/new" className="hover:underline">New deal</Link>
                <Link href="/ledger" className="hover:underline">Ledger</Link>
                <Link href="/dashboard" className="hover:underline">Dashboard</Link>
                <Link href="/me" className="ml-auto text-[var(--hs-muted)] hover:underline">{me.display_name ?? me.email}</Link>
              </>
            )}
            {!me && <Link href="/" className="ml-auto hover:underline">Sign in</Link>}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
