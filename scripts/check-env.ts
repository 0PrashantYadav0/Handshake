// npm run check-env: validate .env with lib/env (the same rules the server applies at boot), then try each external key
// against its service. Prints names and verdicts only, never values. Exit 1 if anything fails.
//   npm run check-env                  development rules (what `next dev` checks)
//   NODE_ENV=production npm run check-env   production rules (what Render checks; PAYPAL_WEBHOOK_ID and RESEND_API_KEY required)
import { z } from "zod";

try { process.loadEnvFile(); } catch { /* .env is optional; the variables may come from the shell */ }
const env = process.env;
let failed = false;
const line = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(28)} ${detail}`);
};

async function rules() {
  try {
    await import("@/lib/env");
    line(true, "lib/env", `every variable valid (${env.NODE_ENV ?? "development"} rules)`);
  } catch (e) {
    const issues = e instanceof z.ZodError ? e.issues : [{ path: ["?"], message: String(e) }];
    for (const i of issues) line(false, i.path.join("."), i.message);
  }
  // Mistakes the schema cannot see: both are strings of the right shape.
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET === env.PAYPAL_CLIENT_ID)
    line(false, "PAYPAL_CLIENT_SECRET", "same value as PAYPAL_CLIENT_ID; copy the Secret (click Show) from the app page");
  if (env.NEXT_PUBLIC_PAYPAL_CLIENT_ID && env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== env.PAYPAL_CLIENT_ID)
    line(false, "NEXT_PUBLIC_PAYPAL_CLIENT_ID", "differs from PAYPAL_CLIENT_ID; both must come from the same REST app");
}

async function paypal() {
  const r = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string; scope?: string };
  if (!r.ok) return line(false, "PayPal", `${r.status} ${j.error ?? ""} ${j.error_description ?? ""}`.trim());
  line(true, "PayPal", `token issued by ${new URL(env.PAYPAL_API_BASE!).host}`);
  line((j.scope ?? "").includes("payouts"), "PayPal Payouts", (j.scope ?? "").includes("payouts") ? "scope granted" : "scope missing: tick Payouts under the app's Features");
}

async function anthropic() {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 5, messages: [{ role: "user", content: "Say ok" }] }),
  });
  const j = (await r.json().catch(() => ({}))) as { model?: string; error?: { type?: string; message?: string } };
  line(r.ok, "Anthropic", r.ok ? `answered as ${j.model}` : `${r.status} ${j.error?.type ?? ""} ${j.error?.message ?? ""}`.trim());
}

async function resend() {
  if (!env.RESEND_API_KEY) return console.log(`skip  ${"Resend".padEnd(28)} RESEND_API_KEY empty: sign-in links print to the server log`);
  const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
  const j = (await r.json().catch(() => ({}))) as { name?: string; message?: string };
  // A sending-only key is refused on /domains with restricted_api_key, which still proves the key exists.
  const ok = r.ok || j.name === "restricted_api_key";
  line(ok, "Resend", ok ? "key accepted" : `${r.status} ${j.name ?? ""} ${j.message ?? ""}`.trim());
  if (ok && (env.EMAIL_FROM ?? "").includes("@resend.dev"))
    console.log(`note  ${"EMAIL_FROM".padEnd(28)} resend.dev test sender: mail reaches only the Resend account's own address`);
}

async function main() {
  await rules();
  for (const [name, probe] of [["PayPal", paypal], ["Anthropic", anthropic], ["Resend", resend]] as const) {
    try { await probe(); } catch (e) { line(false, name, e instanceof Error ? e.message : String(e)); }
  }
  if (failed) process.exitCode = 1;
}

void main();
