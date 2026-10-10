// Recording proxy for the W1 spike (06 "Webhooks locally and simulated > Recording"; T-13). Point the tunnel here;
// every POST is written to <out>/<event_type>.<n>.json in the 06 "Recorded webhook file shape", the signing cert is
// saved once to <out>/cert.pem, and the request is forwarded byte for byte to --forward when given (else answered 200).
//   tsx scripts/sandbox/record-webhook.ts --port 3001 [--forward http://localhost:3000/api/webhooks/paypal] [--out tests/fixtures/webhooks]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";

try { process.loadEnvFile(); } catch {}

const { values: flags } = parseArgs({
  options: {
    port: { type: "string", default: "3001" },
    forward: { type: "string" },
    out: { type: "string", default: "tests/fixtures/webhooks" },
    "webhook-id": { type: "string", default: process.env.PAYPAL_WEBHOOK_ID },
  },
});
const out = flags.out;
mkdirSync(out, { recursive: true });

const PAYPAL_HEADERS = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"];

createServer(async (req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const headers = Object.fromEntries(PAYPAL_HEADERS.map((h) => [h, typeof req.headers[h] === "string" ? req.headers[h] : null]));

  let event_type = "UNKNOWN";
  try { event_type = String(JSON.parse(raw.toString("utf8")).event_type ?? event_type); } catch {}
  const n = readdirSync(out).filter((f) => f.startsWith(`${event_type}.`) && f.endsWith(".json")).length + 1;
  const file = join(out, `${event_type}.${n}.json`);
  const record = { recorded_at: new Date().toISOString(), event_type, webhook_id: flags["webhook-id"] ?? null, headers, raw_body: raw.toString("utf8") };
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

  const certUrl = headers["paypal-cert-url"];
  const certFile = join(out, "cert.pem");
  if (certUrl && !existsSync(certFile) && new URL(certUrl).hostname.endsWith(".paypal.com")) {
    try {
      writeFileSync(certFile, await (await fetch(certUrl, { signal: AbortSignal.timeout(10_000) })).text());
      console.log(`saved ${certFile} from ${certUrl}`);
    } catch (e) {
      console.error(`cert fetch failed: ${(e as Error).message}`);
    }
  }

  let status = 200;
  let body: Buffer | string = "";
  if (flags.forward) {
    try {
      const fwd = await fetch(flags.forward, {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "application/json", ...(Object.fromEntries(Object.entries(headers).filter(([, v]) => v)) as Record<string, string>) },
        body: raw,
        signal: AbortSignal.timeout(30_000),
      });
      status = fwd.status;
      body = Buffer.from(await fwd.arrayBuffer());
    } catch (e) {
      status = 502;
      body = (e as Error).message;
    }
  }
  console.log(`${event_type} -> ${file} (${raw.length} bytes) ${flags.forward ? `forwarded: ${status}` : "answered 200"}`);
  res.writeHead(status).end(body);
}).listen(Number(flags.port), () => console.log(`recording on http://localhost:${flags.port} -> ${out}${flags.forward ? `, forwarding to ${flags.forward}` : ""}`));
