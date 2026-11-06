// The tools an AI agent can use (docs/agents.md). One list serves the MCP endpoint and the live agent desk. Each tool calls the same
// lib/deal commands a person's browser does, so PayPal, the contract gate and decide() apply unchanged. There is deliberately no tool
// that approves a hold or a buyer review: money only moves on a person's PayPal approval and on the fixed rule.
import { z } from "zod";
import { addFile, createDeal, getDeal, handle, listDeals, DealError } from "@/lib/deal";
import type { Actor, DealView, Deps } from "@/lib/deal/types";
import { validateFile } from "@/lib/files/validate";
import { formatUsd as money } from "@/lib/money";
import { allow } from "@/lib/rate-limit";
import { signAsAgent, type AgentKeyRow } from "./keys";
import { listingPhotos, samplePhotos } from "./samples";

export type ToolContext = { key: AgentKeyRow; deps: Deps; baseUrl: string };
const actorOf = (c: ToolContext): Actor => ({ user_id: c.key.user_id });
const demoOn = () => process.env.DEMO_LOGIN === "true";

const Code = z.string().regex(/^HS-[0-9A-Z]{4}$/, "A deal code looks like HS-7KQ2.");
const Photo = z.string().min(100).describe("A photo as base64: JPEG, PNG or WebP, at most 2 MB");
const toBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
/** Checks every photo before the first is stored, so one bad photo stores none. */
const checked = (bytes: Uint8Array[]) => bytes.map((b) => ({ bytes: b, mime: validateFile(b).mime }));

async function party(code: string, c: ToolContext): Promise<DealView> {
  const v = await getDeal(code, actorOf(c), c.deps);
  if (v.role === "preview") throw new DealError("not_a_party", "Join the deal first.");
  return v;
}

function nextStep(d: DealView): string {
  const mine = d.role === "buyer" ? d.buyer_accepted_version : d.seller_accepted_version;
  if (d.seeded) return "Historical demo deal: no action is possible.";
  switch (d.status) {
    case "draft":
      if (d.amount_minor === null || d.deadline_days === null) return "The price or deadline is missing. A person must set it at the url, or cancel and propose again with both in the sentence.";
      if (!d.seller) return "Share the url with the seller; their agent calls join_deal.";
      return mine === d.terms_version ? "Waiting for the other party to sign." : "Call sign_contract.";
    case "terms_agreed":
      return d.role === "buyer" ? "A person must open the url and approve the hold at PayPal. No agent can do this." : "Waiting for the buyer to approve the hold at PayPal.";
    case "held":
      return d.role === "seller" ? (d.fix_attempts_used ? "The first proof failed: submit_proof one last time." : "Ship the item, then call submit_proof.") : "The money is held. Waiting for the seller's proof.";
    case "proof_submitted":
      return "Claude is judging the proof. Call get_deal again in a few seconds.";
    case "in_review":
      return "A person must decide on the deal page. No agent can release this payment.";
    case "captured":
      return d.payouts.at(-1)?.status === "failed" ? "The payout failed. A person must retry it on the deal page." : "Released. PayPal is paying the seller.";
    case "paid":
      return "Done: the seller has been paid.";
    case "voided":
      return "The hold was released. The buyer was not charged.";
    default:
      return "";
  }
}

/** What an agent needs from a DealView, without the signed file urls and contract document. */
export function brief(d: DealView, baseUrl: string) {
  const last = d.submissions.at(-1);
  const text = (id: string) => d.conditions.find((x) => x.id === id)?.text ?? id;
  return {
    code: d.code,
    url: `${baseUrl}/deal/${d.code}`,
    role: d.role,
    status: d.status,
    item: d.item_title,
    amount: d.amount_minor === null ? null : money(d.amount_minor),
    deadline_days: d.deadline_days,
    conditions: d.conditions.map((x) => x.text),
    signed: { buyer: d.buyer_accepted_version === d.terms_version, seller: d.seller_accepted_version === d.terms_version },
    latest_decision: last?.decision ?? null,
    verdicts: last?.verdicts.map((v) => ({ condition: text(v.condition_id), result: v.result, confidence: v.confidence, reason: v.reason })) ?? [],
    paypal: d.payment ? { status: d.payment.status, authorization_id: d.payment.authorization_id, capture_id: d.payment.capture_id } : null,
    payout: d.payouts.at(-1)?.status ?? null,
    next_step: nextStep(d),
  };
}

