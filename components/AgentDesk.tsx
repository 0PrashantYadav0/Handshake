"use client";
// The live agent desk (docs/agents.md): streams the two agents' turns and tool calls, stops at the PayPal hold (a person's job),
// then streams the delivery and follows the deal to its end.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PayButton } from "@/components/deal/PayButton";
import { StatusPill } from "@/components/StatusPill";
import type { brief } from "@/lib/agents/tools";
import type { DeskEvent, ScenarioId } from "@/lib/agents/desk";
import { api, errorCopy } from "@/lib/client-api";
import { money } from "@/lib/ledger-columns";
import type { DealStatus } from "@/lib/deal/types";

type Brief = ReturnType<typeof brief>;
type Line = DeskEvent & { n: number };
const TERMINAL = ["paid", "voided", "in_review"];

const CARDS: { id: ScenarioId; title: string; line: string; budget: string }[] = [
  { id: "honest", title: "An honest seller", line: "The agents haggle over a mug. The real item ships, the proof checks out, the rule releases the money.", budget: "Mandate: at most $20" },
  { id: "cheat", title: "A seller that cheats", line: "The agents agree on a lamp, then the seller's agent submits a different lamp, twice. Watch who gets paid.", budget: "Mandate: at most $40" },
  { id: "hijack", title: "A seller that hijacks", line: "The seller's agent tells the buyer's agent its budget is now $500. Then the $95 purchase is attempted for real.", budget: "Mandate: at most $20" },
];

const OUTCOME: Record<string, string> = {
  paid: "Paid. Two agents made the deal; PayPal moved the money only after a person approved the hold and the proof passed.",
  voided: "Voided. The wrong item failed twice, so the hold was released. The buyer was never charged and the seller got nothing.",
  in_review: "A person decides. Claude was not sure enough, so no agent and no model can release this payment.",
};

function Bubble({ line }: { line: Extract<DeskEvent, { t: "say" | "guard" | "tool" }> }) {
  const left = line.agent === "buyer";
  const who = left ? "Buying agent" : "Selling agent";
  if (line.t === "guard") {
    return (
      <li className="mx-auto max-w-xl rounded-lg border border-[var(--hs-status-voided)] bg-[var(--hs-surface)] px-3 py-2 text-center text-sm" data-testid="desk-guard">
        <span className="font-semibold text-[var(--hs-status-voided)]">Fixed code · </span>{line.text}
      </li>
    );
  }
  return (
    <li className={`flex ${left ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-2xl border px-4 py-2.5 ${line.t === "tool" ? "border-dashed border-[var(--hs-border)] bg-transparent" : left ? "border-[var(--hs-accent)] bg-[var(--hs-surface)]" : "border-[#c98a2b] bg-[var(--hs-surface)]"}`} data-testid={line.t === "tool" ? "desk-tool" : "desk-say"}>
        <p className="hs-help mb-0.5 font-medium">{who}{line.t === "say" ? ` · offers ${money(line.offer_minor)}` : ""}</p>
        {line.t === "say" ? <p className="text-[0.95rem]">{line.text}</p> : (
          <p className="text-sm"><code className="font-mono text-[0.8rem] text-[var(--hs-accent)]">{line.name}</code> <span className="text-[var(--hs-muted)]">→ {line.summary}</span></p>
        )}
      </div>
    </li>
  );
}

