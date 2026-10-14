// 02 section 9.5: instrumentation.ts runs lib/env.ts at server start; production refuses a bad environment, development warns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";

const GOOD = {
  NEXT_RUNTIME: "nodejs",
  DATABASE_URL: "postgresql://db:5432/h",
  APP_URL: "https://handshake.example",
  SESSION_SECRET: "s".repeat(32),
  DATA_KEYS: "k1:" + "d".repeat(32),
  FILE_URL_SECRET: "f".repeat(32),
  PAYPAL_CLIENT_ID: "id",
  PAYPAL_CLIENT_SECRET: "secret",
  PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
  PAYPAL_WEBHOOK_ID: "WH-1",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "id",
  ANTHROPIC_API_KEY: "key",
  RESEND_API_KEY: "re_key",
  EMAIL_FROM: "Handshake <a@b.c>",
  CRON_SECRET: "c".repeat(32),
  DEMO_LOGIN: "true",
  DEMO_SELLER_PAYPAL_EMAIL: "seller@example.com",
};

const boot = (env: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries({ ...GOOD, ...env })) vi.stubEnv(k, v);
  return register();
};

beforeEach(() => vi.resetModules()); // lib/env parses at module load, so each case needs a fresh import
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("env check at boot", () => {
  it("a complete production environment boots", async () => {
    await expect(boot({ NODE_ENV: "production" })).resolves.toBeUndefined();
  });

  it.each([
    ["RESEND_API_KEY empty (sign-in links would only reach the log)", { RESEND_API_KEY: "" }],
    ["PAYPAL_WEBHOOK_ID empty", { PAYPAL_WEBHOOK_ID: "" }],
    ["a short SESSION_SECRET", { SESSION_SECRET: "short" }],
    ["DEMO_LOGIN on live PayPal", { PAYPAL_API_BASE: "https://api-m.paypal.com" }],
    ["a malformed PASS_THRESHOLD", { PASS_THRESHOLD: "abc" }],
    ["DEMO_LOGIN without the demo seller payout address", { DEMO_SELLER_PAYPAL_EMAIL: "" }],
  ])("production refuses %s", async (_, env) => {
    await expect(boot({ NODE_ENV: "production", ...env })).rejects.toThrow();
  });

  it("development warns and keeps running without the external keys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(boot({ NODE_ENV: "development", PAYPAL_CLIENT_ID: "", ANTHROPIC_API_KEY: "" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("the edge runtime skips the check", async () => {
    await expect(boot({ NODE_ENV: "production", NEXT_RUNTIME: "edge", RESEND_API_KEY: "" })).resolves.toBeUndefined();
  });
});
