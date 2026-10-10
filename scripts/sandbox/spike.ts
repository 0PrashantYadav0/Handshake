// W1 sandbox spike (06 "Sandbox scenarios > Scripts"; SB-0, SB-0b, SB-8). Writes go through realPaypal() so the adapter
// itself is exercised; reads are raw GETs. Ids live in scripts/sandbox/.state.json (gitignored).
//   tsx scripts/sandbox/spike.ts create-hold --amount 25.00
//   tsx scripts/sandbox/spike.ts authorize [--order ID]
//   tsx scripts/sandbox/spike.ts capture [--auth ID] [--key capture-sb8-0]
//   tsx scripts/sandbox/spike.ts void [--auth ID]
//   tsx scripts/sandbox/spike.ts payout --to <email> --amount 1.00
//   tsx scripts/sandbox/spike.ts status
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fromPaypalValue } from "@/lib/money";
import { realPaypal } from "@/lib/paypal";
import { getToken } from "@/lib/paypal/token";

try { process.loadEnvFile(); } catch {}

const STATE = new URL("./.state.json", import.meta.url);
type State = Partial<{ ts: string; order: string; amount_minor: number; auth: string; capture: string; batch: string; item: string }>;
const state: State = (() => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } })();
const save = (patch: State) => writeFileSync(STATE, JSON.stringify(Object.assign(state, patch), null, 2) + "\n");

const { positionals: [cmd], values: flags } = parseArgs({
  allowPositionals: true,
  options: { amount: { type: "string" }, order: { type: "string" }, auth: { type: "string" }, key: { type: "string" }, to: { type: "string" } },
});
const need = <T>(v: T | undefined, what: string): T => { if (v === undefined) throw new Error(`missing ${what}`); return v; };

const base = (process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
const get = async (path: string) =>
  (await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(10_000) })).json() as Promise<Record<string, unknown>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pp = realPaypal();
const ts = state.ts ?? Date.now().toString(36);

const commands: Record<string, () => Promise<void>> = {
  async "create-hold"() {
    const amount_minor = fromPaypalValue(need(flags.amount, "--amount"));
    const ts = Date.now().toString(36);
    const { paypal_order_id } = await pp.createAuthorizeOrder({ code: `SPIKE-${ts}`, amount_minor, description: "Handshake spike" }, `order-spike-${ts}`);
    const order = await get(`/v2/checkout/orders/${paypal_order_id}`);
    const link = (order.links as Array<{ rel: string; href: string }>).find((l) => l.rel === "approve" || l.rel === "payer-action");
    save({ ts, order: paypal_order_id, amount_minor, auth: undefined, capture: undefined });
    console.log(`order ${paypal_order_id} status=${order.status}\napprove as the sandbox buyer: ${link?.href}`);
  },
  async authorize() {
    const r = await pp.authorizeOrder(flags.order ?? need(state.order, "--order"), `auth-spike-${ts}`);
    save({ auth: r.authorization_id });
    console.log(`authorization ${r.authorization_id} status=${r.status} reason=${r.reason} expires=${r.expiration_time} today=${new Date().toISOString().slice(0, 10)}`);
  },
  async capture() {
    const r = await pp.captureAuthorization(flags.auth ?? need(state.auth, "--auth"), need(state.amount_minor, "amount in state"), flags.key ?? `capture-spike-${ts}-0`);
    save({ capture: r.capture_id });
    console.log(`capture ${r.capture_id} status=${r.status} reason=${r.reason}`);
  },
  async void() {
    const auth = flags.auth ?? need(state.auth, "--auth");
    await pp.voidAuthorization(auth, `void-spike-${ts}`);
    console.log(`void ${auth} ok (PREVIOUSLY_VOIDED counts as ok)`);
  },
  async payout() {
    const key = `payout-spike-${Date.now().toString(36)}`;
    const r = await pp.createPayout(
      { sender_batch_id: key, sender_item_id: key, receiver: need(flags.to, "--to"), amount_minor: fromPaypalValue(need(flags.amount, "--amount")), note: "Handshake spike" },
      key,
    );
    save({ batch: r.payout_batch_id });
    console.log(`batch ${r.payout_batch_id} status=${r.batch_status}`);
    for (let i = 0; i < 24; i++) {
      await sleep(5_000);
      const b = await get(`/v1/payments/payouts/${r.payout_batch_id}`);
      const item = (b.items as Array<{ payout_item_id: string; transaction_status: string; errors?: { name?: string } }> | undefined)?.[0];
      console.log(`  batch=${(b.batch_header as { batch_status: string }).batch_status} item=${item?.payout_item_id} ${item?.transaction_status} ${item?.errors?.name ?? ""}`);
      if (item) save({ item: item.payout_item_id });
      if (item && ["SUCCESS", "UNCLAIMED", "FAILED", "BLOCKED", "RETURNED"].includes(item.transaction_status)) return;
    }
  },
  async status() {
    const rows: Array<[string, string, string]> = [
      ["order", `/v2/checkout/orders/${state.order}`, "status"],
      ["authorization", `/v2/payments/authorizations/${flags.auth ?? state.auth}`, "status"],
      ["capture", `/v2/payments/captures/${state.capture}`, "status"],
      ["payout batch", `/v1/payments/payouts/${state.batch}`, "batch_header"],
    ];
    for (const [label, path, field] of rows) {
      if (path.endsWith("undefined")) continue;
      const r = await get(path);
      const v = r[field];
      console.log(`${label} ${path.split("/").pop()}: ${typeof v === "object" ? (v as { batch_status: string }).batch_status : v}${r.name ? ` (${r.name})` : ""}`);
    }
  },
};

const run = commands[cmd ?? ""];
if (!run) { console.error(`usage: spike.ts <${Object.keys(commands).join("|")}> [--amount 25.00] [--order ID] [--auth ID] [--key K] [--to EMAIL]`); process.exit(2); }
run().catch((e) => { console.error(e); process.exit(1); });
