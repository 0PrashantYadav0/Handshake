// Sandbox scenarios over the HTTP API of a running Handshake (06 "Sandbox scenarios > Scripts"; T-22, T-31).
// Two cookie jars (demo personas, needs DEMO_LOGIN=true on the server); browser steps pause (--wait) or are polled for.
//   tsx scripts/sandbox/scenario.ts SB-1  --base <url> [--full] [--upload] [--set good]
//   tsx scripts/sandbox/scenario.ts SB-6  --base <url>
//   tsx scripts/sandbox/scenario.ts SB-7  --base <url> --code <code> [--fixture tests/fixtures/webhooks/PAYMENT.CAPTURE.COMPLETED.1.json]
//   tsx scripts/sandbox/scenario.ts SB-8  --base <url>
//   tsx scripts/sandbox/scenario.ts SB-11 --base <url>
// Flags: --dry prints the plan and exits; --wait pauses for Enter at each browser step instead of polling through it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { DealEvent, DealView, EvidencePack } from "@/lib/deal/types";
import type { Preset, Presets } from "@/lib/demo-kit";
import { contractHash, signingMessage } from "@/lib/contract/canonical";
import { bytesToB64url } from "@/lib/contract/signature";

// ---------- pure helpers (unit-tested) ----------

export const SCENARIOS = ["SB-1", "SB-6", "SB-7", "SB-8", "SB-11"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type Flags = { base: string; dry: boolean; wait: boolean; full: boolean; upload: boolean; set: string; code?: string; fixture?: string };

export function parseScenarioArgs(argv: string[]): { id: Scenario; flags: Flags } {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: "string", default: "http://localhost:3000" },
      dry: { type: "boolean", default: false },
      wait: { type: "boolean", default: false },
      full: { type: "boolean", default: false },
      upload: { type: "boolean", default: false },
      set: { type: "string", default: "good" },
      code: { type: "string" },
      fixture: { type: "string" },
    },
  });
  const id = positionals[0] as Scenario;
  if (!SCENARIOS.includes(id)) throw new Error(`scenario must be one of ${SCENARIOS.join(", ")}`);
  if (id === "SB-7" && !values.code) throw new Error("SB-7 needs --code <code> of a deal that reached captured or paid");
  return { id, flags: { ...values, base: values.base.replace(/\/$/, "") } };
}

export const HELD_TRAIL = ["create", "join", "accept", "accept", "start_payment", "fact:authorization_created"];
export const PAID_TRAIL = [...HELD_TRAIL, "submit_evidence", "verdict", "decision:capture", "fact:capture_completed", "fact:payout_succeeded"];

/** The step list printed by --dry and echoed as the scenario runs. */
export function plan(id: Scenario, f: Flags): string[] {
  const toHeld = [
    "sign in buyer and seller (POST /api/auth/demo)",
    `buyer creates the deal from the demo kit sentence (set ${f.set}) and uploads its listing photos`,
    "seller has a verified PayPal email (GET /api/me), joins and signs; buyer signs -> terms_agreed",
    "buyer starts payment (POST payment) -> approve link printed",
  ];
  switch (id) {
    case "SB-1":
      return [
        ...toHeld,
        f.wait ? "PAUSE: approve as the sandbox buyer, Enter; then POST payment/authorize -> held" : "poll: the CHECKOUT.ORDER.APPROVED webhook (or the browser) moves the deal to held",
        `assert status held and trail ${HELD_TRAIL.join(" > ")}`,
        ...(f.full
          ? [
              f.upload ? `seller uploads the kit photos of set ${f.set} by API and submits evidence (TRK-DEMO-0000)` : `PAUSE: seller opens the deal, "Use sample" set ${f.set}, submits`,
              "poll: captured then paid (PAYMENT.PAYOUTS-ITEM.SUCCEEDED)",
              `assert status paid and the 11-row trail`,
            ]
          : []),
      ];
    case "SB-6":
      return [...toHeld, "PAUSE: click Pay Now in the popup and close the tab at once; the script never calls payment/authorize", "poll: held within 60 s", 'assert the held event payload.source is "webhook" with a paypal_event_id'];
    case "SB-11":
      return [...toHeld, f.wait ? "PAUSE: approve, Enter; POST payment/authorize -> held" : "poll: held", "buyer cancels (POST cancel)", `assert status voided and trail ${[...HELD_TRAIL, "cancel"].join(" > ")}`];
    case "SB-7":
      return [
        `sign in buyer; GET evidence pack of ${f.code}: webhook_events, deal_events, payouts before`,
        f.fixture ? `replay ${f.fixture} byte for byte to POST /api/webhooks/paypal` : "find tests/fixtures/webhooks/PAYMENT.CAPTURE.COMPLETED.*.json whose body carries this deal's capture id and replay it; else PAUSE for a dashboard resend",
        "assert 200, one webhook_events row for that event id, deal_events count unchanged, one payout",
      ];
    case "SB-8":
      return ["print the spike.ts commands: create-hold, approve, authorize, capture --key capture-sb8-0 twice", "PAUSE: paste both capture ids", "assert both ids equal (one transaction in the business account)"];
  }
}

