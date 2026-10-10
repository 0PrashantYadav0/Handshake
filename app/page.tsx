// / : landing and sign-in (08 section 5). The panel reads ?next= and ?error=invalid_link.
import { currentUser } from "@/lib/auth/current";
import { safeNext } from "@/lib/auth/magic-link";
import { SignInPanel } from "@/components/SignInPanel";

const STEPS = [
  "The buyer describes the deal in a sentence; Claude turns it into checkable conditions.",
  "Both accept. PayPal holds the buyer's money; nothing is charged.",
  "The seller uploads photos and a tracking number; Claude judges each condition.",
  "A fixed rule in code releases the money, asks for one fix, voids the hold, or asks the buyer.",
];

export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const [{ next, error }, me] = await Promise.all([searchParams, currentUser()]);
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="grid gap-8 md:grid-cols-[3fr_2fr] md:items-start">
        <section>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Pay on proof.</h1>
          <p className="mt-4 max-w-prose text-lg text-[var(--hs-muted)]">
            Agree a deal in one sentence. PayPal holds the money. Claude checks the proof. A fixed rule releases it.
          </p>
        </section>
        <SignInPanel
          demo={process.env.DEMO_LOGIN === "true"}
          dev={process.env.NODE_ENV !== "production"}
          name={me ? me.display_name ?? me.email : null}
          next={next && safeNext(next) === next ? next : null}
          invalidLink={error === "invalid_link"}
        />
      </div>
      <section className="mt-12">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="mt-3 grid gap-2 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={i} className="hs-card text-sm"><span className="mr-2 font-semibold text-[var(--hs-accent)]">{i + 1}.</span>{s}</li>
          ))}
        </ol>
      </section>
      <section className="hs-card mt-8 border-l-4 border-l-[var(--hs-accent)]">
        <h2 className="font-semibold">What the AI never does</h2>
        <p className="mt-1 text-sm">It never moves money. Capture and void are called only by a rule in code that is unit-tested line by line. Every step is logged and exportable.</p>
      </section>
      <footer className="mt-12 flex flex-wrap gap-x-3 text-sm text-[var(--hs-muted)]">
        <span>Sandbox only. No real money.</span>
        <span>·</span>
        <a className="hs-link" href="https://github.com/0PrashantYadav0/Handshake" target="_blank" rel="noreferrer">Source on GitHub</a>
        <span>·</span>
        <a className="hs-link" href="https://github.com/0PrashantYadav0/Handshake#readme" target="_blank" rel="noreferrer">README</a>
      </footer>
    </main>
  );
}