type Tool<S extends z.ZodType = z.ZodType> = { name: string; description: string; schema: S; run: (args: z.infer<S>, c: ToolContext) => Promise<unknown> };
const tool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool;

export const TOOLS: Tool[] = [
  tool({
    name: "get_mandate",
    description: "What this agent may do: the per-deal spending ceiling, and what only a person can do.",
    schema: z.object({}),
    run: async (_, c) => ({
      agent: c.key.label,
      ceiling_per_deal: money(c.key.max_amount_minor),
      can: ["propose deals up to the ceiling", "join deals as a seller", "sign contracts", "submit proof", "cancel until proof is submitted"],
      only_a_person_can: ["approve a hold at PayPal", "decide a buyer review", "raise this ceiling"],
    }),
  }),
  tool({
    name: "propose_deal",
    description: 'Create a deal as the buyer from one sentence, for example "I\'ll pay $18 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and tracking shows delivered". Refused if the price is over your ceiling.',
    schema: z.object({ sentence: z.string().min(1).max(500) }),
    run: async ({ sentence }, c) => {
      if (!allow(`extract:${c.key.user_id}`, 20, 10 * 60_000)) throw new DealError("rate_limited", "Too many new deals; try again in a few minutes."); // the same bucket as POST /api/deals
      const d = await createDeal(actorOf(c), { text: sentence }, c.deps);
      if (d.amount_minor !== null && d.amount_minor > c.key.max_amount_minor) {
        await handle(d.code, actorOf(c), { type: "cancel" }, c.deps);
        throw new DealError("mandate_exceeded", `${money(d.amount_minor)} is over this agent's ceiling of ${money(c.key.max_amount_minor)}. The draft was cancelled.`);
      }
      return { ...brief(d, c.baseUrl), rejected_conditions: d.rejected };
    },
  }),
  tool({
    name: "add_listing_photos",
    description: "Attach the listing photos the proof is compared with, before anyone signs. Pass photos, or use_sample in demo mode.",
    schema: z.object({ code: Code, photos: z.array(Photo).max(4).optional(), use_sample: z.boolean().optional() }),
    run: async ({ code, photos, use_sample }, c) => {
      const d = await party(code, c);
      const bytes = use_sample ? (demoOn() ? listingPhotos(d.source_text) : []) : (photos ?? []).map(toBytes);
      if (!bytes.length) throw new DealError("invalid_input", "Send photos (use_sample works only in demo mode).");
      const files = checked(bytes);
      if (d.reference_files.length + files.length > 4) throw new DealError("too_many_files", "At most 4 reference photos per deal.");
      for (const f of files) await addFile(code, actorOf(c), { purpose: "reference", ...f }, c.deps);
      return brief(await party(code, c), c.baseUrl);
    },
  }),
  tool({
    name: "join_deal",
    description: "Join a draft deal as the seller.",
    schema: z.object({ code: Code }),
    run: async ({ code }, c) => brief(await handle(code, actorOf(c), { type: "join" }, c.deps), c.baseUrl),
  }),
  tool({
    name: "sign_contract",
    description: "Sign the current terms with this agent's key. A buyer's agent is refused if the amount is over its ceiling.",
    schema: z.object({ code: Code }),
    run: async ({ code }, c) => {
      const d = await party(code, c);
      if (!d.contract) throw new DealError("invalid_state", "There is nothing to sign until the seller has joined and the price and deadline are set.");
      if (d.role === "buyer" && d.amount_minor! > c.key.max_amount_minor) throw new DealError("mandate_exceeded", `${money(d.amount_minor!)} is over this agent's ceiling of ${money(c.key.max_amount_minor)}.`);
      const sig = await signAsAgent(c.key, d.contract.hash);
      return brief(await handle(code, actorOf(c), { type: "accept", terms_version: d.terms_version, contract_hash: d.contract.hash, ...sig, key_label: `Agent: ${c.key.label}` }, c.deps), c.baseUrl);
    },
  }),
  tool({
    name: "submit_proof",
    description: "Submit the seller's proof: photos (one must show the item with the deal code handwritten) and a tracking number. Claude judges it and fixed code decides. In demo mode use_sample picks a prepared set (good, wrong-item, blurry).",
    schema: z.object({ code: Code, photos: z.array(Photo).max(6).optional(), use_sample: z.string().max(20).optional(), tracking_number: z.string().min(1).max(60).optional(), note: z.string().min(1).max(500).optional() }),
    run: async ({ code, photos, use_sample, tracking_number, note }, c) => {
      const d = await party(code, c);
      if (use_sample && !demoOn()) throw new DealError("invalid_input", "use_sample works only in demo mode.");
      const bytes = use_sample ? await samplePhotos(d.source_text, code, use_sample) : (photos ?? []).map(toBytes);
      if (!bytes.length) throw new DealError("invalid_input", "Send photos.");
      const files = checked(bytes);
      const tracking = tracking_number ?? (use_sample ? "TRK-DEMO-0000" : null);
      if (!tracking && d.conditions.some((x) => x.evidence_type === "tracking")) throw new DealError("invalid_input", "A tracking number is required.");
      const ids: string[] = [];
      try {
        for (const f of files) ids.push((await addFile(code, actorOf(c), { purpose: "evidence", ...f }, c.deps)).id);
        return brief(await handle(code, actorOf(c), { type: "submit_evidence", file_ids: ids, tracking_number: tracking, note: note ?? null }, c.deps), c.baseUrl);
      } catch (e) {
        // Unused files count against addFile's limit and nothing else removes them. Once evidence rows use them (a failure after the commit), they stay.
        await c.deps.db.file.deleteMany({ where: { id: { in: ids }, evidence: { none: {} } } }).catch(() => {});
        throw e;
      }
    },
  }),
  tool({
    name: "get_deal",
    description: "A deal's status, verdicts, PayPal ids and the next step.",
    schema: z.object({ code: Code }),
    run: async ({ code }, c) => brief(await party(code, c), c.baseUrl),
  }),
  tool({
    name: "list_deals",
    description: "The 50 most recently active deals this agent's user is a party to, and the total. A seeded deal is demo history: no action is possible on it.",
    schema: z.object({}),
    run: async (_, c) => {
      const rows = await listDeals(actorOf(c), c.deps);
      return { deals: rows.slice(0, 50).map((r) => ({ code: r.code, role: r.role, status: r.status, item: r.item_title, amount: r.amount_minor === null ? null : money(r.amount_minor), seeded: r.seeded })), total: rows.length };
    },
  }),
  tool({
    name: "cancel_deal",
    description: "Cancel a deal until proof is submitted. Any hold is voided, so the buyer is not charged.",
    schema: z.object({ code: Code }),
    run: async ({ code }, c) => brief(await handle(code, actorOf(c), { type: "cancel" }, c.deps), c.baseUrl),
  }),
];

/** Throws DealError on bad arguments or a refused command. */
export async function callTool(name: string, args: unknown, c: ToolContext): Promise<unknown> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new DealError("invalid_input", `Unknown tool ${name}.`);
  const parsed = t.schema.safeParse(args ?? {});
  if (!parsed.success) throw new DealError("invalid_input", parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; "));
  return t.run(parsed.data, c);
}