/** null when `got` starts with `want`; else the first difference. */
export function trailMismatch(got: string[], want: string[]): string | null {
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return `event ${i + 1}: expected ${want[i]}, got ${got[i] ?? "nothing"}`;
  return null;
}

type Fixture = { headers: Record<string, string | null>; raw_body: string };
/** The recorded PAYMENT.CAPTURE.COMPLETED delivery whose body names this capture id. */
export function pickFixture(files: { name: string; text: string }[], captureId: string): { name: string; fixture: Fixture } | null {
  for (const f of files) {
    if (!/^PAYMENT\.CAPTURE\.COMPLETED\.\d+\.json$/.test(f.name)) continue;
    const fixture = JSON.parse(f.text) as Fixture;
    if (fixture.raw_body.includes(`"${captureId}"`)) return { name: f.name, fixture };
  }
  return null;
}

// ---------- HTTP plumbing ----------

type Jar = { who: string; cookie: string };
type Reply = { status: number; body: Record<string, unknown> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(base: string, jar: Jar | null, method: string, path: string, body?: unknown): Promise<Reply> {
  const init: RequestInit = { method, headers: { ...(jar ? { cookie: jar.cookie } : {}) }, signal: AbortSignal.timeout(60_000) };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) Object.assign(init, { body: JSON.stringify(body), headers: { ...init.headers, "content-type": "application/json" } });
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, body: (parsed ?? { raw: text }) as Record<string, unknown> };
}

async function must(p: Promise<Reply>, what: string): Promise<Record<string, unknown>> {
  const { status, body } = await p;
  if (status >= 300) throw new Error(`${what} -> ${status} ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  return body;
}

// trust spec §6: each persona signs with its own P-256 key (made here, like a browser would) and a fresh demo code.
const keys = new Map<string, CryptoKeyPair>();
async function signContract(base: string, jar: Jar, code: string): Promise<DealView> {
  const v = (await must(api(base, jar, "GET", `/api/deals/${code}`), `${jar.who} read`)) as unknown as DealView;
  if (!v.contract) throw new Error("no contract to sign: has the seller joined?");
  const hash = await contractHash(v.contract.document);
  if (hash !== v.contract.hash) throw new Error("the contract document does not match its hash");
  let pair = keys.get(jar.who);
  if (!pair) keys.set(jar.who, (pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])));
  const signature = bytesToB64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(signingMessage(hash))));
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const { code: totp } = (await must(api(base, jar, "GET", "/api/auth/2fa/demo-code"), `${jar.who} demo code`)) as { code: string };
  const body = { terms_version: v.terms_version, contract_hash: hash, signature, public_key: { x: jwk.x, y: jwk.y }, totp };
  return (await must(api(base, jar, "POST", `/api/deals/${code}/accept`, body), `${jar.who} sign`)) as unknown as DealView;
}

async function signIn(base: string, persona: "buyer" | "seller"): Promise<Jar> {
  const res = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) });
  const cookie = /hs_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0];
  if (!res.ok || !cookie) throw new Error(`sign in ${persona} -> ${res.status} ${(await res.text()).slice(0, 200)} (is DEMO_LOGIN=true on the server?)`);
  // Second factor (trust spec §4): the personas' code comes from the demo endpoint; verifying swaps the partial cookie for a full one.
  const { code } = (await (await fetch(`${base}/api/auth/2fa/demo-code`, { headers: { cookie } })).json()) as { code: string };
  const v = await fetch(`${base}/api/auth/2fa/verify`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ code }) });
  const full = /hs_session=[^;]+/.exec(v.headers.get("set-cookie") ?? "")?.[0];
  if (!v.ok || !full) throw new Error(`2FA ${persona} -> ${v.status} ${(await v.text()).slice(0, 200)}`);
  return { who: persona, cookie: full };
}

async function pause(flags: Flags, text: string) {
  console.log(`\n>>> ${text}`);
  if (!flags.wait) return console.log("    (no --wait: polling continues while you do it)\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("    press Enter when done ");
  rl.close();
}

async function poll(base: string, jar: Jar, code: string, done: (v: DealView) => boolean, timeoutMs: number, label: string): Promise<DealView> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = (await must(api(base, jar, "GET", `/api/deals/${code}`), "GET deal")) as unknown as DealView;
    if (done(v)) return v;
    if (Date.now() > until) throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${label}; status is ${v.status}, payment ${v.payment?.status ?? "none"}`);
    await sleep(3_000);
  }
}