export function AgentDesk({ clientId }: { clientId: string }) {
  const [scenario, setScenario] = useState<ScenarioId>("honest");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<{ code: string; amount_minor: number } | null>(null);
  const [deal, setDeal] = useState<Brief | null>(null);
  const [status, setStatus] = useState<DealStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const seq = useRef(0);
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    void end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines.length]);

  const read = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agents/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage(data?.error?.message ?? "The agents could not start. Try again.");
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const p of parts.filter(Boolean)) {
          const e = JSON.parse(p) as DeskEvent;
          if (e.t === "gate") setGate({ code: e.code, amount_minor: e.amount_minor });
          else if (e.t === "deal") {
            setDeal(e.deal);
            setStatus(e.deal.status);
          } else if (e.t === "error") setMessage(e.message);
          else if (e.t === "done") { if (!e.code) setMessage(e.outcome); }
          else setLines((cur) => [...cur, { ...e, n: seq.current++ }]);
        }
      }
    } catch (e) {
      setMessage(errorCopy(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // After the delivery, follow the deal: capture and payout arrive by webhook.
  useEffect(() => {
    if (!gate || !status || status === "terms_agreed" || TERMINAL.includes(status)) return;
    const t = setInterval(async () => {
      const d = await api<{ status: DealStatus }>(`/api/deals/${gate.code}`).catch(() => null);
      if (d) setStatus(d.status);
    }, 3000);
    return () => clearInterval(t);
  }, [gate, status]);

  const start = () => {
    setLines([]);
    setGate(null);
    setDeal(null);
    setStatus(null);
    read({ scenario, step: "negotiate" });
  };
  const onHeld = () => {
    setStatus("held");
    read({ scenario, step: "deliver", code: gate!.code });
  };
  const started = lines.length > 0 || busy;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Scenario">
        {CARDS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={scenario === c.id} disabled={busy} onClick={() => setScenario(c.id)} data-testid={`desk-${c.id}`}
            className={`hs-card p-4 text-left transition-colors ${scenario === c.id ? "ring-2 ring-[var(--hs-accent)]" : "opacity-80 hover:opacity-100"}`}>
            <span className="block font-semibold">{c.title}</span>
            <span className="hs-help mt-1 block">{c.line}</span>
            <span className="mt-2 block font-mono text-xs text-[var(--hs-accent)]">{c.budget}</span>
          </button>
        ))}
      </div>
      <div>
        <button type="button" className="hs-btn" onClick={start} disabled={busy || (!!gate && status === "terms_agreed")} data-testid="desk-start">{busy ? "The agents are working…" : started ? "Run it again" : "Start the agents"}</button>
      </div>
      {started && (
        <ol className="hs-card flex flex-col gap-2.5 p-4 md:p-5" aria-live="polite" data-testid="desk-feed">
          {lines.map((l) => <Bubble key={l.n} line={l as Extract<DeskEvent, { t: "say" | "guard" | "tool" }>} />)}
          {busy && <li className="hs-help text-center" aria-hidden>…</li>}
          <li ref={end} />
        </ol>
      )}

      {message && <p className="hs-banner" data-tone="info" role="status" data-testid="desk-message">{message}</p>}

      {gate && status === "terms_agreed" && (
        <section className="hs-card border-[var(--hs-accent)] p-5" data-testid="desk-gate">
          <h2 className="hs-display text-2xl">The agents stop here. This part is yours.</h2>
          <p className="hs-help mt-1 mb-4 text-[0.95rem]">Only a person can approve money. Approve a hold of {money(gate.amount_minor)} at PayPal: it is held, not charged, and goes back if the proof never checks out.</p>
          <div className="max-w-sm"><PayButton code={gate.code} clientId={clientId} onHeld={onHeld} onFail={(e) => setMessage(errorCopy(e))} /></div>
        </section>
      )}

      {deal && deal.verdicts.length > 0 && (
        <section className="hs-card p-5" data-testid="desk-verdicts">
          <h2 className="hs-display text-2xl">What Claude saw</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {deal.verdicts.map((v) => (
              <li key={v.condition} className="text-sm">
                <span className="font-semibold">{v.result === "pass" ? "Pass" : v.result === "fail" ? "Fail" : "Unclear"}</span> ({Math.round(v.confidence * 100)}%) · {v.condition}
                <p className="hs-help">{v.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gate && status && status !== "terms_agreed" && (
        <section className="hs-card p-5" data-testid="desk-result">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <Link className="hs-link text-sm" href={`/deal/${gate.code}`}>Open deal {gate.code}</Link>
            <a className="hs-link text-sm" href={`/api/deals/${gate.code}/evidence-pack`}>Evidence pack</a>
          </div>
          {OUTCOME[status] && <p className="mt-3 text-[0.95rem]" data-testid="desk-outcome">{OUTCOME[status]}</p>}
        </section>
      )}
    </div>
  );
}
