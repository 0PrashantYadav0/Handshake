import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/current";
import { PersonaSwitcher } from "@/components/PersonaSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handshake",
  description: "Pay on proof: money is held until the evidence checks out.",
};

const NAV = [["/new", "New deal"], ["/ledger", "Ledger"], ["/dashboard", "Dashboard"]] as const;

// Header per 08 section 4.1: wordmark, nav (behind a native <details> menu on mobile), name, demo switcher, sign out.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const demo = process.env.DEMO_LOGIN === "true";
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--hs-bg)] text-[var(--hs-ink)] antialiased">
        <header className="border-b border-[var(--hs-border)] bg-[var(--hs-surface)]">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm md:px-8">
            <Link href="/" className="text-base font-semibold">Handshake</Link>
            {me && (
              <>
                <div className="hidden gap-5 md:flex">
                  {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:underline">{label}</Link>)}
                </div>
                <Link href="/me" className="ml-auto truncate text-[var(--hs-muted)] hover:underline md:ml-0">{me.display_name ?? me.email}</Link>
                <PersonaSwitcher demo={demo} email={me.email} />
                <details className="basis-full md:hidden">
                  <summary className="cursor-pointer py-1 text-[var(--hs-muted)]">Menu</summary>
                  <div className="flex gap-5 py-1">
                    {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:underline">{label}</Link>)}
                  </div>
                </details>
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