const events = async (base: string, jar: Jar, code: string) => (await must(api(base, jar, "GET", `/api/deals/${code}/events`), "GET events")) as unknown as DealEvent[];
const causes = (evs: DealEvent[]) => evs.map((e) => e.cause);
const printTrail = (evs: DealEvent[]) => evs.forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. ${e.cause.padEnd(28)} ${e.actor.padEnd(7)} ${e.from_status ?? "-"} -> ${e.to_status}`));

async function uploadFile(f: Flags, jar: Jar, code: string, purpose: "reference" | "evidence", url: string): Promise<string> {
  const blob = await (await fetch(`${f.base}${url}`)).blob();
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", blob, url.split("/").pop());
  return (await must(api(f.base, jar, "POST", `/api/deals/${code}/files`, form), `upload ${url}`)).id as string;
}

// ---------- the shared half: a new deal to held ----------

async function toHeld(f: Flags, confirm: boolean): Promise<{ buyer: Jar; seller: Jar; code: string; preset: Preset }> {
  const b = f.base;
  const buyer = await signIn(b, "buyer");
  const seller = await signIn(b, "seller");
  const kit = (await must(api(b, null, "GET", "/demo/presets.json"), "GET demo kit")) as unknown as Presets;
  const preset = kit.presets.find((p) => f.set in p.sets) ?? kit.presets[0];
  if (!(f.set in preset.sets)) throw new Error(`no demo kit preset has an evidence set named ${f.set}`);

  const created = (await must(api(b, buyer, "POST", "/api/deals", { text: preset.sentence }), "POST /api/deals")) as unknown as DealView;
  const code = created.code;
  console.log(`deal ${code}  ${b}/deal/${code}  (${preset.id}, ${created.amount_minor} minor, ${created.conditions.length} conditions)`);
  // The sentence says "matches the listing photos": with none on the deal, judge() can't let that condition pass.
  for (const url of preset.reference) await uploadFile(f, buyer, code, "reference", url);

  const me = (await must(api(b, seller, "GET", "/api/me"), "GET /api/me")).user as { paypal_email: string | null; paypal_email_verified: boolean };
  // trust spec §8: a payout address is verified by an emailed code; the demo seller's sandbox address is verified by configuration.
  if (!me.paypal_email_verified) throw new Error("the demo seller has no verified PayPal email: set DEMO_SELLER_PAYPAL_EMAIL on the server and sign in again");
  await must(api(b, seller, "POST", `/api/deals/${code}/join`), "join");
  await signContract(b, seller, code);
  const agreed = await signContract(b, buyer, code);
  if (agreed.status !== "terms_agreed") throw new Error(`expected terms_agreed after both accepts, got ${agreed.status}`);
  console.log("terms_agreed");

  const { order_id } = (await must(api(b, buyer, "POST", `/api/deals/${code}/payment`), "start payment")) as { order_id: string };
  console.log(`order ${order_id}`);
  await pause(f, `approve as the sandbox buyer (personal 1): https://www.sandbox.paypal.com/checkoutnow?token=${order_id}\n    or sign in as the buyer persona at ${b}/deal/${code} and use the PayPal button${confirm ? "" : "; then close the tab at once"}`);
  if (confirm && f.wait) await must(api(b, buyer, "POST", `/api/deals/${code}/payment/authorize`, { order_id }), "confirm approval");
  const held = await poll(b, buyer, code, (v) => v.status !== "terms_agreed", confirm ? 15 * 60_000 : 60_000, "held");
  if (held.status !== "held") throw new Error(`expected held, got ${held.status}`);
  console.log(`held  authorization ${held.payment?.authorization_id}  deadline ${held.deadline_at}`);
  return { buyer, seller, code, preset };
}

