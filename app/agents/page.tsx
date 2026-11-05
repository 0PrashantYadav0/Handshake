// /agents: agents that transact, with the money guarded (docs/agents.md). Demo buyers get the live desk; everyone can connect an agent.
import { redirect } from "next/navigation";
import { AgentDesk } from "@/components/AgentDesk";
import { AgentKeysPanel, type KeyRow } from "@/components/AgentKeysPanel";
import { listAgentKeys } from "@/lib/agents/keys";
import { personaOf } from "@/lib/auth/demo";
import { currentUser } from "@/lib/auth/current";
import { getDeps } from "@/lib/deps";

const CAN_CANNOT = [
  ["An agent can", ["Haggle and propose a deal, up to its ceiling", "Sign the contract with its own key", "Submit proof of delivery", "Cancel before capture"]],
  ["Only a person can", ["Approve the hold at PayPal", "Decide when Claude is unsure", "Raise the ceiling or revoke the key"]],
  ["Only fixed code can", ["Refuse an offer outside the mandate", "Release or void the money from Claude's verdicts", "Refuse any step if the signed terms changed"]],
] as const;

export default async function AgentsPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/agents");
  const demo = process.env.DEMO_LOGIN === "true";
  const keys = await listAgentKeys(me.id, getDeps().db);
  const rows: KeyRow[] = keys.map((k) => ({ ...k, last_used_at: k.last_used_at?.toISOString() ?? null, revoked_at: k.revoked_at?.toISOString() ?? null })).filter((k) => !k.label.startsWith("Desk "));
  const isBuyerPersona = demo && personaOf(me.email) === "buyer";
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="hs-help font-medium uppercase tracking-wide">Agentic commerce, with the money guarded</p>
      <h1 className="hs-display mt-1 text-4xl md:text-5xl">Let the agents make the deal. Keep the money safe.</h1>
      <p className="mt-3 max-w-2xl text-[var(--hs-muted)]">An AI agent that can spend is one bad prompt from spending too much. Here two agents negotiate and settle a real PayPal sandbox payment, and neither of them can move a cent on its own.</p>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {CAN_CANNOT.map(([title, items]) => (
          <section key={title} className="hs-card p-4">
            <h2 className="text-sm font-semibold">{title}</h2>
            <ul className="hs-help mt-2 flex list-disc flex-col gap-1 pl-4">{items.map((i) => <li key={i}>{i}</li>)}</ul>
          </section>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="hs-display mb-3 text-3xl">Watch two agents do it</h2>
        {isBuyerPersona
          ? <AgentDesk clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""} />
          : <p className="hs-banner" data-tone="info">{demo ? "The live desk runs as the Demo Buyer. Switch to that persona in the header to try it." : "The live desk is part of the demo build."}</p>}
      </section>

      <div className="mt-8"><AgentKeysPanel keys={rows} demo={demo && personaOf(me.email) !== null} appUrl={process.env.APP_URL ?? ""} /></div>
    </main>
  );
}
