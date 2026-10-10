import { Resend } from "resend";
import { consoleEmail } from "./console";
import type { Email } from "./types";

export type { Email } from "./types";

/** Logs and swallows every failure: a lost notice must never fail a deal transition. */
export function resendEmail(apiKey: string, from: string): Email {
  const client = new Resend(apiKey);
  return {
    async send(msg) {
      try {
        const { error } = await client.emails.send({ from, ...msg });
        if (error) console.error("[email] resend error", error);
      } catch (e) {
        console.error("[email] resend failed", e);
      }
    },
  };
}

export function emailFromEnv(): Email {
  const key = process.env.RESEND_API_KEY ?? "";
  return key ? resendEmail(key, process.env.EMAIL_FROM ?? "Handshake <onboarding@resend.dev>") : consoleEmail;
}