async function uploadEvidence(f: Flags, seller: Jar, code: string, preset: Preset, tracking: string) {
  const file_ids: string[] = [];
  for (const url of [...preset.sets[f.set].photos, preset.code_photo.base]) file_ids.push(await uploadFile(f, seller, code, "evidence", url));
  console.log(`uploaded ${file_ids.length} photos (the code photo is the uncomposed base: the hand-written code condition may fail; use the browser's "Use sample" for a composed one)`);
  await must(api(f.base, seller, "POST", `/api/deals/${code}/evidence`, { file_ids, tracking_number: tracking }), "submit evidence");
}

// ---------- scenarios ----------

const run: Record<Scenario, (f: Flags) => Promise<string>> = {
  async "SB-1"(f) {
    const { buyer, seller, code, preset } = await toHeld(f, true);
    const evs = await events(f.base, buyer, code);
    printTrail(evs);
    const miss = trailMismatch(causes(evs), HELD_TRAIL);
    if (miss) throw new Error(miss);
    if (!f.full) return `${code} held (add --full to continue through evidence to paid)`;

    if (f.upload) await uploadEvidence(f, seller, code, preset, "TRK-DEMO-0000");
    else await pause(f, `sign in as the seller persona at ${f.base}/deal/${code}, press "Use sample" (set ${f.set}), submit the evidence`);
    const decided = await poll(f.base, buyer, code, (v) => !["held", "proof_submitted"].includes(v.status) || v.fix_attempts_used === 1, 10 * 60_000, "a verdict");
    if (decided.status !== "captured" && decided.status !== "paid") throw new Error(`expected captured, got ${decided.status} (${decided.submissions.at(-1)?.decision_reason ?? "no decision"})`);
    const paid = await poll(f.base, buyer, code, (v) => v.status === "paid", 3 * 60_000, "paid (PAYMENT.PAYOUTS-ITEM.SUCCEEDED)");
    const all = await events(f.base, buyer, code);
    printTrail(all);
    const miss2 = trailMismatch(causes(all), PAID_TRAIL);
    if (miss2 || all.length !== PAID_TRAIL.length) throw new Error(miss2 ?? `expected ${PAID_TRAIL.length} events, got ${all.length}`);
    return `${code} ${paid.status}, payout ${paid.payouts[0]?.status}, ${all.length}-row trail`;
  },

  async "SB-6"(f) {
    const { buyer, code } = await toHeld(f, false);
    const evs = await events(f.base, buyer, code);
    printTrail(evs);
    const held = evs.find((e) => e.cause === "fact:authorization_created");
    const source = held?.payload.source;
    if (source !== "webhook") throw new Error(`held event payload.source is ${JSON.stringify(source)}, expected "webhook" (the browser won the race: run again and close the tab faster)`);
    if (!held?.payload.paypal_event_id) throw new Error("held event has no paypal_event_id");
    return `${code} held by webhook ${held.payload.paypal_event_id}`;
  },

  async "SB-11"(f) {
    const { buyer, code } = await toHeld(f, true);
    const view = (await must(api(f.base, buyer, "POST", `/api/deals/${code}/cancel`), "cancel")) as unknown as DealView;
    const evs = await events(f.base, buyer, code);
    printTrail(evs);
    const miss = trailMismatch(causes(evs), [...HELD_TRAIL, "cancel"]);
    if (view.status !== "voided" || view.payment?.status !== "voided" || miss) throw new Error(miss ?? `expected voided/voided, got ${view.status}/${view.payment?.status}`);
    return `${code} voided; confirm with: tsx scripts/sandbox/spike.ts status --auth ${view.payment.authorization_id}`;
  },

  async "SB-7"(f) {
    const code = f.code!;
    const buyer = await signIn(f.base, "buyer");
    const pack = async () => (await must(api(f.base, buyer, "GET", `/api/deals/${code}/evidence-pack`), "GET evidence pack")) as unknown as EvidencePack;
    const before = await pack();
    const captureId = before.payment?.capture_id;
    if (!captureId) throw new Error(`deal ${code} has no capture (status ${before.deal.status}); run SB-1 --full first`);
    console.log(`before: ${before.webhook_events.length} webhook_events, ${before.events.length} deal_events, ${before.payouts.length} payouts, capture ${captureId}`);

    const dir = "tests/fixtures/webhooks";
    const files = f.fixture ? [{ name: "PAYMENT.CAPTURE.COMPLETED.0.json", text: readFileSync(f.fixture, "utf8") }] : readdirSync(dir).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    const picked = pickFixture(files, captureId);
    let eventId: string;
    if (picked) {
      eventId = String(JSON.parse(picked.fixture.raw_body).id);
      const headers = Object.fromEntries(Object.entries(picked.fixture.headers).filter((kv): kv is [string, string] => !!kv[1]));
      const deliveries = before.webhook_events.some((w) => w.paypal_event_id === eventId) ? 1 : 2; // never stored yet: the first POST is the first delivery
      for (let i = 0; i < deliveries; i++) {
        const res = await fetch(`${f.base}/api/webhooks/paypal`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: picked.fixture.raw_body });
        console.log(`replay ${i + 1} of ${picked.name} (event ${eventId}) -> ${res.status} ${(await res.text()).slice(0, 120)}`);
        if (res.status !== 200) throw new Error(`replay answered ${res.status}`);
      }
    } else {
      const row = before.webhook_events.find((w) => w.event_type === "PAYMENT.CAPTURE.COMPLETED");
      if (!row) throw new Error("no recorded fixture for this capture and no PAYMENT.CAPTURE.COMPLETED row to resend: record one with record-webhook.ts or pass --fixture");
      eventId = row.paypal_event_id;
      f.wait = true;
      await pause(f, `no recorded fixture names capture ${captureId}. In developer.paypal.com open the app's Webhooks > Events, find ${eventId} (PAYMENT.CAPTURE.COMPLETED) and press Resend; expect the delivery to answer 200`);
    }
    const after = await pack();
    const rows = after.webhook_events.filter((w) => w.paypal_event_id === eventId);
    console.log(`after: ${after.webhook_events.length} webhook_events, ${after.events.length} deal_events, ${after.payouts.length} payouts`);
    if (rows.length !== 1 || !rows[0].processed_at) throw new Error(`expected one processed webhook_events row for ${eventId}, got ${rows.length}`);
    if (after.events.length !== before.events.length) throw new Error(`deal_events grew from ${before.events.length} to ${after.events.length}`);
    if (after.payouts.length !== 1) throw new Error(`expected one payout, got ${after.payouts.length}`);
    return `${code} second delivery of ${eventId} was a no-op`;
  },

  async "SB-8"() {
    console.log(
      [
        "SB-8 is a PayPal-only check; run from a shell with the sandbox app's .env:",
        "  tsx scripts/sandbox/spike.ts create-hold --amount 25.00     # approve the printed link as the sandbox buyer",
        "  tsx scripts/sandbox/spike.ts authorize",
        "  tsx scripts/sandbox/spike.ts capture --key capture-sb8-0",
        "  tsx scripts/sandbox/spike.ts capture --key capture-sb8-0     # same key again",
        "Then check the business account's Activity shows one transaction.",
      ].join("\n"),
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = (await rl.question("capture id from the first call:  ")).trim();
    const c = (await rl.question("capture id from the second call: ")).trim();
    rl.close();
    if (!a || a !== c) throw new Error(`capture ids differ or are empty: "${a}" vs "${c}"`);
    return `both calls returned ${a}`;
  },
};

async function main() {
  const { id, flags } = parseScenarioArgs(process.argv.slice(2));
  console.log(`${id} against ${flags.base}${flags.dry ? " (dry)" : ""}`);
  plan(id, flags).forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  if (flags.dry) return;
  console.log("");
  try {
    console.log(`\nPASS ${id}: ${await run[id](flags)}`);
  } catch (e) {
    console.log(`\nFAIL ${id}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(); } catch {}
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
