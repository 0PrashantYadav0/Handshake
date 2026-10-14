// Zod-validated process.env for every name in decisions J3; fails fast at boot (02 section 9.5).
import { z } from "zod";
import { limitsFromEnv } from "@/lib/deal/decide";

const production = process.env.NODE_ENV === "production";

const EnvZ = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  DATA_KEYS: z.string().min(32), // field encryption keyring (trust spec §5); parsed by lib/crypto/seal.ts
  FILE_URL_SECRET: z.string().min(32),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_API_BASE: z.url(),
  PAYPAL_WEBHOOK_ID: production ? z.string().min(1) : z.string().default(""),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  RESEND_API_KEY: production ? z.string().min(1) : z.string().default(""),
  EMAIL_FROM: z.string().min(1),
  PASS_THRESHOLD: z.string().optional(),
  AUTO_CAPTURE_MAX_MINOR: z.string().optional(),
  CRON_SECRET: z.string().min(32),
  DEMO_LOGIN: z.string().default(""),
  DEMO_SELLER_PAYPAL_EMAIL: z.string().default(""),
  AG_GRID_LICENSE_KEY: z.string().default(""),
});

// Review finding 5: demo personas have a published second factor, so they must never meet live PayPal.
export const env = EnvZ.refine((e) => e.DEMO_LOGIN !== "true" || e.PAYPAL_API_BASE.includes("sandbox"), {
  message: "DEMO_LOGIN=true is allowed only with the PayPal sandbox (PAYPAL_API_BASE must be the sandbox API)",
  path: ["DEMO_LOGIN"],
}).refine((e) => e.DEMO_LOGIN !== "true" || e.DEMO_SELLER_PAYPAL_EMAIL.includes("@"), {
  message: "DEMO_LOGIN=true needs DEMO_SELLER_PAYPAL_EMAIL (the sandbox account the demo seller is paid to)",
  path: ["DEMO_SELLER_PAYPAL_EMAIL"],
}).parse(process.env);
export const LIMITS = limitsFromEnv(); // evaluated at module load: a bad PASS_THRESHOLD stops the deploy
export const DEMO_LOGIN = env.DEMO_LOGIN === "true";
