import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import { currentUser } from "@/lib/auth/current";
import { PersonaSwitcher } from "@/components/PersonaSwitcher";
import { ConfirmHost } from "@/components/ConfirmDialog";
import { ToastHost } from "@/components/Toast";
import "./globals.css";

// T-40 type pairing: Plex Sans for everything, Newsreader only for the page-level headings (globals.css reads the variables).
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  title: "Handshake",
  description: "Pay on proof: money is held until the evidence checks out.",
};

const NAV = [["/dashboard", "Dashboard"], ["/new", "New deal"], ["/agents", "Agents"], ["/ledger", "Ledger"], ["/wallet", "Wallet"], ["/security", "Security"]] as const;

// Header per 08 section 4.1: wordmark, nav (behind a native <details> menu on mobile), name, demo switcher, sign out.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const demo = process.env.DEMO_LOGIN === "true";
  return (
    <html lang="en" className={`${plex.variable} ${newsreader.variable}`}>
      <body className="min-h-screen bg-[var(--hs-bg)] text-[var(--hs-ink)] antialiased">
        <a href="#main" className="hs-skip">Skip to content</a>
        <header className="border-b border-[var(--hs-border)] bg-[var(--hs-surface)]">
          <nav aria-label="Main" className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm md:px-8">
            <Link href="/" className="hs-display flex items-center gap-2 text-xl leading-none">
              <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-[var(--hs-accent)]" />
              Handshake
            </Link>
            {me && (
              <>
                <div className="hidden gap-5 md:flex">
                  {NAV.map(([href, label]) => <Link key={href} href={href} className="hs-link text-[var(--hs-ink)]">{label}</Link>)}
                </div>
                <Link href="/me" className="ml-auto truncate text-[var(--hs-muted)] hover:underline md:ml-0">{me.display_name ?? me.email}</Link>
                <PersonaSwitcher demo={demo} email={me.email} />
                <details className="basis-full md:hidden">
                  <summary className="cursor-pointer list-none py-1 text-[var(--hs-muted)]">Menu</summary>
                  <div className="flex gap-5 py-1">
                    {NAV.map(([href, label]) => <Link key={href} href={href} className="hs-link text-[var(--hs-ink)]">{label}</Link>)}
                  </div>
                </details>
              </>
            )}
            {!me && <Link href="/signin" className="hs-link ml-auto">Sign in</Link>}
          </nav>
        </header>
        <div id="main" tabIndex={-1} className="outline-none">{children}</div>
        <ConfirmHost />
        <ToastHost />
      </body>
    </html>
  );
}
